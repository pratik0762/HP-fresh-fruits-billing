const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StockTransfer = sequelize.define('StockTransfer', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  transferNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  fromBranchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  toBranchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  itemId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  quantity: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  unit: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'kg'
  },
  weightKg: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  sourceBatchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  destinationBatchId: {
    type: DataTypes.INTEGER,
    allowNull: true // Created when received
  },
  unitCost: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  transporterId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  vehicleNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  freightCost: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.0
  },
  status: {
    type: DataTypes.ENUM('DISPATCHED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'),
    defaultValue: 'DISPATCHED'
  },
  dispatchedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  receivedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  receivedBy: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'stock_transfers',
  timestamps: true,
  indexes: [
    { fields: ['fromBranchId'] },
    { fields: ['toBranchId'] },
    { fields: ['status'] }
  ]
});

module.exports = StockTransfer;
