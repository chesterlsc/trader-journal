# Trader Journal

Professional trading journal web app ("Institutional Terminal" design, dark + light themes) with:

- Performance, drawdown, psychology, session, and R-multiple analytics with vs-previous-period deltas
- Calendar P&L with day click-through to the filtered journal; sortable journal table; hash-routed views
- Live prices with targeted DOM ticks; close-at-market on open trades; daily/weekly loss-budget strips
- Login, registration, password reset, and per-user cloud save (CSRF-protected, rate-limited)
- Local autosave plus PostgreSQL sync
- First-class TopstepX CSV import in Trade Review — exact Trades imports plus strict flat-to-flat reconstruction from filled Orders, active-account targeting, source-aware P&L labels, stable deduplication, row errors, and one-click batch undo
- Generic import from Vantage, Binance, and Google Sheets CSV/TSV — missing values flagged and open rows supported

See `MVP.md` for the full scope and roadmap, `docs/DEPLOY.md` for the step-by-step
deploy, and `docs/renovation/` for the design blueprint and build log.

## Stack

- Frontend: `index.html`, `styles.css`, `clay-v2.css`, `app.js` + `src/` modules — vanilla, **no build step, no dependencies**
- Backend: Vercel Serverless Functions (Node 22) — `api/handler.js` + `api/_lib/`
- Storage: PostgreSQL (the existing Railway database; any Postgres works)

The PHP backend is gone. `trade_handler.php` was removed in the Vercel port —
Vercel has no PHP runtime, so the file could never execute there and would have
been served as readable source. Its behaviour lives in `api/`, action for action,
and the front-end still calls the same `trade_handler.php?action=…` URLs via a
rewrite in `vercel.json`. Nothing in `app.js` or `src/` changed.

## Environment variables

All values live in **Vercel → Project → Settings → Environment Variables**.
Never put a real value in a file in this repo. `.env.example` holds the names
only; there is no `.env` in version control and `.gitignore` keeps it that way.

### Required

| Name | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Point it at the **existing Railway database** — copy Railway's *public* URL (`postgres://…@*.proxy.rlwy.net:PORT/railway`). The private `*.railway.internal` host only resolves inside Railway's network and a Vercel function cannot reach it. |

`POSTGRES_URL`, `POSTGRESQL_URL` and `DATABASE_PUBLIC_URL` are accepted as
fallbacks, in that order, for platforms that inject one of those names instead.

### Recommended

| Name | What it is |
| --- | --- |
| `SESSION_SECRET` | HMAC key signing the session cookie. Any long random string. If unset, a key is derived from `DATABASE_URL` — the app still works, but rotating the database URL would then log everyone out. |
| `APP_URL` | Canonical origin (`https://your-app.vercel.app`) used to build password-reset links. Falls back to `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`, then the request `Host` header. |

### Optional

| Name | What it is |
| --- | --- |
| `RESEND_API_KEY` | Sends password-reset email through Resend. Without it (or without `MAIL_FROM`) a reset link is created but no email goes out — and the link is never disclosed in a response. A Vercel function has no local MTA, so there is no `mail()`-style fallback any more. |
| `MAIL_FROM` | Sender address for reset email, e.g. `no-reply@your-domain.example`. Required alongside `RESEND_API_KEY`. |
| `MAIL_FROM_NAME` | Display name on reset email. |
| `ADMIN_USERNAMES` | Comma-separated usernames allowed into `login_logs` / `users_admin`. |
| `ADMIN_USERNAME` | Single-name alternative, used only when `ADMIN_USERNAMES` is empty. |
| `ALLOW_BOOTSTRAP_ADMIN` | `1`/`true`/`yes` falls back to "first registered user is admin" when neither variable above is set. Off by default — prefer setting `ADMIN_USERNAMES`. |
| `PUBLIC_RECENT_TRADES_USER_ID` | Whose trades feed the landing-page tape. Wins over the username form. |
| `PUBLIC_RECENT_TRADES_USERNAME` | Same, by username. With both empty the public tape returns an empty list. |
| `PGSSLMODE` | `disable` \| `prefer` \| `require` \| `verify-ca` \| `verify-full`. Only consulted when the connection string carries no `sslmode` of its own. |

