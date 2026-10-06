const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const GatePass = sequelize.define('GatePass', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  passNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  branchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  passType: {
    type: DataTypes.ENUM('INWARD', 'OUTWARD'),
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
  purpose: {
    type: DataTypes.ENUM('PURCHASE_DELIVERY', 'SALE_DISPATCH', 'STOCK_TRANSFER', 'EMPTY_CRATES', 'OTHER'),
    allowNull: false
  },
  referenceType: {
    type: DataTypes.STRING,
    allowNull: true // 'Purchase', 'Sale', 'StockTransfer'
  },
  referenceId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  referenceNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  timeIn: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  timeOut: {
    type: DataTypes.DATE,
    allowNull: true
  },
  grossWeightKg: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Loaded vehicle weight on weighbridge (Dharamkanta)'
  },
  tareWeightKg: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Empty vehicle weight'
  },
  netFruitWeightKg: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'gross - tare'
  },
  securityGuardName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('AT_GATE', 'IN_PREMISES', 'EXITED'),
    defaultValue: 'IN_PREMISES'
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
  tableName: 'gate_passes',
  timestamps: true,
  indexes: [
    { fields: ['branchId'] },
    { fields: ['vehicleNumber'] },
    { fields: ['timeIn'] }
  ]
});

module.exports = GatePass;
