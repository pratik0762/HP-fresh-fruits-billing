const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  userName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  userRole: {
    type: DataTypes.STRING,
    allowNull: true
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  action: {
    type: DataTypes.STRING, // 'CREATE_PURCHASE', 'CREATE_SALE', 'RECORD_PAYMENT', 'REVERSE_LEDGER', etc.
    allowNull: false
  },
  entityName: {
    type: DataTypes.STRING, // 'Purchase', 'Sale', 'Transaction', 'Payment', 'WastageEntry'
    allowNull: false
  },
  entityId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  entityReference: {
    type: DataTypes.STRING,
    allowNull: true // Invoice #, Voucher #
  },
  beforeState: {
    type: DataTypes.TEXT, // JSON string
    allowNull: true
  },
  afterState: {
    type: DataTypes.TEXT, // JSON string
    allowNull: true
  },
  ipAddress: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'audit_logs',
  timestamps: true,
  indexes: [
    { fields: ['userId'] },
    { fields: ['branchId'] },
    { fields: ['entityName', 'entityId'] },
    { fields: ['createdAt'] }
  ]
});

module.exports = AuditLog;
