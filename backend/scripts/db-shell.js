/**
 * Interactive SQL shell — CLI access to the ERP database.
 *
 *   npm run db-shell            (from backend/)
 *   node scripts/db-shell.js "SELECT * FROM branches"
 *
 * Read-only by default: SELECT / PRAGMA / WITH / EXPLAIN.
 * Pass --write to allow INSERT/UPDATE/DELETE (use with care).
 */
require('dotenv').config();
const readline = require('readline');
const { sequelize } = require('../src/models');

const WRITABLE = process.argv.includes('--write');
const oneShot = process.argv.filter((a, i) => i > 1 && !a.startsWith('--')).join(' ').trim();

const BOLD = '\x1b[1m', DIM = '\x1b[2m', CYAN = '\x1b[36m', RED = '\x1b[31m', GREEN = '\x1b[32m', RESET = '\x1b[0m';

function firstKeyword(sql) {
  return sql.trim().split(/\s+/)[0].toUpperCase();
}

async function execute(sql) {
  const kw = firstKeyword(sql);
  const readOnly = ['SELECT', 'PRAGMA', 'WITH', 'EXPLAIN'].includes(kw);
  if (!readOnly && !WRITABLE) {
    throw new Error(`Read-only shell. Use --write to allow ${kw}.`);
  }
  const started = Date.now();
  const rows = await sequelize.query(sql, { type: kw === 'SELECT' ? require('sequelize').QueryTypes.SELECT : undefined });
  const ms = Date.now() - started;
  return { rows, ms };
}

function printRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`${DIM}(no rows)${RESET}`);
    return;
  }
  const flat = Array.isArray(rows[0]) ? rows[0] : rows;
  const isObjects = flat.length > 0 && typeof flat[0] === 'object' && flat[0] !== null;
  if (!isObjects) {
    console.log(rows);
    return;
  }
  const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  const cells = flat.map((r) => cols.map((c) => (r[c] === null || r[c] === undefined ? 'NULL' : String(r[c]))));
  const widths = cols.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)).slice ? Math.max(c.length, ...cells.map((r) => r[i].length)) : c.length);
  const w = cols.map((c, i) => Math.max(c.length, ...cells.map((r) => Math.min(60, r[i].length))));
  const line = (l, m, r2) => l + w.map((n) => '─'.repeat(n + 2)).join(m) + r2;
  const fmt = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s).padEnd(n);
  console.log(line('┌', '┬', '┐'));
  console.log('│ ' + cols.map((c, i) => `${BOLD}${fmt(c, w[i])}${RESET}`).join(' │ ') + ' │');
  console.log(line('├', '┼', '┤'));
  for (const r of cells) console.log('│ ' + r.map((v, i) => fmt(v, w[i])).join(' │ ') + ' │');
  console.log(line('└', '┴', '┘'));
  console.log(`${DIM}${flat.length} row(s)${RESET}`);
}

async function main() {
  await sequelize.authenticate();
  const dialect = sequelize.getDialect();
  const target = dialect === 'sqlite'
    ? `sqlite:${process.env.DB_STORAGE || './data/fruit_erp.sqlite'}`
    : `${dialect}:${sequelize.getDatabaseName()}@${process.env.DB_HOST || 'localhost'}`;

  console.log(`${CYAN}${BOLD}HP Fresh Fruits ERP — SQL shell${RESET}`);
  console.log(`${DIM}${target} · mode: ${WRITABLE ? RED + 'READ-WRITE' + RESET + DIM : GREEN + 'READ-ONLY' + RESET + DIM + ' (pass --write for mutations)'}${RESET}`);
  console.log(`${DIM}.tables  .schema <table>  .count <table>  .quit   |   Ctrl+C to exit${RESET}\n`);

  if (oneShot) {
    try {
      const { rows, ms } = await execute(oneShot);
      printRows(rows);
      console.log(`${DIM}(${ms}ms)${RESET}`);
    } catch (e) {
      console.error(`${RED}Error: ${e.message}${RESET}`);
      process.exitCode = 1;
    }
    await sequelize.close();
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'sql> ' });
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    try {
      if (input === '.quit' || input === '.exit') { rl.close(); return; }
      if (input === '.tables') {
        const qi = sequelize.getQueryInterface();
        const tables = await qi.showAllTables();
        for (const t of tables) {
          const [[r]] = await sequelize.query(`SELECT COUNT(*) AS c FROM "${typeof t === 'string' ? t : t.tableName}"`);
          console.log(`  ${typeof t === 'string' ? t : t.tableName}${DIM} (${r.c})${RESET}`);
        }
      } else if (input.startsWith('.schema')) {
        const t = input.split(/\s+/)[1];
        if (!t) console.log('Usage: .schema <table>');
        else console.log(JSON.stringify(await sequelize.getQueryInterface().describeTable(t), null, 2));
      } else if (input.startsWith('.count')) {
        const t = input.split(/\s+/)[1];
        if (!t) console.log('Usage: .count <table>');
        else {
          const [[r]] = await sequelize.query(`SELECT COUNT(*) AS c FROM "${t}"`);
          console.log(r.c);
        }
      } else {
        const { rows, ms } = await execute(input);
        printRows(rows);
        console.log(`${DIM}(${ms}ms)${RESET}`);
      }
    } catch (e) {
      console.error(`${RED}Error: ${e.message}${RESET}`);
    }
    rl.prompt();
  });

  rl.on('close', async () => {
    console.log(`${DIM}bye${RESET}`);
    await sequelize.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(`${RED}Failed to connect: ${e.message}${RESET}`);
  process.exit(1);
});
