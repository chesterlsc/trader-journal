# Leon Journal (Trading Analytics)

Trading journal web app with:

- Performance, drawdown, and discipline analytics
- Login/register with per-user cloud save
- Local autosave + server database sync
- Bulk import (Vantage, Binance, Google Sheets CSV/TSV)

## Stack

- Frontend: `index.html`, `styles.css`, `app.js`
- Backend: `trade_handler.php` (session auth + API)
- Storage: PostgreSQL (`journal_users`, `journal_data`, `journal_login_events`)

## Environment

Set either:

- `DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require`

or these variables:

- `PGHOST`
- `PGPORT` (optional, default `5432`)
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`
- `PGSSLMODE` (optional, e.g. `require`)

Optional:

- `APP_DEBUG=true` to include detailed backend errors in API responses.

## Database Schema

Schema file:

- `db/schema.sql`

Apply manually (optional, handler also auto-creates tables on first request):

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

## Run Locally

```bash
php -S localhost:8000
```

Then open:

- `http://localhost:8000`

## Railway Deploy

1. Add a PostgreSQL service in Railway.
2. Ensure app service has `DATABASE_URL` available.
3. Deploy this repo (Dockerfile included).
4. Open the generated Railway domain.

## Migrate Legacy JSON Data (One Time)

If you already have old file-based users/trades in:

- `data/users.json`
- `data/accounts/*.json`

Import them into PostgreSQL:

```bash
php scripts/migrate_legacy_json.php
```

## API Endpoints (used by app.js)

- `trade_handler.php?action=session`
- `trade_handler.php?action=register`
- `trade_handler.php?action=login`
- `trade_handler.php?action=logout`
- `trade_handler.php?action=save`
- `trade_handler.php?action=load`
- `trade_handler.php?action=login_logs` (for authenticated user's login history)

## View Login Info

From Railway service shell / psql:

```sql
SELECT username, event_type, success, ip_address, created_at
FROM journal_login_events
ORDER BY created_at DESC
LIMIT 100;
```

## Data Controls

- Export CSV
- Backup JSON
- Import JSON
- Save to Server DB / Load from Server DB
