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

## Phase 3 — Live-update refactor + motion core

**What.** Ship-now #3 and the §5 motion inventory core:

- Poll path no longer rebuilds innerHTML: open-trade price nodes are tagged `data-live-trade`/`data-live-field` (+`.live-cell`) when rendered — journal Net P&L cell (app.js renderJournalTable), progress-card live %, Move, Current Price, $ Move (renderProgressTradeSummary), and hero-tape Current/pips/cell-tone/row-tone (recentTradesView open card). `patchLiveNodes()` (app.js) resolves each node through a `LIVE_FIELD_SPECS` table against `getOpenTradeLiveSnapshot`, updating textContent + swapping tone classes in place. `renderAll` still owns real state mutations.
- `LIVE_PRICE_REFRESH_MS` 2000 → 5000; deleted `fetchLivePricesDirect`/`buildLivePriceRequests`/`resolveLivePriceSource`/`persistLivePrices` from livePrices.js — the PHP proxy is the only price source and the browser never writes the shared cache.
- Motion core: `tickUp`/`tickDown` keyframes (`--dur-tick`, pos/neg-soft flash) applied on numeric change with direction from a `data-live-value` baseline, cleared on animationend; count-up rAF helper `setCountUpValue` (ease-out cubic, 600ms, `data-count-hash` guard, first arrival counts from 0) on the 12 metric cards + trader score; chart draw-in in charts.js (dataset-hash guard incl. dimension/metric, 640ms progress param → line clip-reveal, 24ms-staggered bar scale, radar radius interpolation; replays on themechange); `.view.is-active` viewEnter (4px rise, `--dur-base`); `skeletonPulse` on metric values + journal rows via `body.is-journal-loading` around `loadFromPhpStorage`.
- Deleted `brandSettle`/`brandAccentPulse` (+ brand text-shadow) and every hover translateY/translateX lift + hero h2 hover text-shadow; added `.btn:active { translateY(1px) }`. Single `prefersReducedMotion()` helper in app.js consulted by ticks, count-up, crossfade, and (via dep) chart draw-in; the Phase 2 global reduced-motion block already zeroes tokens and kills CSS animation.

**Why.** The 2s full rebuild destroyed scroll/focus/selection and burned third-party quota per tab; the motion budget moves from entrance theatrics to data motion per §5.

**Verification.** `node --check` on app.js + all four touched modules (pass); `php -l trade_handler.php` (pass, untouched); dev server serves the page and the new markers (`patchLiveNodes`, `tickUp`, `viewEnter`, `skeletonPulse`, `DRAW_DURATION_MS`) via curl; grep confirms zero remaining references to deleted exports/keyframes. No live DB locally — poll patching exercised by re-reading the diff (patch touches only textContent/classList on tagged nodes; no innerHTML on the poll path).

## Phase 4 — Visual sweep: dashboard + journal

**What.** §4 component treatments for the two money views plus the shared chrome they sit in:

- Literal sweep to tokens: body (flat `--surface-0`, `--font-ui`, `font-variant-numeric: tabular-nums` + explicit `"tnum"` on `.metric-value`/`td`/`.live-cell`/calendar cells), sidebar + desktop nav (`--surface-2`, hairline, `--z-nav`), view heads/panels/chart canvases (one flat recipe: `--surface-1` + 1px `--line` + `--radius-xl`, wells on `--surface-inset`), buttons (primary = accent fill + `--text-inverse`, secondary = `--surface-2` + `--line-strong`, destructive mini-btn = transparent + `--pnl-neg` w/ soft hover, shared `:focus-visible` ring), forms shared bits (opaque `--surface-inset` inputs, instant `--focus-ring` focus, mono labels; 9999s webkit-autofill hack deleted), tables (sticky mono `--surface-inset` thead, hairline rows, mono `--fs-data` cells, `.num` right-aligned numerics, `--surface-3` row hover), pills/badges → rectangular `--radius-sm` tags on semantic-soft + semantic-line, score stack, strategy toggles, progress-trade cards, brand block. All panel gradients in these components deleted; both `blur(60px)` ambient blobs deleted; graph-paper overlay neutralized to `--line`.
- Nav: mono-uppercase quiet buttons; active = accent underline rail (desktop) / 2px inset left rail (sidebar); `aria-current="page"` maintained by `switchView`.
- Metric cards: flat + `--edge-highlight`; JS stamps `.is-pos`/`.is-neg` (signed 2px left hairline) on money cards; balance card reads today's P&L sign and `--pl-intensity` = clamp(|todayPnl|/dailyMaxLoss, 0, 1) widens/deepens the hairline (color-mix with static token fallback). Delta chips under all 12 values: current vs previous period (journal date filter window when both dates set, else calendar month vs previous month), computed by re-running `calculateAnalytics` on the two windows; hidden when the previous window has no closed trades or the PF sentinel is in play.
- Empty state: zero trades swaps the metric-card wall for a centered block (line icon, "No trades yet", primary CTA → fresh trade entry). Explicit `[hidden] { display:none }` guards added for grid/empty-state/progress summary (author `display:grid` was defeating the attribute — pre-existing for the progress summary).
- Journal table: 13-col treatment incl. `.num` classes on Pips / Net P&L / R-Multiple (and the edge table numerics), live-cell classes preserved from Phase 3; 900–980px band now caps `table { min-width: 900px }` with explicit wrapper `overflow-x: auto`; ≤900px card transform kept and tokenized.
- Trust fixes riding along (Phase 6 not landed): mojibake `â€”`→`—` (4 sites) and `âˆž`→`∞`; profit factor 999 sentinel now renders `∞`. `::after` UI copy (Hide/Expand, Minimize/Show more) moved into real spans toggled by `[open]` CSS — screen-reader visible, no JS.

**Why.** Blueprint §7 Phase 4 / ship-now #2 core: the two views users judge the product by move fully onto the Institutional Terminal system.

**Verification.** `node --check` clean on app.js; styles.css braces balanced (556/556); curl on the running dev server serves the new markup/CSS/JS markers (`dashboardEmptyState`, `metric-card-balance`, `aria-current`, underline/left-rail shadows, `metric-delta`, dead-zone media query, `∞`); grep confirms zero gradients/ambient/font literals left in swept components (remaining literals are Phase 5 surfaces: landing, auth, trade-entry sections, calendar, reflections, footer). trade_handler.php untouched.
