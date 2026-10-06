const { Transaction, RunningBalance, Branch, sequelize } = require('../models');

/**
 * Append-Only Ledger Service
 * Ensures double-entry or balanced single-event immutable audit postings.
 */
class LedgerService {
  /**
   * Post an immutable transaction entry and update running balance transactionally.
   * @param {Object} params
   * @param {Object} dbTx - Sequelize transaction object
   */
  static async postEntry({
    branchId,
    branchCode = 'DEL',
    type,
    referenceType,
    referenceId,
    referenceNumber,
    partyType = 'INTERNAL',
    partyId = null,
    partyName = null,
    accountType,
    debitAmount = 0,
    creditAmount = 0,
    notes = '',
    createdBy,
    reversedTransactionId = null
  }, dbTx) {
    if (!branchId) throw new Error('branchId is required for ledger entry');
    if (!accountType) throw new Error('accountType is required for ledger entry');

    // Generate unique immutable transaction number (ms timestamp + entropy suffix)
    const timestamp = Date.now().toString().slice(-9);
    const rand = Math.floor(1000 + Math.random() * 9000);
    const transactionNumber = `TX-${branchCode}-${new Date().getFullYear()}-${timestamp}-${rand}`;

    const numDebit = parseFloat(debitAmount) || 0;
    const numCredit = parseFloat(creditAmount) || 0;

    // 1. Insert into immutable Transaction table
    const ledgerRow = await Transaction.create({
      transactionNumber,
      branchId,
      type,
      referenceType,
      referenceId,
      referenceNumber,
      partyType,
      partyId,
      partyName,
      accountType,
      debitAmount: numDebit,
      creditAmount: numCredit,
      notes,
      createdBy,
      reversedTransactionId
    }, { transaction: dbTx });

    // 2. Synchronize RunningBalance cache table within the SAME transaction
    await this.updateRunningBalance({
      branchId,
      partyType,
      partyId,
      accountType,
      debitAmount: numDebit,
      creditAmount: numCredit,
      lastTransactionId: ledgerRow.id
    }, dbTx);

    return ledgerRow;
  }

  /**
   * Updates or inserts a row in running_balances
   */
  static async updateRunningBalance({
    branchId,
    partyType,
    partyId,
    accountType,
    debitAmount,
    creditAmount,
    lastTransactionId
  }, dbTx) {
    // Determine entity type for running balance.
    // IMPORTANT: party running balances (receivable/payable) must ONLY be driven by
    // AR/AP account entries. Expense entries tagged with a party (e.g. commission
    // expense) or cash entries tagged with a party must not corrupt the balance.
    let entityType = null;
    let entityId = null;

    const isArApEntry = accountType === 'ACCOUNTS_RECEIVABLE' || accountType === 'ACCOUNTS_PAYABLE';

    if (isArApEntry && partyType === 'CUSTOMER' && partyId) {
      entityType = 'CUSTOMER';
      entityId = partyId;
    } else if (isArApEntry && partyType === 'SUPPLIER' && partyId) {
      entityType = 'SUPPLIER';
      entityId = partyId;
    } else if (isArApEntry && partyType === 'COMMISSION_AGENT' && partyId) {
      entityType = 'COMMISSION_AGENT';
      entityId = partyId;
    } else if (isArApEntry && partyType === 'TRANSPORTER' && partyId) {
      entityType = 'TRANSPORTER';
      entityId = partyId;
    } else if (accountType === 'CASH') {
      entityType = 'CASH';
      entityId = null;
    } else if (accountType === 'BANK') {
      entityType = 'BANK';
      entityId = null;
    }

    if (!entityType) return; // Non-balance sheet items (e.g. sales revenue/expenses don't have a single running balance entity)

    // Calculate balance delta
    // For Customer (Receivable): Debit increases balance, Credit decreases balance
    // For Supplier (Payable): Credit increases balance, Debit decreases balance
    // For Cash & Bank (Asset): Debit increases cash/bank, Credit decreases cash/bank
    let delta = 0;
    if (entityType === 'CUSTOMER' || entityType === 'CASH' || entityType === 'BANK') {
      delta = debitAmount - creditAmount;
    } else if (entityType === 'SUPPLIER' || entityType === 'COMMISSION_AGENT' || entityType === 'TRANSPORTER') {
      delta = creditAmount - debitAmount;
    }

    // Find or create running balance entry with row locking if supported
    let runningRecord = await RunningBalance.findOne({
      where: {
        branchId,
        entityType,
        entityId: entityId || null
      },
      transaction: dbTx,
      lock: dbTx?.LOCK?.UPDATE || false
    });

    if (!runningRecord) {
      await RunningBalance.create({
        branchId,
        entityType,
        entityId: entityId || null,
        currentBalance: delta,
        lastTransactionId,
        lastUpdated: new Date()
      }, { transaction: dbTx });
    } else {
      const current = parseFloat(runningRecord.currentBalance) || 0;
      runningRecord.currentBalance = parseFloat((current + delta).toFixed(2));
      runningRecord.lastTransactionId = lastTransactionId;
      runningRecord.lastUpdated = new Date();
      await runningRecord.save({ transaction: dbTx });
    }
  }

