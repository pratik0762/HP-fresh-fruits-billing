const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Transporter = sequelize.define('Transporter', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  vehicleNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },
  driverName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  driverPhone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  transportCompany: {
    type: DataTypes.STRING,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'transporters',
  timestamps: true
});

module.exports = Transporter;
