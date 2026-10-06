const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PurchaseItem = sequelize.define('PurchaseItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  purchaseId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  itemId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  billedQuantity: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'Quantity in purchase unit (e.g. 100 crates)'
  },
  receivedQuantity: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'Actual received quantity in purchase unit'
  },
  returnedQuantity: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'Defective fruit returned to supplier, in purchase unit (cumulative)'
  },
  unit: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'crate'
  },
  conversionFactor: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 1.0,
    comment: 'Kg per unit (e.g. 20 kg per crate)'
  },
  receivedWeightKg: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'Converted total base weight in kg'
  },
  ratePerUnit: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Rate per purchase unit (e.g. Rs 1200 per crate or Rs 60 per kg)'
  },
  discountAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  subtotal: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  allocatedFreight: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  allocatedCommission: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  allocatedOtherCharges: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  landedCostTotal: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'Subtotal + freight + commission + other - discount'
  },
  landedCostPerKg: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'True landed cost per kg for FIFO valuation'
  },
  batchId: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'purchase_items',
  timestamps: true
});

module.exports = PurchaseItem;
