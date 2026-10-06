const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StockBatch = sequelize.define('StockBatch', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  batchNumber: {
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
  purchaseId: {
    type: DataTypes.INTEGER,
    allowNull: true // Can be null for opening stock or transfer in
  },
  initialQuantity: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'Quantity in base unit (e.g. kg)'
  },
  currentQuantity: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'Remaining quantity in base unit (kg)'
  },
  unit: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'kg'
  },
  purchaseRate: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Base purchase rate per base unit'
  },
  landedCostPerUnit: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Landed cost including base rate, freight, commission per base unit'
  },
  receivedDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  expiryDate: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('ACTIVE', 'DEPLETED', 'EXPIRED'),
    defaultValue: 'ACTIVE'
  }
}, {
  tableName: 'stock_batches',
  timestamps: true,
  indexes: [
    { fields: ['branchId', 'itemId', 'status', 'receivedDate'] }
  ]
});

module.exports = StockBatch;
