const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Item = sequelize.define('Item', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  variety: {
    type: DataTypes.STRING,
    allowNull: true // e.g. Royal Delicious, Gala, Kinnow, Alphonso, Kesar
  },
  category: {
    type: DataTypes.STRING,
    defaultValue: 'Fruit'
  },
  baseUnit: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'kg' // 'kg', 'crate', 'box', 'dozen'
  },
  packagingUnit: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'crate' // 'crate', 'box'
  },
  // Free-text pack label shown across the app (PCS, BOX, BAG, GRAMS, KG, TONS, ...)
  packagingUnitLabel: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // How the pack size was entered: 'PCS' | 'g' | 'kg' (preserved for edit round-trip)
  packSizeUnit: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // For PCS-based packs: average grams per piece (1 BOX = 3 PCS × 100 g = 0.3 kg)
  pieceWeightGrams: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  unitConversionFactor: {
    // 4 decimals so gram-level packs fit: 100 g = 0.1 kg, 10 g = 0.01 kg.
    // (SQLite stores this as numeric anyway; Postgres needs a one-time ALTER
    // COLUMN TYPE DECIMAL(10,4) when upgrading an existing DB.)
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    defaultValue: 1.0, // e.g. 1 crate = 20 kg, 1 box = 10 kg
    comment: 'Number of base units in 1 packaging unit (e.g. 20 kg per crate)'
  },
  reorderThreshold: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 100.0 // Alert when total branch stock falls below this in base units
  },
  shelfLifeDays: {
    type: DataTypes.INTEGER,
    defaultValue: 14 // Estimated shelf life for near-expiry calculation
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'items',
  timestamps: true
});

module.exports = Item;