There is no `APP_DEBUG`. The old PHP flag could expose exception detail and
reset URLs; the Node backend has no such switch — errors go to the server log
and the client always gets a generic message.

### Database TLS

`sslmode` is read from the `DATABASE_URL` query string first, then `PGSSLMODE`.
The default (matching what the PHP did) encrypts without validating the
certificate chain. Append `?sslmode=verify-full` to `DATABASE_URL` to turn on
real chain verification. There is no host-specific special-casing — the URL
decides.

## Database schema

Schema file: `db/schema.sql`. Never web-served (`.vercelignore` excludes `db/`).

Tables used by the backend:

- `journal_users`
- `password_reset_requests`
- `journal_notes`
- `trades`
- `trade_screenshots`
- `symbol_prices`
- `login_info`

`trade_screenshots` is the source of truth for stored screenshot blobs.
`trades.payload` keeps the trade records leaner and the backend merges
screenshots back in on load.

**The backend issues no DDL, ever.** The PHP re-ran ~30 guarded
`CREATE TABLE` / `ADD COLUMN` statements on every request; the Node port issues
none — no `CREATE`, no `ALTER`, no `DROP`. The existing database is left exactly
as it is. A *brand new* database is set up once, by hand:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

That is for a fresh database. Do not run it against the live one.

## Deploy

Full step-by-step, including verification and rollback: **`docs/DEPLOY.md`**.

Short version: import the repo into Vercel, framework preset **Other**, no build
command, add `DATABASE_URL` (plus `SESSION_SECRET` and `APP_URL`), deploy.
`vercel.json` does the rest — `/trade_handler.php?action=…` rewrites to
`/api/handler`.

## Run locally

Needs Node 22 and the Vercel CLI:

```bash
npm install
npm i -g vercel        # once
vercel link            # once, connects this folder to the Vercel project
vercel env pull        # once, writes a gitignored .env.local — never commit it
vercel dev             # http://localhost:3000
```

`vercel dev` serves the static front-end *and* runs `api/handler.js`, applying
the same `vercel.json` rewrite, so `trade_handler.php?action=…` resolves locally
exactly as it does in production.

**The old `php -S 127.0.0.1:8000` flow is gone** — there is no PHP left to run.
For a pure front-end look with no backend at all, any static server works
(`npx serve .`, `python3 -m http.server 8000`); the app detects plain-HTTP
localhost and runs in **local preview mode**: auth is bypassed and everything
lives in browser storage, no database needed.

That auto-preview also applies under `vercel dev`, because it too is plain-HTTP
localhost. To exercise the real API locally, call it directly:

```bash
curl -i 'http://localhost:3000/trade_handler.php?action=session'
```

or open the deployed Vercel preview URL, which is HTTPS and therefore takes the
real session path.

Run the test suite (no database required — the router is driven against a fake
db object):

```bash
npm test
```

## Security model

- Every session POST requires an `X-CSRF-Token` header; the token is issued by the `session`/`login`/`register` responses and bound to the session cookie
- Session cookie is HMAC-signed, `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS; reissued on login, revoked by logout or password reset
- Passwords are bcrypt. Existing PHP `$2y$` hashes verify unchanged, and new hashes are written back with the `$2y$` prefix so the column stays uniform
- Login / register / forgot-password / reset are rate limited (6 failures per 10 minutes → HTTP 429), backed by the `login_info` table
- `update_prices` requires auth; `public_recent_trades` returns only symbol/date/direction/status/result, capped at 20 rows
- Admin actions (`login_logs`, `users_admin`) are gated on `ADMIN_USERNAMES`
- No debug leakage: exceptions go to the server log, never to the client, and a reset URL is never returned in a response
- `.vercelignore` keeps `db/`, `docs/`, `tests/` and any `.php` file out of the deployment; `vercel.json` routes every `*.php` path to the function, so no PHP path can ever return source text

## API endpoints

All served by `api/handler.js` behind the `vercel.json` rewrite:

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
- `trade_handler.php?action=login_logs` (admin only)
- `trade_handler.php?action=users_admin` (admin only)

## Launch checklist

- `docs/launch-checklist.md`
