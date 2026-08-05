# Trader Journal — MVP Definition

_Last updated: 2026-08-05, post-renovation (branch `renovation/v2`)._

## Product

A professional trading journal for retail traders who journal manually: log trades fast, attach evidence, and get honest analytics on edge, discipline, and psychology. Positioning: the credible, no-fluff alternative to TradeZella-class subscriptions — "Institutional Terminal" design language, zero fabricated numbers, zero dark patterns.

**Stack (deliberate):** vanilla JS + CSS front-end (no build step, no framework, no dependencies) on a Vercel serverless Node backend and PostgreSQL. One HTML shell, one stylesheet driven by design tokens, one API entry point (`api/handler.js`), per-user JSONB storage. The PHP monolith was retired in the Vercel port; the front-end still calls the same `trade_handler.php?action=…` URLs via a rewrite.

## MVP scope (shipped)

### Core journaling
- Trade entry with domain validation (stop-side checks, open/closed status), Long/Short segmented control, psychology + execution grading, screenshot attach (≤350KB inline)
- Trade review table: 13 columns, click-to-sort, filters, edit/delete, CSV export, JSON backup/restore
- Bulk import (Vantage/Binance/Sheets CSV-TSV) — **honest**: missing stop/TP/exit stay blank and flagged "—", no-exit rows import as open positions, every batch stamped with `importBatchId` + one-click **Undo Last Import**
- Close-at-market on open trades from the dashboard progress card or journal row (uses last live price, inline confirm)
- Daily reflections journal + monthly review + replay notes

### Analytics (all derived, all explainable)
- 12 metric cards with **vs-previous-period delta chips** and P&L-signed hairlines
- Equity curve, drawdown curve, setup/asset/weekday performance, 6-axis trader-score radar
- **New reports:** P&L + win rate by psychology rating, P&L by session, R-multiple distribution
- Discipline / daily / trader scores with an in-UI formula explainer (ⓘ)
- Daily & weekly loss-budget strips with breach warnings
- Calendar P&L with 4-step intensity ramp; **click a day to jump to the filtered journal**

### Live data
- 5s price polling through the authenticated server-side proxy (Binance/CoinGecko/gold-api) with targeted DOM patches — scroll/focus/selection survive ticks; pnl-tick flash on value changes

### Auth & account
- Register/login (username or email), password reset via Resend email, per-user cloud save (debounced full-journal sync), local autosave, session restore

### Security posture (hardened this cycle)
- CSRF token on all session POSTs; SameSite/httponly/secure cookies; the session cookie is reissued on login and revoked on logout or password reset
- DB-backed rate limiting on login / register / forgot-password / reset (6 fails / 10 min → 429)
- Authenticated-only price-cache writes; public feed whitelisted to symbol/date/direction/status/result, capped 20 rows
- No debug leaks; bootstrap-admin gated behind `ALLOW_BOOTSTRAP_ADMIN=1`; repo internals (`db/`, `docs/`, `tests/`) and any `.php` path excluded from the deployment

### Design system
- "Institutional Terminal": graphite surface ramp, hairline borders, JetBrains Mono tabular numerals everywhere, Sora headings, one interaction accent, P&L color reserved for money
- Dark (default) + light themes, FOUC-guarded toggle, theme-aware canvas charts
- Complete motion system (pnl-tick, count-up, chart draw-in, view-enter, skeletons, form-shake) with full `prefers-reduced-motion` compliance
- Hash router (deep links, back/forward, refresh restore), `aria-current` nav, focus-visible rings, focus-trapped modals, WCAG AA contrast pass in both themes

## Definition of done for launch
1. Deploy on Vercel with `DATABASE_URL` (the existing Railway Postgres, public host), `SESSION_SECRET`, `APP_URL`, `RESEND_API_KEY` and admin env vars set — follow `docs/DEPLOY.md`
2. Run docs/launch-checklist.md end to end against the deployed URL
3. Register the admin account before enabling `ALLOW_BOOTSTRAP_ADMIN` — or set `ADMIN_USERNAMES` explicitly
4. Smoke the paid path that matters: register → log trade → reload → data intact → export CSV

## Roadmap (post-MVP, in order)
1. **Normalize trades into per-trade rows** with CRUD endpoints (`sanitizeTradesPayload` is the column spec) — fixes last-write-wins across devices; precede with an HTTP smoke suite over the 15 API actions
2. Object-storage screenshot uploads (kills base64 bloat + the 350KB cap) — depends on #1
3. Server-side price polling (cron + cache; SSE or slow poll to clients)
4. A real migration tool for future schema changes — the backend now issues no DDL at all, and `db/schema.sql` is hand-applied, which is fine until the schema next moves
5. Finish the `src/` factory-module migration on the front-end (`app.js` is still the monolith); the backend is already split across `api/_lib/`
6. More broker CSV templates (driven by user requests); weekly review view; journal pagination; multi-account
7. Playbooks-lite (per-setup rule checklists); MAE/MFE capture
8. Separate marketing site with pricing once there is a paid tier

## Explicitly cut (and why)
- **Broker API auto-sync** — years of per-broker maintenance; CSV import covers the manual-journal segment
- **Backtesting / trade replay engines** — different product; requires tick-data licensing
- **AI coach/chat** — LLM cost on a no-revenue app; deterministic reports deliver the insight
- **"Verified trades" badge** — removed instead of backed; honesty is the brand
- **OAuth login, WebSockets, PWA/offline, community feed, multi-leg options, framework migration** — off-strategy or prohibited by the no-build-step constraint
