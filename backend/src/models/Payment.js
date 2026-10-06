const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Payment = sequelize.define('Payment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  paymentNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  voucherType: {
    type: DataTypes.ENUM('RECEIPT_CUSTOMER', 'PAYMENT_SUPPLIER', 'PAYMENT_AGENT', 'PAYMENT_TRANSPORTER'),
    allowNull: false
  },
  partyType: {
    type: DataTypes.ENUM('CUSTOMER', 'SUPPLIER', 'COMMISSION_AGENT', 'TRANSPORTER'),
    allowNull: false
  },
  partyId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  paymentMode: {
    type: DataTypes.ENUM('CASH', 'BANK', 'UPI', 'CHEQUE', 'NEFT_RTGS'),
    allowNull: false,
    defaultValue: 'CASH'
  },
  referenceType: {
    type: DataTypes.STRING,
    allowNull: true // 'Sale', 'Purchase', 'OnAccount'
  },
  referenceId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  bankReference: {
    type: DataTypes.STRING,
    allowNull: true // UTR number, Cheque number, Transaction ID
  },
  paymentDate: {
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
  tableName: 'payments',
  timestamps: true,
  indexes: [
    { fields: ['branchId'] },
    { fields: ['partyType', 'partyId'] },
    { fields: ['paymentDate'] }
  ]
});

module.exports = Payment;
