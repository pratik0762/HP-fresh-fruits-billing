const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Purchase = sequelize.define('Purchase', {
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
  supplierInvoiceNumber: {
    type: DataTypes.STRING,
    allowNull: true // Supplier's own challan / bill number
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  supplierId: {
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
  loadingCharges: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  otherCharges: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  // Weight variance fields
  totalBilledWeight: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'Total weight billed by supplier (in kg)'
  },
  totalReceivedWeight: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'Actual net fruit weight weighed at mandi gate (in kg)'
  },
  weightVariance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'billedWeight - receivedWeight'
  },
  weightVarianceReason: {
    type: DataTypes.STRING,
    allowNull: true // e.g. "Moisture loss during transit", "Decay/leakage in transit", "Empty crates weight deduction"
  },
  weightVarianceLossAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0,
    comment: 'Monetary value of weight difference adjusted/absorbed'
  },
  // Monetary totals
  subtotal: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0
  },
  discountAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  totalAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
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
  purchaseDate: {
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
  tableName: 'purchases',
  timestamps: true,
  indexes: [
    { fields: ['branchId'] },
    { fields: ['supplierId'] },
    { fields: ['purchaseDate'] }
  ]
});

module.exports = Purchase;
