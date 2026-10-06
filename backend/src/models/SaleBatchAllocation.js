const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SaleBatchAllocation = sequelize.define('SaleBatchAllocation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  saleItemId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  stockBatchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  quantityKg: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  costPerKg: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  totalCost: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  }
}, {
  tableName: 'sale_batch_allocations',
  timestamps: true
});

module.exports = SaleBatchAllocation;
