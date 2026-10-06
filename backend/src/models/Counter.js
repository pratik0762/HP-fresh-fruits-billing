const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Atomic per-prefix-per-branch-per-year document counters.
 * Used to generate true gap-less serial numbers like PB-DEL-2026-0001.
 */
const Counter = sequelize.define('Counter', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  key: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: 'e.g. PB-DEL-2026, INV-MUM-2026, PAY-SHM-2026'
  },
  value: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'counters',
  timestamps: false
});

module.exports = Counter;
