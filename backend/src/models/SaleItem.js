const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SaleItem = sequelize.define('SaleItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  saleId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  itemId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  quantity: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  returnedQuantity: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'Defective fruit returned by the customer, in line unit (cumulative)'
  },
  unit: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'kg'
  },
  conversionFactor: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 1.0
  },
  weightKg: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'Quantity converted to base kg'
  },
  ratePerUnit: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  discountAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  subtotal: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  cogsAmount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'Landed cost of batches consumed via FIFO'
  },
  profitAmount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'subtotal - cogsAmount'
  }
}, {
  tableName: 'sale_items',
  timestamps: true
});

module.exports = SaleItem;
