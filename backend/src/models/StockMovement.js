const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StockMovement = sequelize.define('StockMovement', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  batchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  itemId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  movementType: {
    type: DataTypes.ENUM('PURCHASE_IN', 'SALE_OUT', 'WASTAGE_OUT', 'RETURN_IN', 'RETURN_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT'),
    allowNull: false
  },
  quantity: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'Quantity in base unit'
  },
  unit: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'kg'
  },
  costPerUnit: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  referenceType: {
    type: DataTypes.STRING,
    allowNull: true // 'Purchase', 'Sale', 'WastageEntry', 'StockTransfer'
  },
  referenceId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  referenceNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'stock_movements',
  timestamps: true,
  indexes: [
    { fields: ['batchId'] },
    { fields: ['branchId', 'itemId'] },
    { fields: ['movementType'] }
  ]
});

module.exports = StockMovement;
