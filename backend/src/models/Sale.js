const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Sale = sequelize.define('Sale', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  invoiceNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  customerId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  hasAgent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  agentId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  agentCommissionRate: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.0
  },
  agentCommissionAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  transporterId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  vehicleNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  freightCharges: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  subtotal: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  discountAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  taxAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  totalAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  totalCogs: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'Total Cost of Goods Sold derived from FIFO batches'
  },
  grossProfit: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'totalAmount - totalCogs - agentCommissionAmount - freight'
  },
  paidAmount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0
  },
  dueAmount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0
  },
  paymentStatus: {
    type: DataTypes.ENUM('PAID', 'PARTIAL', 'PENDING'),
    defaultValue: 'PENDING'
  },
  paymentMode: {
    type: DataTypes.ENUM('CASH', 'BANK', 'UPI', 'CREDIT'),
    defaultValue: 'CREDIT'
  },
  saleDate: {
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
  tableName: 'sales',
  timestamps: true,
  indexes: [
    { fields: ['branchId'] },
    { fields: ['customerId'] },
    { fields: ['saleDate'] }
  ]
});

module.exports = Sale;