  /**
   * Reverses an existing transaction by inserting an opposing entry referencing it.
   */
  static async reverseTransaction(transactionId, reason, userId, dbTx) {
    const original = await Transaction.findByPk(transactionId, { transaction: dbTx });
    if (!original) throw new Error('Transaction not found');
    if (original.isReversed) throw new Error('Transaction is already reversed');

    // Mark original as reversed
    original.isReversed = true;
    await original.save({ transaction: dbTx });

    // Post reversing entry with swapped debit/credit
    const branch = await Branch.findByPk(original.branchId, { transaction: dbTx });
    const reversingEntry = await this.postEntry({
      branchId: original.branchId,
      branchCode: branch ? branch.code : 'DEL',
      type: 'REVERSAL',
      referenceType: original.referenceType,
      referenceId: original.referenceId,
      referenceNumber: original.referenceNumber,
      partyType: original.partyType,
      partyId: original.partyId,
      partyName: original.partyName,
      accountType: original.accountType,
      debitAmount: original.creditAmount, // Swapped
      creditAmount: original.debitAmount, // Swapped
      notes: `Reversal of ${original.transactionNumber}. Reason: ${reason}`,
      createdBy: userId,
      reversedTransactionId: original.id
    }, dbTx);

    return reversingEntry;
  }

  /**
   * Audit-Trail Guarantee: Recomputes a party or account balance directly from the raw ledger rows.
   * This proves that the running balance matches the append-only ledger history 1:1.
   */
  static async recalculateFromLedger(branchId, entityType, entityId) {
    let whereClause = {};
    if (branchId) whereClause.branchId = branchId;

    // Only AR/AP entries drive party balances (mirrors updateRunningBalance)
    if (entityType === 'CUSTOMER') {
      whereClause.partyType = 'CUSTOMER';
      whereClause.partyId = entityId;
      whereClause.accountType = 'ACCOUNTS_RECEIVABLE';
      const txs = await Transaction.findAll({ where: whereClause });
      let balance = 0;
      for (const tx of txs) {
        balance += (parseFloat(tx.debitAmount) - parseFloat(tx.creditAmount));
      }
      return parseFloat(balance.toFixed(2));
    } else if (entityType === 'SUPPLIER') {
      whereClause.partyType = 'SUPPLIER';
      whereClause.partyId = entityId;
      whereClause.accountType = 'ACCOUNTS_PAYABLE';
      const txs = await Transaction.findAll({ where: whereClause });
      let balance = 0;
      for (const tx of txs) {
        balance += (parseFloat(tx.creditAmount) - parseFloat(tx.debitAmount));
      }
      return parseFloat(balance.toFixed(2));
    } else if (entityType === 'COMMISSION_AGENT' || entityType === 'TRANSPORTER') {
      whereClause.partyType = entityType;
      whereClause.partyId = entityId;
      whereClause.accountType = 'ACCOUNTS_PAYABLE';
      const txs = await Transaction.findAll({ where: whereClause });
      let balance = 0;
      for (const tx of txs) {
        balance += (parseFloat(tx.creditAmount) - parseFloat(tx.debitAmount));
      }
      return parseFloat(balance.toFixed(2));
    } else if (entityType === 'CASH') {
      whereClause.accountType = 'CASH';
      const txs = await Transaction.findAll({ where: whereClause });
      let balance = 0;
      for (const tx of txs) {
        balance += (parseFloat(tx.debitAmount) - parseFloat(tx.creditAmount));
      }
      return parseFloat(balance.toFixed(2));
    } else if (entityType === 'BANK') {
      whereClause.accountType = 'BANK';
      const txs = await Transaction.findAll({ where: whereClause });
      let balance = 0;
      for (const tx of txs) {
        balance += (parseFloat(tx.debitAmount) - parseFloat(tx.creditAmount));
      }
      return parseFloat(balance.toFixed(2));
    }
    return 0;
  }
}

module.exports = LedgerService;
