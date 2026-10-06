/**
 * Database Admin Controller
 * -------------------------
 * Token-gated read-only database access for the browser.
 * Requires a valid JWT of an OWNER or ACCOUNTANT user, and DB_ADMIN_TOKEN
 * (a second secret) to be provided via header or query string.
 *
 * Endpoints (mounted under /api/db-admin by src/routes/dbAdminRoutes.js):
 *   GET  /schema            → list of tables with row counts and column info
 *   GET  /table/:name       → paginated rows of one table (with search + sort)
 *   GET  /query?sql=...     → run a read-only SELECT / PRAGMA query
 *   GET  /meta              → connection info (dialect, storage/host, db name)
 */
const { sequelize, DeletedRecord, Branch } = require('../models');
const { QueryTypes } = require('sequelize');
const jwt = require('jsonwebtoken');

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Only these statement types are allowed for the free-form query box. */
const ALLOWED_PREFIXES = ['SELECT', 'PRAGMA', 'WITH'];

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    ''
  );
}

/**
 * Double gate: 1) a valid JWT belonging to an active OWNER or ACCOUNTANT,
 * 2) the DB_ADMIN_TOKEN secret from backend/.env.
 */
async function requireDbAdmin(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    const decoded = jwt.verify(
      header.split(' ')[1],
      process.env.JWT_SECRET || 'super_secret_jwt_key_hp_fresh_fruits_erp_2026_ledger'
    );

    // NOTE: with QueryTypes.SELECT, sequelize returns the rows array directly.
    const userRows = await sequelize.query(
      'SELECT id, name, email, role, isActive FROM users WHERE id = ?',
      { replacements: [decoded.id], type: QueryTypes.SELECT }
    );
    const user = userRows[0];
    if (!user || !user.isActive || !['OWNER', 'ACCOUNTANT'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Owner or Accountant role required.' });
    }

    const provided = req.headers['x-db-admin-token'] || req.query.token;
    if (!process.env.DB_ADMIN_TOKEN || provided !== process.env.DB_ADMIN_TOKEN) {
      return res.status(403).json({ success: false, message: 'Invalid or missing DB_ADMIN_TOKEN.' });
    }

    req.dbAdminUser = user;
    next();
  } catch (err) {
    console.error('[db-admin] auth error:', err.name, '-', err.message);
    return res.status(401).json({
      success: false,
      message: err.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid authentication token.'
    });
  }
}

