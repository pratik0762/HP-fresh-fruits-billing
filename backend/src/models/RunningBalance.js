const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const RunningBalance = sequelize.define('RunningBalance', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: true // null for company-wide account, or branch specific
  },
  entityType: {
    type: DataTypes.ENUM('CUSTOMER', 'SUPPLIER', 'COMMISSION_AGENT', 'TRANSPORTER', 'CASH', 'BANK', 'ITEM_STOCK'),
    allowNull: false
  },
  entityId: {
    type: DataTypes.INTEGER,
    allowNull: true // Customer/Supplier/Item ID, null for CASH or BANK
  },
  currentBalance: {
    type: DataTypes.DECIMAL(14, 2),
    defaultValue: 0.0,
    comment: 'Receivable/Asset is positive, Payable is negative or vice versa as per standard convention'
  },
  lastTransactionId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  lastUpdated: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'running_balances',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['branchId', 'entityType', 'entityId'] }
  ]
});

module.exports = RunningBalance;
