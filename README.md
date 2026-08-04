# Trader Journal

Professional trading journal web app ("Institutional Terminal" design, dark + light themes) with:

- Performance, drawdown, psychology, session, and R-multiple analytics with vs-previous-period deltas
- Calendar P&L with day click-through to the filtered journal; sortable journal table; hash-routed views
- Live prices with targeted DOM ticks; close-at-market on open trades; daily/weekly loss-budget strips
- Login, registration, password reset, and per-user cloud save (CSRF-protected, rate-limited)
- Local autosave plus PostgreSQL sync
- Bulk import from Vantage, Binance, and Google Sheets CSV/TSV — missing values flagged, open rows supported, one-click undo per import batch

See `MVP.md` for the full scope and roadmap, and `docs/renovation/` for the design blueprint and build log.

## Stack

- Frontend: `index.html`, `styles.css`, `app.js` + `src/` modules (vanilla, no build step)
- Backend: `trade_handler.php`
- Storage: PostgreSQL

## Environment

Set either:

- `DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require`
- `DATABASE_PRIVATE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME`

or these variables:

- `PGHOST`
- `PGPORT` (optional, default `5432`)
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`
- `PGSSLMODE` (optional, for example `require`)

App behavior:

- `APP_URL=https://your-domain.example` so password reset links use the public app URL
- `RAILWAY_PUBLIC_DOMAIN=...` as a fallback if `APP_URL` is not set
- `APP_DEBUG=true` to expose detailed backend errors and reset URLs in development only
- `ADMIN_USERNAMES=your_username,another_admin` for explicit admin access
- `ADMIN_USERNAME=your_username` as a single-admin alternative
- `ALLOW_BOOTSTRAP_ADMIN=1` to let the first registered user become admin when no admin env var is set (off by default; enable only for the first deploy, then set `ADMIN_USERNAMES` and remove it)
- `PUBLIC_RECENT_TRADES_USERNAME=your_username` or `PUBLIC_RECENT_TRADES_USER_ID=123` to power the landing-page public trade feed

Password reset email:

- `MAIL_FROM=no-reply@your-domain.example`
- `MAIL_FROM_NAME=Trader Journal` (optional)
- `RESEND_API_KEY=...` to send reset emails through Resend
- If `RESEND_API_KEY` is not set, the backend falls back to PHP `mail()`

Notes:

- Put database env vars on the app service, not only on the Postgres service.
- Railway internal hosts (`*.railway.internal`) default to `sslmode=disable`.
- Non-internal hosts default to `sslmode=prefer` if not explicitly set.

## Database Schema

Schema file:

- `db/schema.sql`

Tables currently used by the backend:

- `journal_users`
- `password_reset_requests`
- `journal_notes`
- `trades`
- `trade_screenshots`
- `symbol_prices`
- `login_info`

`trade_screenshots` is the source of truth for stored screenshot blobs. `trades.payload` keeps the trade records leaner and the backend merges screenshots back in on load.

Apply the schema manually if needed:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

The handler also creates missing tables on first request.

## Run Locally

```bash
php -S 127.0.0.1:8000
```

Then open `http://127.0.0.1:8000`. Plain-HTTP localhost skips auth and runs on local storage only (no DB needed) — the local preview mode. On any other origin, append `?preview=1` once to opt into preview mode for that tab session; server endpoints always require a real session regardless.

## Security model

- Every session POST requires an `X-CSRF-Token` header (token issued by the `session`/`login`/`register` responses)
- Session cookies are `SameSite=Lax` + `httponly` (+ `secure` on HTTPS); session id rotates on login
- Login/register/forgot-password/reset are rate limited (6 failures per 10 minutes → HTTP 429), backed by the `login_info` table
- `update_prices` requires auth; `public_recent_trades` returns only symbol/date/direction/status/result, capped at 20 rows
- `.dockerignore` keeps `db/`, `scripts/`, `docs/`, and legacy `data/` out of the deployed image

## Railway Deploy

1. Add a PostgreSQL service in Railway.
2. Ensure the app service has `DATABASE_URL`.
3. Set `APP_URL`, email env vars, and optional admin/public feed env vars.
4. Deploy this repo.
5. Run through the checklist in `docs/launch-checklist.md`.

## Migrate Legacy JSON Data

If you already have file-based users or trades in legacy JSON files, import them into PostgreSQL:

```bash
php scripts/migrate_legacy_json.php
```

## API Endpoints

- `trade_handler.php?action=session`
- `trade_handler.php?action=register`
- `trade_handler.php?action=login`
- `trade_handler.php?action=forgot_password`
- `trade_handler.php?action=validate_reset_token&token=...`
- `trade_handler.php?action=reset_password`
- `trade_handler.php?action=logout`
- `trade_handler.php?action=save`
- `trade_handler.php?action=load`
- `trade_handler.php?action=recent_trades`
- `trade_handler.php?action=public_recent_trades`
- `trade_handler.php?action=live_prices&symbols=BTCUSD,XAUUSD`
- `trade_handler.php?action=update_prices`
- `trade_handler.php?action=login_logs` (admin-only login audit feed)
- `trade_handler.php?action=users_admin` (admin-only users view)

## Launch Checklist

- `docs/launch-checklist.md`
