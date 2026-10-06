const { Op } = require('sequelize');
const { Expense, Branch } = require('../models');
const LedgerService = require('../services/ledgerService');
const { generateSequence } = require('../services/invoiceService');
const { logAudit } = require('../middleware/audit');

const getExpenses = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { category, startDate, endDate, page = 1, limit = 50 } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (category) where.category = category;
    if (startDate && endDate) {
      where.expenseDate = { [Op.between]: [startDate, endDate] };
    }

    const expenses = await Expense.findAll({
      where,
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }],
      order: [['expenseDate', 'DESC'], ['id', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    res.json({ success: true, expenses });
  } catch (err) {
    next(err);
  }
};

const createExpense = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const {
      branchId,
      category,
      amount,
      paymentMode = 'CASH',
      paidTo,
      description = '',
      receiptNo = '',
      expenseDate
    } = req.body;

    const targetBranchId = req.user.role === 'OWNER' ? (branchId || req.user.branchId || 1) : req.user.branchId;
    const branch = await Branch.findByPk(targetBranchId, { transaction: dbTx });
    if (!branch) throw new Error('Branch not found');

    const numAmt = parseFloat(amount);
    if (numAmt <= 0) throw new Error('Expense amount must be greater than 0');

    const expSeq = await generateSequence('EXP', branch.code, dbTx);

    const expense = await Expense.create({
      expenseNumber: expSeq,
      branchId: targetBranchId,
      category,
      amount: numAmt,
      paymentMode,
      paidTo,
      description,
      receiptNo,
      expenseDate: expenseDate || new Date().toISOString().split('T')[0],
      createdBy: req.user.id
    }, { transaction: dbTx });

    // Append-Only Ledger Postings:
    // Debit: OPERATING_EXPENSE
    // Credit: CASH or BANK
    const assetAccount = (paymentMode === 'BANK' || paymentMode === 'UPI') ? 'BANK' : 'CASH';

    await LedgerService.postEntry({
      branchId: targetBranchId,
      branchCode: branch.code,
      type: 'OPERATING_EXPENSE',
      referenceType: 'Expense',
      referenceId: expense.id,
      referenceNumber: expSeq,
      partyType: 'INTERNAL',
      accountType: 'OPERATING_EXPENSE',
      debitAmount: numAmt,
      creditAmount: 0,
      notes: `${category} expense paid to ${paidTo}: ${description}`,
      createdBy: req.user.id
    }, dbTx);

    await LedgerService.postEntry({
      branchId: targetBranchId,
      branchCode: branch.code,
      type: 'OPERATING_EXPENSE',
      referenceType: 'Expense',
      referenceId: expense.id,
      referenceNumber: expSeq,
      partyType: 'INTERNAL',
      accountType: assetAccount,
      debitAmount: 0,
      creditAmount: numAmt,
      notes: `Cash/Bank payout for expense ${expSeq}`,
      createdBy: req.user.id
    }, dbTx);

    await dbTx.commit();

    await logAudit({
      req,
      action: 'RECORD_EXPENSE',
      entityName: 'Expense',
      entityId: expense.id,
      entityReference: expSeq,
      afterState: expense.toJSON()
    });

    res.status(201).json({
      success: true,
      message: `Expense ${expSeq} of Rs ${numAmt} recorded successfully`,
      expense
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

module.exports = {
  getExpenses,
  createExpense
};
