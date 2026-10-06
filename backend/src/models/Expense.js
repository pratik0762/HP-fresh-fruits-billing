const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Expense = sequelize.define('Expense', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  expenseNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  category: {
    type: DataTypes.ENUM(
      'LABOR_PALLEDAR',
      'COLD_STORAGE',
      'MANDI_TAX',
      'ELECTRICITY',
      'RENT',
      'FUEL',
      'PACKAGING',
      'MAINTENANCE',
      'OFFICE_SUPPLIES',
      'OTHER'
    ),
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  paymentMode: {
    type: DataTypes.ENUM('CASH', 'BANK', 'UPI'),
    allowNull: false,
    defaultValue: 'CASH'
  },
  paidTo: {
    type: DataTypes.STRING,
    allowNull: false // e.g. "Azadpur Hamal Union", "Himachal Cold Store Ltd"
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  receiptNo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  expenseDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'expenses',
  timestamps: true,
  indexes: [
    { fields: ['branchId'] },
    { fields: ['category'] },
    { fields: ['expenseDate'] }
  ]
});

module.exports = Expense;
