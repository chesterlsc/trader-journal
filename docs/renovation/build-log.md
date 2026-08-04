# Renovation build log

## Phase 1 — Security & backend correctness

**What.** Ship-now item #1 (blueprint §6) plus the task additions:

- Session cookies now `SameSite=Lax` + `httponly` + `secure` (when HTTPS, incl. `X-Forwarded-Proto`); `session_regenerate_id(true)` on login and register.
- CSRF: `session`/`login`/`register` responses carry `csrfToken` (per-session, `$_SESSION['csrf_token']`); every POST except login/register/forgot_password/reset_password requires a matching `X-CSRF-Token` header (403 otherwise). Client threads the token through `checkAuthSession`/`submitAuth` into logout, save, and `persistLivePrices`.
- Rate limiting, DB-backed via `login_info`: 6+ failed events per username+IP (login/forgot) or per IP (register/reset-token) in 10 minutes → 429. forgot_password logs every request as a counted event; invalid reset tokens are logged as `reset` failures.
- `update_prices` now requires auth (cache-poisoning fix); unauthenticated clients no longer attempt the write-back.
- `public_recent_trades` returns only symbol/date/direction/status/result, capped at 20 rows — no prices, sizes, or P&L.
- APP_DEBUG leaks removed: reset URLs never returned; `debugMessage` sends details to `error_log` only.
- Bootstrap-admin fallback gated behind `ALLOW_BOOTSTRAP_ADMIN=1`.
- Localhost auth bypass tightened: `file:` or plain-http localhost still works (dev preview without a DB); anything else needs `?preview=1` once (sessionStorage `axiom_local_preview=1`).
- `.dockerignore` rewritten to exclude `.git`, `.claude`, `db/`, `docs/`, `scripts/`, `data/` — schema, migration scripts, and legacy `data/users.json` no longer ship in the image/docroot.

**Why.** Prerequisite to selling anything (map §6.1); every later phase assumes these endpoints are safe.

**Verification.** `php -l trade_handler.php` clean; `node --check` clean on app.js and livePrices.js; `curl http://127.0.0.1:8000/` serves the page and the updated JS (markers present); POST without DB returns the generic init error with no exception detail. DB-dependent paths (CSRF 403, 429, `update_prices` 401) verified by diff re-read — no local PostgreSQL (pre-existing).

## Phase 2 — Token foundation, fonts, theme toggle

**What.**
- `styles.css` :root (old 20-var block, lines 1-21) replaced verbatim with the blueprint §2 FINAL token block: graphite surface ramp, hairlines, accent/P&L/status/chart/type/spacing/radius/elevation/z-index/motion tokens, plus the legacy alias block (`--bg`, `--panel`, `--green`… → new tokens; `--text-main` now defined) so every existing rule keeps resolving. Added `[data-theme="light"]` overrides, the `html.theme-switching` crossfade rule, and the reduced-motion block (zeroed duration tokens + global kill).
- `index.html` head: meta description, dual `theme-color` (`#08090b` dark / `#f4f5f7` light), Google Fonts preconnect + Sora 600/700 + JetBrains Mono 400-700 link (fonts were never actually loaded before — only fallbacks rendered), and an inline FOUC-guard script that reads `localStorage axiom_journal_theme_v1` and stamps `data-theme="light"` before first paint. Theme toggle buttons (`data-theme-toggle`) added to `.desktop-nav-actions` and the mobile sidebar nav.
- `app.js`: `THEME_STORAGE_KEY`, `ui.themeToggles`, `getStoredTheme()`/`applyTheme()`/`toggleTheme()`. Toggle persists to localStorage, flips `data-theme` on `<html>`, dispatches a `themechange` CustomEvent, and wraps the flip in the ~300ms `.theme-switching` crossfade — skipped under `prefers-reduced-motion`. `applyTheme` runs at init to sync toggle labels.
- `src/modules/charts.js`: every hard-coded color/font deleted. A palette object is built from `getComputedStyle(document.documentElement)` reading `--chart-*` (+ `--text`, `--text-soft`, `--surface-1`, `--line-strong`, `--pnl-neg-soft`, `--info-soft`), cached per render pass, invalidated and charts repainted on `themechange`. Canvas fonts come from `--chart-font-family`/`--chart-font-size` (radar labels move from Sora to mono per §3).

**Why.** Blueprint §7 Phase 2 / ship-now #2: single token source of truth with dark default + light theme, charts following the theme, no reload flash.

**Verification.** `node --check` clean on app.js and charts.js; `grep` finds zero remaining hex/rgba literals in charts.js; `curl http://127.0.0.1:8000/` serves the FOUC script, font links, both toggle buttons, and the new token markers in styles.css; single `:root` block (plus the intended reduced-motion override).
