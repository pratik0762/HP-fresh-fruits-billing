const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const WastageEntry = sequelize.define('WastageEntry', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  entryNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  itemId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  stockBatchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  quantity: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  unit: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'kg'
  },
  quantityKg: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  costPerKg: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Landed cost per kg from batch'
  },
  totalLossAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'quantityKg * costPerKg, recorded as loss in ledger'
  },
  reason: {
    type: DataTypes.STRING,
    allowNull: false
  },
  actionTaken: {
    type: DataTypes.STRING,
    defaultValue: 'Discarded' // 'Discarded', 'Sold to juice vendor at salvage price', 'Composted'
  },
  salvageRecoveryAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  wasReturned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'TRUE = returned lot from a purchase/return-to-supplier; quantity is ADDED back to stock (reversed WASTAGE_OUT).'
  },
  entryDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'wastage_entries',
  timestamps: true,
  indexes: [
    { fields: ['branchId'] },
    { fields: ['itemId'] },
    { fields: ['stockBatchId'] }
  ]
});

module.exports = WastageEntry;
