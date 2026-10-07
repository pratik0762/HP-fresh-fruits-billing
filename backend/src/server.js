const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Ensure critical defaults exist even without a .env file on fresh installations
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_hp_fresh_fruits_erp_2026_ledger';
process.env.DB_ADMIN_TOKEN = process.env.DB_ADMIN_TOKEN || '07f5d67ab4c75c5628bf0d058771c455d5fe327410bc3ac5';
process.env.DB_DIALECT = process.env.DB_DIALECT || 'sqlite';
process.env.DB_STORAGE = process.env.DB_STORAGE || './data/fruit_erp.sqlite';

const bcrypt = require('bcryptjs');
const { sequelize, User, Branch } = require('./models');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const saleRoutes = require('./routes/saleRoutes');
const stockRoutes = require('./routes/stockRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');
const cashBankRoutes = require('./routes/cashBankRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const gatePassRoutes = require('./routes/gatePassRoutes');
const masterRoutes = require('./routes/masterRoutes');
const reportRoutes = require('./routes/reportRoutes');
const dbAdminRoutes = require('./routes/dbAdminRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
// Note: origin '*' cannot be combined with credentials:true (browsers reject it).
// Reflect the request origin instead so credentials work from any dev/prod frontend.
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    system: 'HP Fresh Fruits ERP Backend',
    timestamp: new Date().toISOString(),
    database: process.env.DB_DIALECT || 'sqlite',
    dbAdmin: '/db-admin'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/ledgers', ledgerRoutes);
app.use('/api/cash-bank', cashBankRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/gate-passes', gatePassRoutes);
app.use('/api/masters', masterRoutes);
app.use('/api/reports', reportRoutes);

// Browser-based database admin UI (read-only, double-gated)
app.get('/db-admin', (req, res) => res.sendFile(path.join(__dirname, 'admin-ui.html')));
app.use('/api/db-admin', dbAdminRoutes);

// Serve frontend production build when available (e.g., Hostinger / single-server deployments)
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/db-admin')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Error Handler
app.use(errorHandler);

// Start Server & Sync Database
async function startServer() {
  try {
    await sequelize.authenticate();
    console.log(`[Database] Connection established successfully (${process.env.DB_DIALECT || 'sqlite'}).`);

    // Sync database tables without destroying existing records.
    // NOTE: `alter: true` must NOT be used with SQLite — it hangs rebuilding
    // every table and can corrupt ENUM-heavy schemas. Only enable it explicitly
    // (DB_SYNC_ALTER=true) against Postgres when you intentionally want it.
    const useAlter = process.env.DB_SYNC_ALTER === 'true' && (process.env.DB_DIALECT || 'sqlite') === 'postgres';
    await sequelize.sync({ alter: useAlter });

    // Lightweight additive migration for SQLite (sync without alter never adds
    // new columns): packagingUnitLabel backs the PCS/BOX/BAG/GRAMS/KG/TONS unit picker;
    // packSizeUnit/pieceWeightGrams support PCS-based packs (1 BOX = 3 PCS × 100 g).
    if ((process.env.DB_DIALECT || 'sqlite') !== 'postgres') {
      const [itemsCols] = await sequelize.query("PRAGMA table_info(items)");
      const colNames = new Set(itemsCols.map(c => c.name));
      if (!colNames.has('packagingUnitLabel')) {
        await sequelize.query("ALTER TABLE items ADD COLUMN packagingUnitLabel VARCHAR(255)");
        console.log('[Migration] Added items.packagingUnitLabel column.');
      }
      if (!colNames.has('packSizeUnit')) {
        await sequelize.query("ALTER TABLE items ADD COLUMN packSizeUnit VARCHAR(255)");
        console.log('[Migration] Added items.packSizeUnit column.');
      }
      if (!colNames.has('pieceWeightGrams')) {
        await sequelize.query("ALTER TABLE items ADD COLUMN pieceWeightGrams DECIMAL(10,2)");
        console.log('[Migration] Added items.pieceWeightGrams column.');
      }

      // Branch-scoped parties: customers & suppliers belong to a branch so each
      // branch only sees its own contacts.
      const [custCols] = await sequelize.query("PRAGMA table_info(customers)");
      if (!custCols.some(c => c.name === 'branchId')) {
        await sequelize.query("ALTER TABLE customers ADD COLUMN branchId INTEGER REFERENCES branches(id)");
        console.log('[Migration] Added customers.branchId column.');
      }
      const [suppCols] = await sequelize.query("PRAGMA table_info(suppliers)");
      if (!suppCols.some(c => c.name === 'branchId')) {
        await sequelize.query("ALTER TABLE suppliers ADD COLUMN branchId INTEGER REFERENCES branches(id)");
        console.log('[Migration] Added suppliers.branchId column.');
      }

      // Defective-goods returns: each bill/invoice line tracks its cumulative
      // returned quantity so Edit forms can pre-fill the return field and the
      // backend only applies the delta on every save.
      const [piCols] = await sequelize.query("PRAGMA table_info(purchase_items)");
      if (!piCols.some(c => c.name === 'returnedQuantity')) {
        await sequelize.query("ALTER TABLE purchase_items ADD COLUMN returnedQuantity DECIMAL(12,2) DEFAULT 0");
        console.log('[Migration] Added purchase_items.returnedQuantity column.');
      }
      const [siCols] = await sequelize.query("PRAGMA table_info(sale_items)");
      if (!siCols.some(c => c.name === 'returnedQuantity')) {
        await sequelize.query("ALTER TABLE sale_items ADD COLUMN returnedQuantity DECIMAL(12,2) DEFAULT 0");
        console.log('[Migration] Added sale_items.returnedQuantity column.');
      }
      const [weCols] = await sequelize.query("PRAGMA table_info(wastage_entries)");
      if (!weCols.some(c => c.name === 'wasReturned')) {
        await sequelize.query("ALTER TABLE wastage_entries ADD COLUMN wasReturned BOOLEAN DEFAULT 0");
        console.log('[Migration] Added wastage_entries.wasReturned column.');
      }

    }

    // ---------------------------------------------------------------------
    // PERFORMANCE BOOTSTRAP (SQLite)
    // 1. WAL journal + synchronous=NORMAL: readers never block the writer and
    //    commits stop fsync-ing every write — the single biggest latency win.
    // 2. Model-defined indexes only get created when a table is first built;
    //    an existing database never receives them. CREATE INDEX IF NOT EXISTS
    //    backfills every hot-path index cheaply at boot.
    // ---------------------------------------------------------------------
    if ((process.env.DB_DIALECT || 'sqlite') !== 'postgres') {
      await sequelize.query('PRAGMA journal_mode = WAL;');
      await sequelize.query('PRAGMA synchronous = NORMAL;');
      await sequelize.query('PRAGMA temp_store = MEMORY;');
      await sequelize.query('PRAGMA cache_size = -16000;'); // ~16 MB page cache

      const hotPathIndexes = [
        // Dashboard: today totals + trend charts + aging report
        'CREATE INDEX IF NOT EXISTS idx_sales_branch_date ON sales (branchId, saleDate)',
        'CREATE INDEX IF NOT EXISTS idx_sales_paystatus ON sales (branchId, paymentStatus)',
        'CREATE INDEX IF NOT EXISTS idx_purchases_branch_date ON purchases (branchId, purchaseDate)',
        'CREATE INDEX IF NOT EXISTS idx_purchases_paystatus ON purchases (branchId, paymentStatus)',
        // P&L: expenses / wastage scans by branch + date
        'CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON expenses (branchId, expenseDate)',
        'CREATE INDEX IF NOT EXISTS idx_wastage_branch_date ON wastage_entries (branchId, entryDate)',
        // Ledger: party statement scans
        'CREATE INDEX IF NOT EXISTS idx_transactions_party ON transactions (partyType, partyId, createdAt)',
        'CREATE INDEX IF NOT EXISTS idx_payments_branch_date ON payments (branchId, paymentDate)',
        // Sale line items / allocations looked up per invoice
        'CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (saleId)',
        'CREATE INDEX IF NOT EXISTS idx_sale_alloc_item ON sale_batch_allocations (saleItemId)',
        'CREATE INDEX IF NOT EXISTS idx_stock_movements_batch ON stock_movements (batchId)'
      ];
      for (const ddl of hotPathIndexes) {
        try {
          await sequelize.query(ddl);
        } catch (e) {
          // A missing table (fresh DB mid-sync) should never block boot —
          // model-defined indexes cover those tables anyway.
          console.warn('[Startup] index skip:', e.message);
        }
      }
      console.log('[Database] SQLite tuned (WAL) + hot-path indexes verified.');
    }

    console.log('[Database] Models synchronized.');

    // Auto-bootstrap Owner account and default branch on fresh/cloned databases
    try {
      let branch = await Branch.findOne({ where: { isActive: true } });
      if (!branch) {
        branch = await Branch.create({
          name: 'surat branch',
          code: 'SUR',
          location: 'motavarachha surat',
          address: 'Near APMC Fruit Market, Mota Varachha, Surat',
          phone: '1234567890',
          isActive: true
        });
        console.log('[Bootstrap] Initialized default branch: surat branch (SUR)');
      }

      const owner = await User.findOne({ where: { email: 'owner@hpfruits.com' } });
      if (!owner) {
        const passwordHash = await bcrypt.hash('admin123', 10);
        await User.create({
          name: 'Harshil Patel (Managing Director)',
          email: 'owner@hpfruits.com',
          passwordHash,
          role: 'OWNER',
          branchId: branch ? branch.id : 1,
          phone: '+91 98100 11223',
          isActive: true
        });
        console.log('[Bootstrap] Initialized default Owner account: owner@hpfruits.com / admin123');
      }
    } catch (bootstrapErr) {
      console.warn('[Bootstrap] Auto-bootstrap notice:', bootstrapErr.message);
    }

    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 HP Fresh Fruits ERP Backend running on port ${PORT}`);
      console.log(`🔗 API Base: http://localhost:${PORT}/api`);
      console.log(`====================================================`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

module.exports = { app, sequelize };
