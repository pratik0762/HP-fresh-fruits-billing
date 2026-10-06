const { Op } = require('sequelize');
const { 
  Payment, Customer, Supplier, CommissionAgent, Transporter, Branch, Sale, Purchase, sequelize 
} = require('../models');
const LedgerService = require('../services/ledgerService');
const { generateSequence } = require('../services/invoiceService');
const { logAudit } = require('../middleware/audit');

const getPayments = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { partyType, partyId, voucherType, startDate, endDate, page = 1, limit = 50 } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (partyType) where.partyType = partyType;
    if (partyId) where.partyId = partyId;
    if (voucherType) where.voucherType = voucherType;
    if (startDate && endDate) {
      where.paymentDate = { [Op.between]: [startDate, endDate] };
    }

    const payments = await Payment.findAll({
      where,
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }],
      order: [['id', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    res.json({ success: true, payments });
  } catch (err) {
    next(err);
  }
};

const createPayment = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const {
      branchId,
      voucherType, // RECEIPT_CUSTOMER, PAYMENT_SUPPLIER, PAYMENT_AGENT, PAYMENT_TRANSPORTER
      partyType,   // CUSTOMER, SUPPLIER, COMMISSION_AGENT, TRANSPORTER
      partyId,
      amount,
      paymentMode = 'CASH', // CASH, BANK, UPI, CHEQUE
      referenceType = null,  // 'Sale', 'Purchase', 'OnAccount'
      referenceId = null,
      bankReference = '',
      paymentDate,
      notes = ''
    } = req.body;

    const targetBranchId = req.user.role === 'OWNER' ? (branchId || req.user.branchId || 1) : req.user.branchId;
    const branch = await Branch.findByPk(targetBranchId, { transaction: dbTx });
    if (!branch) throw new Error('Branch not found');

    const numAmount = parseFloat(amount);
    if (numAmount <= 0) throw new Error('Payment amount must be greater than 0');

    // Branch isolation: a payment must settle an invoice of the payer's own branch.
    // Non-owners can never touch another branch's receivable/payable.
    if (referenceType === 'Sale' && referenceId) {
      const inv = await Sale.findByPk(referenceId, { transaction: dbTx });
      if (inv && req.user.role !== 'OWNER' && inv.branchId !== targetBranchId) {
        throw new Error('Access denied: this invoice belongs to another branch.');
      }
    } else if (referenceType === 'Purchase' && referenceId) {
      const inv = await Purchase.findByPk(referenceId, { transaction: dbTx });
      if (inv && req.user.role !== 'OWNER' && inv.branchId !== targetBranchId) {
        throw new Error('Access denied: this bill belongs to another branch.');
      }
    }

    let partyName = 'Party';
    if (partyType === 'CUSTOMER') {
      const cust = await Customer.findByPk(partyId, { transaction: dbTx });
      if (!cust) throw new Error('Customer not found');
      partyName = cust.name;
    } else if (partyType === 'SUPPLIER') {
      const supp = await Supplier.findByPk(partyId, { transaction: dbTx });
      if (!supp) throw new Error('Supplier not found');
      partyName = supp.name;
    } else if (partyType === 'COMMISSION_AGENT') {
      const agent = await CommissionAgent.findByPk(partyId, { transaction: dbTx });
      if (!agent) throw new Error('Agent not found');
      partyName = agent.name;
    } else if (partyType === 'TRANSPORTER') {
      const trans = await Transporter.findByPk(partyId, { transaction: dbTx });
      if (!trans) throw new Error('Transporter not found');
      partyName = trans.name;
    }

    const paySeq = await generateSequence('PAY', branch.code, dbTx);

    // Create payment voucher
    const payment = await Payment.create({
      paymentNumber: paySeq,
      branchId: targetBranchId,
      voucherType,
      partyType,
      partyId,
      amount: numAmount,
      paymentMode,
      referenceType,
      referenceId,
      bankReference,
      paymentDate: paymentDate || new Date().toISOString().split('T')[0],
      notes,
      createdBy: req.user.id
    }, { transaction: dbTx });

    // Update specific linked invoice if provided
    if (referenceType === 'Sale' && referenceId) {
      const sale = await Sale.findByPk(referenceId, { transaction: dbTx, lock: dbTx.LOCK.UPDATE });
      if (sale) {
        const newPaid = parseFloat((parseFloat(sale.paidAmount || 0) + numAmount).toFixed(2));
        const newDue = parseFloat(Math.max(0, parseFloat(sale.totalAmount) - newPaid).toFixed(2));
        sale.paidAmount = newPaid;
        sale.dueAmount = newDue;
        sale.paymentStatus = newDue <= 0 ? 'PAID' : 'PARTIAL';
        await sale.save({ transaction: dbTx });
      }
    } else if (referenceType === 'Purchase' && referenceId) {
      const purchase = await Purchase.findByPk(referenceId, { transaction: dbTx, lock: dbTx.LOCK.UPDATE });
      if (purchase) {
        const newPaid = parseFloat((parseFloat(purchase.paidAmount || 0) + numAmount).toFixed(2));
        const newDue = parseFloat(Math.max(0, parseFloat(purchase.totalAmount) - newPaid).toFixed(2));
        purchase.paidAmount = newPaid;
        purchase.dueAmount = newDue;
        purchase.paymentStatus = newDue <= 0 ? 'PAID' : 'PARTIAL';
        await purchase.save({ transaction: dbTx });
      }
    }

    // Append-Only Ledger Postings
    const assetAccount = (paymentMode === 'BANK' || paymentMode === 'CHEQUE' || paymentMode === 'NEFT_RTGS') ? 'BANK' : 'CASH';

    if (voucherType === 'RECEIPT_CUSTOMER') {
      // Debit Cash/Bank, Credit Accounts Receivable (Customer)
      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'CUSTOMER_PAYMENT',
        referenceType: 'Payment',
        referenceId: payment.id,
        referenceNumber: paySeq,
        partyType: 'CUSTOMER',
        partyId,
        partyName,
        accountType: assetAccount,
        debitAmount: numAmount,
        creditAmount: 0,
        notes: `Customer collection via ${paymentMode} from ${partyName}`,
        createdBy: req.user.id
      }, dbTx);

      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'CUSTOMER_PAYMENT',
        referenceType: 'Payment',
        referenceId: payment.id,
        referenceNumber: paySeq,
        partyType: 'CUSTOMER',
        partyId,
        partyName,
        accountType: 'ACCOUNTS_RECEIVABLE',
        debitAmount: 0,
        creditAmount: numAmount,
        notes: `Customer balance credited for payment ${paySeq}`,
        createdBy: req.user.id
      }, dbTx);
    } else if (voucherType === 'PAYMENT_SUPPLIER') {
      // Debit Accounts Payable (Supplier), Credit Cash/Bank
      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'SUPPLIER_PAYMENT',
        referenceType: 'Payment',
        referenceId: payment.id,
        referenceNumber: paySeq,
        partyType: 'SUPPLIER',
        partyId,
        partyName,
        accountType: 'ACCOUNTS_PAYABLE',
        debitAmount: numAmount,
        creditAmount: 0,
        notes: `Supplier payout to ${partyName}`,
        createdBy: req.user.id
      }, dbTx);

      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: 'SUPPLIER_PAYMENT',
        referenceType: 'Payment',
        referenceId: payment.id,
        referenceNumber: paySeq,
        partyType: 'SUPPLIER',
        partyId,
        partyName,
        accountType: assetAccount,
        debitAmount: 0,
        creditAmount: numAmount,
        notes: `Cash/Bank payout voucher ${paySeq}`,
        createdBy: req.user.id
      }, dbTx);
    } else if (voucherType === 'PAYMENT_AGENT' || voucherType === 'PAYMENT_TRANSPORTER') {
      const expenseAccount = voucherType === 'PAYMENT_AGENT' ? 'COMMISSION_EXPENSE' : 'FREIGHT_EXPENSE';
      const ledgerType = voucherType === 'PAYMENT_AGENT' ? 'AGENT_COMMISSION' : 'FREIGHT_EXPENSE';

      // Debit Expense, Credit Cash/Bank (balanced double entry)
      // NOTE: posted with partyType INTERNAL — posting the debit against the
      // agent/transporter party would WRONGLY reduce their payable balance.
      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: ledgerType,
        referenceType: 'Payment',
        referenceId: payment.id,
        referenceNumber: paySeq,
        partyType: 'INTERNAL',
        accountType: expenseAccount,
        debitAmount: numAmount,
        creditAmount: 0,
        notes: `Expense booked for disbursement to ${partyName} (voucher ${paySeq})`,
        createdBy: req.user.id
      }, dbTx);

      await LedgerService.postEntry({
        branchId: targetBranchId,
        branchCode: branch.code,
        type: ledgerType,
        referenceType: 'Payment',
        referenceId: payment.id,
        referenceNumber: paySeq,
        partyType,
        partyId,
        partyName,
        accountType: assetAccount,
        debitAmount: 0,
        creditAmount: numAmount,
        notes: `Disbursement to ${partyName}`,
        createdBy: req.user.id
      }, dbTx);
    }

    await dbTx.commit();

    await logAudit({
      req,
      action: 'RECORD_PAYMENT',
      entityName: 'Payment',
      entityId: payment.id,
      entityReference: paySeq,
      afterState: payment.toJSON()
    });

    res.status(201).json({
      success: true,
      message: `Payment voucher ${paySeq} of Rs ${numAmount} recorded successfully`,
      payment
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

module.exports = {
  getPayments,
  createPayment
};
