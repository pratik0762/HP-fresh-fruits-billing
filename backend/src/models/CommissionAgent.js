const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const CommissionAgent = sequelize.define('CommissionAgent', {
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
  defaultCommissionRate: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 5.0, // Percentage e.g. 5.00%
    comment: 'Default percentage commission in fruit mandi'
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'commission_agents',
  timestamps: true
});

module.exports = CommissionAgent;
