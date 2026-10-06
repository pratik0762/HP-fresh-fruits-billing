const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Customer = sequelize.define('Customer', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  contactPerson: {
    type: DataTypes.STRING,
    allowNull: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  gstNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  creditLimit: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 50000.0,
    comment: 'Max allowed credit receivable balance'
  },
  openingBalance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'Positive means customer owes us (receivable)'
  },
  // Owning branch — non-owner users only ever see parties of their own branch
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'branches', key: 'id' }
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'customers',
  timestamps: true
});

module.exports = Customer;