/** Table names + row counts + column metadata. */
async function getSchema(req, res) {
  try {
    const dialect = sequelize.getDialect();
    const qi = sequelize.getQueryInterface();
    const tableNames = await qi.showAllTables();

    const tables = [];
    for (const name of tableNames) {
      let count = 0;
      try {
        const countRows = await sequelize.query(`SELECT COUNT(*) AS c FROM "${name}"`, { type: QueryTypes.SELECT });
        count = countRows[0]?.c ?? 0;
      } catch (e) {
        count = -1;
      }
      let columns = [];
      try {
        const described = await qi.describeTable(name);
        columns = Object.entries(described).map(([cname, meta]) => ({
          name: cname,
          type: meta.type,
          allowNull: meta.allowNull,
          defaultValue: meta.defaultValue,
          primaryKey: meta.primaryKey
        }));
      } catch (e) {
        columns = [];
      }
      tables.push({ name, rowCount: count, columns });
    }

    return res.json({ success: true, dialect, tableCount: tables.length, tables });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** Browse one table with pagination, optional search and ordering. */
async function browseTable(req, res) {
  try {
    const name = req.params.name;
    if (!IDENT_RE.test(name)) {
      return res.status(400).json({ success: false, message: 'Invalid table name.' });
    }
    const qi = sequelize.getQueryInterface();
    const allTables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName || t.name));
    if (!allTables.includes(name)) {
      return res.status(404).json({ success: false, message: `Table "${name}" not found.` });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const offset = (page - 1) * pageSize;
    const search = (req.query.search || '').toString().slice(0, 200);
    const sortCol = (req.query.sort || '').toString();
    const sortDir = (req.query.dir || 'ASC').toString().toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const cols = Object.keys(await qi.describeTable(name));
    let where = '';
    const replacements = {};
    if (search) {
      const clauses = cols.map((c) => {
        replacements[`s_${c}`] = `%${search}%`;
        return `CAST("${c}" AS TEXT) LIKE :s_${c}`;
      });
      where = `WHERE ${clauses.join(' OR ')}`;
    }
    let order = '';
    if (sortCol && cols.includes(sortCol)) {
      order = `ORDER BY "${sortCol}" ${sortDir}`;
    }

    const totalRows = await sequelize.query(`SELECT COUNT(*) AS c FROM "${name}" ${where}`, { replacements, type: QueryTypes.SELECT });
    const total = totalRows[0]?.c ?? 0;
    const rows = await sequelize.query(
      `SELECT * FROM "${name}" ${where} ${order} LIMIT ${pageSize} OFFSET ${offset}`,
      { replacements, type: QueryTypes.SELECT }
    );

    return res.json({
      success: true,
      table: name,
      page,
      pageSize,
      totalRows: total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      rows
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** Run a read-only query (SELECT / PRAGMA / WITH). Postgres is wrapped in a
 *  read-only transaction so even a smuggled UPDATE cannot commit. */
async function runQuery(req, res) {
  try {
    const sql = (req.query.sql || '').toString().trim();
    if (!sql) {
      return res.status(400).json({ success: false, message: 'Provide ?sql=...' });
    }
    if (sql.includes(';') && !/;\s*$/.test(sql)) {
      return res.status(400).json({ success: false, message: 'Multiple statements are not allowed.' });
    }
    const normalized = sql.replace(/;\s*$/, '');
    const firstWord = normalized.split(/\s+/)[0].toUpperCase();
    if (!ALLOWED_PREFIXES.includes(firstWord)) {
      return res.status(400).json({
        success: false,
        message: `Only read-only queries are allowed (${ALLOWED_PREFIXES.join(', ')}). Got: ${firstWord}`
      });
    }

    const dialect = sequelize.getDialect();
    let rows, durationMs;
    const started = Date.now();

    if (dialect === 'postgres') {
      await sequelize.query('BEGIN READ ONLY');
      try {
        rows = await sequelize.query(normalized, { type: QueryTypes.SELECT });
        await sequelize.query('COMMIT');
      } catch (e) {
        await sequelize.query('ROLLBACK');
        throw e;
      }
    } else {
      rows = await sequelize.query(normalized, { type: QueryTypes.SELECT });
    }
    durationMs = Date.now() - started;

    return res.json({
      success: true,
      sql: normalized,
      dialect,
      rowCount: rows.length,
      durationMs,
      rows: rows.slice(0, 500)
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

/** Connection metadata for the UI header. */
async function getMeta(req, res) {
  return res.json({
    success: true,
    dialect: sequelize.getDialect(),
    database: sequelize.getDatabaseName(),
    storage: process.env.DB_STORAGE || null,
    host: process.env.DB_HOST || (sequelize.getDialect() === 'postgres' ? 'localhost' : 'file'),
    nodeEnv: process.env.NODE_ENV || 'development'
  });
}

/** Get all archived deleted records with pagination and filtering */
async function getDeletedRecords(req, res) {
  try {
    const { entityType, search, page = 1, pageSize = 50 } = req.query;
    const where = {};
    if (entityType && entityType !== 'ALL') {
      where.entityType = entityType.toUpperCase();
    }
    if (search) {
      where[sequelize.Sequelize.Op.or] = [
        { entityReference: { [sequelize.Sequelize.Op.like]: `%${search}%` } },
        { entityType: { [sequelize.Sequelize.Op.like]: `%${search}%` } },
        { deletedByName: { [sequelize.Sequelize.Op.like]: `%${search}%` } }
      ];
    }

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(pageSize, 10));
    const limit = Math.min(200, Math.max(1, parseInt(pageSize, 10)));

    const { count, rows } = await DeletedRecord.findAndCountAll({
      where,
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }],
      order: [['deletedAt', 'DESC'], ['id', 'DESC']],
      limit,
      offset
    });

    return res.json({
      success: true,
      total: count,
      page: parseInt(page, 10),
      totalPages: Math.ceil(count / limit) || 1,
      records: rows
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** Get full JSON snapshot of a single deleted record */
async function getDeletedRecordById(req, res) {
  try {
    const record = await DeletedRecord.findByPk(req.params.id, {
      include: [{ model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }]
    });
    if (!record) return res.status(404).json({ success: false, message: 'Deleted record backup not found.' });
    return res.json({ success: true, record });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** Permanently purge a single backup record from the backend (Owner only) */
async function purgeDeletedRecord(req, res) {
  try {
    if (req.dbAdminUser.role !== 'OWNER') {
      return res.status(403).json({ success: false, message: 'Only the Owner can permanently purge deleted backup data.' });
    }
    const record = await DeletedRecord.findByPk(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Backup record not found.' });
    await record.destroy();
    return res.json({ success: true, message: `Backup record #${req.params.id} permanently purged.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** Permanently purge all backup records or by filter (Owner only) */
async function purgeAllDeletedRecords(req, res) {
  try {
    if (req.dbAdminUser.role !== 'OWNER') {
      return res.status(403).json({ success: false, message: 'Only the Owner can permanently purge deleted backup data.' });
    }
    const { entityType } = req.query;
    const where = {};
    if (entityType && entityType !== 'ALL') {
      where.entityType = entityType.toUpperCase();
    }
    const purgedCount = await DeletedRecord.destroy({ where });
    return res.json({ success: true, message: `Successfully purged ${purgedCount} backup records.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  requireDbAdmin,
  getSchema,
  browseTable,
  runQuery,
  getMeta,
  getDeletedRecords,
  getDeletedRecordById,
  purgeDeletedRecord,
  purgeAllDeletedRecords
};
