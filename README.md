# HP Fresh Fruits ERP

Multi-branch fruit trading ERP: FIFO stock batches, append-only double-entry ledger, per-party running balances, aging reports, and role-based access (OWNER / BRANCH_MANAGER / STAFF / ACCOUNTANT).

## Stack

- **Backend:** Node.js + Express + Sequelize (SQLite by default, Postgres-ready via `DATABASE_URL` / `DB_DIALECT=postgres`)
- **Frontend:** React 18 + Vite + Tailwind CSS + Recharts
- **Auth:** JWT with role & branch middleware

## Quick start

```bash
# 1. Install everything
npm run install:all

# 2. Seed the database (demo branches, users, purchases, sales, ledger entries)
npm run seed

# 3. Run backend (port 5000) + frontend (port 5173) together
npm run dev
```

Login at http://localhost:5173 with a demo account (see seed output), e.g.:

| Role | Email | Password |
|------|-------|----------|
| Owner | owner@hpfruits.com | admin123 |
| Delhi Manager | manager.delhi@hpfruits.com | manager123 |
| Accountant | accountant@hpfruits.com | account123 |
| Delhi Staff | staff.delhi@hpfruits.com | staff123 |

## Notes

- `sequelize.sync({ alter: true })` is **disabled on SQLite** (it hangs/corrupts ENUM-heavy schemas). Enable explicitly with `DB_SYNC_ALTER=true` on Postgres only.
- Ledger integrity can be verified any time via `GET /api/ledgers/verify` — it recomputes balances directly from the immutable ledger and compares them to the cached running balances.

## Database access

The backend runs on **SQL via Sequelize** (SQLite by default; Postgres via `DB_DIALECT=postgres` / `DATABASE_URL`). Two built-in ways to inspect the database:

### 1. Web UI — http://localhost:5000/db-admin

Browser-based database admin page (served by the backend, no extra install):

- Browse every table with row counts, search, sort, and pagination
- Built-in **SQL console** (read-only: `SELECT` / `PRAGMA` / `WITH`)
- Double-gated: requires an **Owner/Accountant login** (JWT) **plus** the `DB_ADMIN_TOKEN` from `backend/.env`
- Note: the UI stores your session in `localStorage` on that browser — use it on a trusted machine only

### 2. CLI shell

```bash
cd backend
npm run db-shell                                   # interactive read-only SQL shell
npm run db-shell -- "SELECT * FROM branches"       # one-shot query
npm run db-shell -- --write                        # allow INSERT/UPDATE/DELETE (careful!)
```

Shell commands: `.tables`, `.schema <table>`, `.count <table>`, `.quit`

### Direct file access

- SQLite file: `backend/data/fruit_erp.sqlite` — can be opened with any SQLite tool (e.g. `sqlite3 backend/data/fruit_erp.sqlite` or the DB Browser for SQLite app)
- Stop the backend before modifying the file externally, and back it up before manual changes (existing backups live in `backend/data/`)

### PostgreSQL switch

Set in `backend/.env`:

```env
DB_DIALECT=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fruit_erp
DB_SYNC_ALTER=true   # optional: auto-create tables on first run
```

The admin UI and CLI shell work unchanged against Postgres (the `/query` endpoint additionally wraps queries in a read-only transaction there).

> Migration note: the previous MongoDB (Mongoose) implementation is preserved in `backend/src-mongo-backup/` — swap `src` with it to switch back.
