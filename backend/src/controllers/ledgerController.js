const { Op } = require('sequelize');
const { Transaction, RunningBalance, Customer, Supplier, Branch, sequelize } = require('../models');
const LedgerService = require('../services/ledgerService');
const { logAudit } = require('../middleware/audit');

const getStatement = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { partyType, partyId, startDate, endDate } = req.query;

    if (!partyType || !partyId) {
      return res.status(400).json({ success: false, message: 'partyType and partyId are required.' });
    }

    let partyInfo = null;
    if (partyType === 'CUSTOMER') {
      partyInfo = await Customer.findByPk(partyId);
    } else if (partyType === 'SUPPLIER') {
      partyInfo = await Supplier.findByPk(partyId);
    }

    if (!partyInfo) {
      return res.status(404).json({ success: false, message: `${partyType} not found.` });
    }

    // Party isolation: non-owners can only view statements of their own branch's parties
    if (req.user.role !== 'OWNER' && partyInfo.branchId && partyInfo.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Access denied: this party belongs to another branch.' });
    }

    const where = {
      partyType,
      partyId: parseInt(partyId)
    };
    if (branchId) where.branchId = branchId;

    // Fetch transactions
    const allTxs = await Transaction.findAll({
      where,
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }],
      order: [['createdAt', 'ASC'], ['id', 'ASC']]
    });

    let running = parseFloat(partyInfo.openingBalance || 0);
    const openingBal = running;
    const statementRows = [];

    for (const tx of allTxs) {
      const debit = parseFloat(tx.debitAmount || 0);
      const credit = parseFloat(tx.creditAmount || 0);

      if (partyType === 'CUSTOMER') {
        // Customer: Debit increases receivable (customer owes us), Credit reduces it
        running = parseFloat((running + debit - credit).toFixed(2));
      } else {
        // Supplier: Credit increases payable (we owe supplier), Debit reduces it
        running = parseFloat((running + credit - debit).toFixed(2));
      }

      // Filter by date range if specified, but preserve running balance accurately
      const txDate = tx.createdAt.toISOString().split('T')[0];
      let inRange = true;
      if (startDate && txDate < startDate) inRange = false;
      if (endDate && txDate > endDate) inRange = false;

      if (inRange) {
        statementRows.push({
          id: tx.id,
          transactionNumber: tx.transactionNumber,
          branchName: tx.branch?.name,
          date: txDate,
          type: tx.type,
          referenceType: tx.referenceType,
          referenceId: tx.referenceId,
          referenceNumber: tx.referenceNumber,
          accountType: tx.accountType,
          debitAmount: debit,
          creditAmount: credit,
          runningBalance: running,
          isReversed: tx.isReversed,
          notes: tx.notes
        });
      }
    }

    // Fast-lookup balance from running_balances table
    const runningBalRecord = await RunningBalance.findOne({
      where: {
        entityType: partyType,
        entityId: parseInt(partyId),
        ...(branchId ? { branchId } : {})
      }
    });

    res.json({
      success: true,
      party: {
        id: partyInfo.id,
        name: partyInfo.name,
        contactPerson: partyInfo.contactPerson,
        phone: partyInfo.phone,
        address: partyInfo.address,
        openingBalance: openingBal,
        currentBalance: runningBalRecord ? parseFloat(runningBalRecord.currentBalance) : running
      },
      summary: {
        openingBalance: openingBal,
        closingBalance: running,
        totalEntries: statementRows.length
      },
      statement: statementRows
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Audit Trail Verification
 * Directly aggregates raw ledger table to verify against the running_balances cache
 */
const verifyLedgerIntegrity = async (req, res, next) => {
  try {
    let { entityType, entityId } = req.query;

    if (!entityType) {
      return res.status(400).json({ success: false, message: 'entityType is required (CUSTOMER, SUPPLIER, COMMISSION_AGENT, TRANSPORTER, CASH, BANK).' });
    }

    // Branch isolation: non-owners are always locked to their own branch's ledger.
    // The branchId query param is IGNORED for them — they can never audit another branch.
    let branchId;
    if (req.user.role !== 'OWNER') {
      branchId = req.user.branchId;
    } else {
      branchId = req.query.branchId; // owner may audit any or all branches
    }

    // CASH/BANK have no entity id — a stray entityId would make the cached lookup
    // find nothing and report a false discrepancy.
    if (entityType === 'CASH' || entityType === 'BANK') {
      entityId = null;
    } else if (!entityId) {
      return res.status(400).json({ success: false, message: `entityId is required for entityType ${entityType}.` });
    }

    const computedFromLedger = await LedgerService.recalculateFromLedger(
      branchId ? parseInt(branchId) : null,
      entityType,
      entityId ? parseInt(entityId) : null
    );

    // Aggregate cached balances across all matching rows (per-branch rows exist).
    // Comparing a single-branch row against an all-branch ledger sum would be
    // apples vs oranges when multiple branches post to the same entity/account.
    const runningRecords = await RunningBalance.findAll({
      where: {
        entityType,
        entityId: entityId ? parseInt(entityId) : null,
        ...(branchId ? { branchId: parseInt(branchId) } : {})
      }
    });

    const cachedBalance = runningRecords.reduce(
      (sum, r) => parseFloat((sum + parseFloat(r.currentBalance || 0)).toFixed(2)),
      0
    );
    const isMatch = Math.abs(computedFromLedger - cachedBalance) < 0.01;

    res.json({
      success: true,
      isMatch,
      verified: isMatch,
      entityType,
      entityId,
      branchId: branchId || 'All',
      computedFromRawLedger: computedFromLedger,
      cachedRunningBalance: cachedBalance,
      discrepancy: parseFloat((computedFromLedger - cachedBalance).toFixed(2)),
      message: isMatch 
        ? 'Audit integrity verified: running balance matches 100% of immutable ledger entries.' 
        : 'Audit discrepancy detected. Please reconcile.'
    });
  } catch (err) {
    next(err);
  }
};

const reverseTransaction = async (req, res, next) => {
  const dbTx = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Please provide a valid reason for ledger reversal.' });
    }

    // Branch isolation: non-owners may only reverse entries posted on their own branch
    const targetEntry = await Transaction.findByPk(parseInt(id));
    if (!targetEntry) {
      return res.status(404).json({ success: false, message: 'Ledger transaction not found.' });
    }
    if (req.user.role !== 'OWNER' && targetEntry.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Access denied: ledger entry belongs to another branch.' });
    }

    const reversingEntry = await LedgerService.reverseTransaction(
      parseInt(id),
      reason,
      req.user.id,
      dbTx
    );

    await dbTx.commit();

    await logAudit({
      req,
      action: 'REVERSE_LEDGER_TRANSACTION',
      entityName: 'Transaction',
      entityId: parseInt(id),
      entityReference: reversingEntry.transactionNumber,
      afterState: { reversedId: id, reversingTransactionNumber: reversingEntry.transactionNumber, reason }
    });

    res.json({
      success: true,
      message: `Transaction reversed successfully via reversing entry ${reversingEntry.transactionNumber}`,
      reversingEntry
    });
  } catch (err) {
    await dbTx.rollback();
    next(err);
  }
};

module.exports = {
  getStatement,
  verifyLedgerIntegrity,
  reverseTransaction
};
