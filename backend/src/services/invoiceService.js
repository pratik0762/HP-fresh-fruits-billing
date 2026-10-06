const { sequelize } = require('../config/database');

/**
 * Generate truly sequential, gap-less document numbers per branch per year.
 * Examples: PB-DEL-2026-0001, INV-DEL-2026-0001, PAY-SHM-2026-0007
 *
 * Uses an UPSERT with an atomic SQL increment so concurrent requests can never
 * receive the same number. Inside an open transaction (SQLite serializes writes;
 * Postgres row-locks the counter row until commit), this is race-free.
 */
async function generateSequence(prefix, branchCode = 'CORP', transaction = null) {
  const year = new Date().getFullYear();
  const key = `${prefix}-${branchCode}-${year}`;

  const [counter] = await sequelize.query(
    `INSERT INTO counters ("key", "value") VALUES (:key, 1)
     ON CONFLICT ("key") DO UPDATE SET "value" = "counters"."value" + 1
     RETURNING "value"`,
    {
      replacements: { key },
      transaction,
      type: sequelize.QueryTypes.UPSERT
    }
  );

  // Postgres RETURNING gives the row; some dialects/driver combos return nothing
  // for UPSERT type — fall back to a plain SELECT (safe: we're inside the same
  // transaction, and SQLite serializes writers anyway).
  let seq = Array.isArray(counter) ? counter[0]?.value : counter?.value;
  if (seq == null) {
    const rows = await sequelize.query(
      `SELECT "value" FROM counters WHERE "key" = :key`,
      { replacements: { key }, transaction, type: sequelize.QueryTypes.SELECT }
    );
    seq = rows[0]?.value;
  }

  return `${prefix}-${branchCode}-${year}-${String(seq).padStart(4, '0')}`;
}

module.exports = {
  generateSequence
};
