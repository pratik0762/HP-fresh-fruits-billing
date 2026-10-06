const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Transaction = sequelize.define('Transaction', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  transactionNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM(
      'PURCHASE',
      'SALE',
      'CUSTOMER_PAYMENT',
      'SUPPLIER_PAYMENT',
      'AGENT_COMMISSION',
      'FREIGHT_EXPENSE',
      'OPERATING_EXPENSE',
      'WASTAGE_LOSS',
      'WEIGHT_ADJUSTMENT',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'REVERSAL'
    ),
    allowNull: false
  },
  referenceType: {
    type: DataTypes.STRING,
    allowNull: true // 'Purchase', 'Sale', 'Payment', 'Expense', 'WastageEntry', 'StockTransfer'
  },
  referenceId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  referenceNumber: {
    type: DataTypes.STRING,
    allowNull: true // e.g. Bill #, Voucher #
  },
  partyType: {
    type: DataTypes.ENUM('CUSTOMER', 'SUPPLIER', 'COMMISSION_AGENT', 'TRANSPORTER', 'INTERNAL'),
    allowNull: false,
    defaultValue: 'INTERNAL'
  },
  partyId: {
    type: DataTypes.INTEGER,
    allowNull: true // ID of customer/supplier/agent if applicable
  },
  partyName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  accountType: {
    type: DataTypes.ENUM(
      'CASH',
      'BANK',
      'ACCOUNTS_RECEIVABLE',
      'ACCOUNTS_PAYABLE',
      'SALES_REVENUE',
      'COST_OF_GOODS_SOLD',
      'COMMISSION_EXPENSE',
      'FREIGHT_EXPENSE',
      'OPERATING_EXPENSE',
      'INVENTORY_ASSET',
      'WASTAGE_LOSS',
      'WEIGHT_LOSS'
    ),
    allowNull: false
  },
  debitAmount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0
  },
  creditAmount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  reversedTransactionId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'If this is a reversal entry, points to original transaction ID'
  },
  isReversed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'transactions',
  timestamps: true,
  indexes: [
    { fields: ['branchId'] },
    { fields: ['partyType', 'partyId'] },
    { fields: ['accountType'] },
    { fields: ['createdAt'] },
    { fields: ['referenceType', 'referenceId'] }
  ]
});

module.exports = Transaction;
