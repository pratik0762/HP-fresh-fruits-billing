const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dialect = process.env.DB_DIALECT || 'sqlite';
let sequelize;

if (dialect === 'postgres' || process.env.DATABASE_URL) {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    sequelize = new Sequelize(connectionString, {
      dialect: 'postgres',
      logging: process.env.NODE_ENV === 'development' ? (msg) => console.log('[DB]', msg) : false,
      dialectOptions: {
        ssl: process.env.DB_SSL === 'true' ? { require: true, rejectUnauthorized: false } : false
      },
      pool: {
        max: 20,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    });
  } else {
    sequelize = new Sequelize(
      process.env.DB_NAME || 'fruit_erp',
      process.env.DB_USER || 'postgres',
      process.env.DB_PASSWORD || 'postgres',
      {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: process.env.NODE_ENV === 'development' ? (msg) => console.log('[DB]', msg) : false,
        pool: {
          max: 20,
          min: 0,
          acquire: 30000,
          idle: 10000
        }
      }
    );
  }
} else {
  // SQLite fallback for zero-config local development and testing
  const dbPath = path.resolve(process.env.DB_STORAGE || './data/fruit_erp.sqlite');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false // Keep console clean during transactions
  });
}

module.exports = { sequelize, Sequelize };
