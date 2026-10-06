const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Supplier = sequelize.define('Supplier', {
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
  openingBalance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0.0,
    comment: 'Positive means we owe supplier (payable)'
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
  tableName: 'suppliers',
  timestamps: true
});

module.exports = Supplier;
