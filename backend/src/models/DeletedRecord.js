const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DeletedRecord = sequelize.define('DeletedRecord', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  entityType: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'SALE, PURCHASE, CUSTOMER, SUPPLIER, ITEM, EXPENSE, PAYMENT, GATE_PASS, WASTAGE, etc.'
  },
  entityId: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  entityReference: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Invoice Number, Bill Number, Party Name, Voucher Number, etc.'
  },
  snapshot: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: 'Full JSON snapshot of the deleted record and all associated child items/allocations'
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  deletedById: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  deletedByName: {
    type: DataTypes.STRING(150),
    allowNull: true
  },
  deletionReason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  deletedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  isPurged: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'deleted_records',
  timestamps: true,
  indexes: [
    { fields: ['entityType'] },
    { fields: ['branchId'] },
    { fields: ['deletedAt'] },
    { fields: ['isPurged'] }
  ]
});

module.exports = DeletedRecord;
