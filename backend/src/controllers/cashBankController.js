const { Op } = require('sequelize');
const { Transaction, RunningBalance, Branch, sequelize } = require('../models');

const getCashBook = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { startDate, endDate } = req.query;

    const where = { accountType: 'CASH' };
    if (branchId) where.branchId = branchId;
    if (startDate && endDate) {
      where.createdAt = {
        [Op.between]: [new Date(`${startDate}T00:00:00.000Z`), new Date(`${endDate}T23:59:59.999Z`)]
      };
    }

    const cashEntries = await Transaction.findAll({
      where,
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }],
      order: [['createdAt', 'ASC'], ['id', 'ASC']]
    });

    let runningCash = 0;
    const bookRows = cashEntries.map(tx => {
      const debit = parseFloat(tx.debitAmount || 0); // Cash Inflow
      const credit = parseFloat(tx.creditAmount || 0); // Cash Outflow
      runningCash = parseFloat((runningCash + debit - credit).toFixed(2));

      return {
        id: tx.id,
        date: tx.createdAt.toISOString().split('T')[0],
        time: tx.createdAt.toLocaleTimeString(),
        transactionNumber: tx.transactionNumber,
        branchName: tx.branch?.name,
        type: tx.type,
        referenceNumber: tx.referenceNumber,
        partyName: tx.partyName,
        cashIn: debit,
        cashOut: credit,
        runningCashBalance: runningCash,
        notes: tx.notes
      };
    });

    const runningRecord = await RunningBalance.findOne({
      where: {
        entityType: 'CASH',
        ...(branchId ? { branchId } : {})
      }
    });

    res.json({
      success: true,
      currentCashOnHand: runningRecord ? parseFloat(runningRecord.currentBalance) : runningCash,
      entries: bookRows
    });
  } catch (err) {
    next(err);
  }
};

const getBankBook = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { startDate, endDate } = req.query;

    const where = { accountType: 'BANK' };
    if (branchId) where.branchId = branchId;
    if (startDate && endDate) {
      where.createdAt = {
        [Op.between]: [new Date(`${startDate}T00:00:00.000Z`), new Date(`${endDate}T23:59:59.999Z`)]
      };
    }

    const bankEntries = await Transaction.findAll({
      where,
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }],
      order: [['createdAt', 'ASC'], ['id', 'ASC']]
    });

    let runningBank = 0;
    const bookRows = bankEntries.map(tx => {
      const debit = parseFloat(tx.debitAmount || 0); // Deposits / Inflows
      const credit = parseFloat(tx.creditAmount || 0); // Withdrawals / Payouts
      runningBank = parseFloat((runningBank + debit - credit).toFixed(2));

      return {
        id: tx.id,
        date: tx.createdAt.toISOString().split('T')[0],
        time: tx.createdAt.toLocaleTimeString(),
        transactionNumber: tx.transactionNumber,
        branchName: tx.branch?.name,
        type: tx.type,
        referenceNumber: tx.referenceNumber,
        partyName: tx.partyName,
        bankDeposit: debit,
        bankWithdrawal: credit,
        runningBankBalance: runningBank,
        notes: tx.notes
      };
    });

    const runningRecord = await RunningBalance.findOne({
      where: {
        entityType: 'BANK',
        ...(branchId ? { branchId } : {})
      }
    });

    res.json({
      success: true,
      currentBankBalance: runningRecord ? parseFloat(runningRecord.currentBalance) : runningBank,
      entries: bookRows
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCashBook,
  getBankBook
};
