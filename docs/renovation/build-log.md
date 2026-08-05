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

## Phase 5 — Visual sweep: remaining views + calendar + forms + landing

**What.**
- Landing: `body::before` graph-paper replaced with the §4 24px dot grid (edge-masked, GPU-cheap); monochrome hero — new mono-uppercase preheadline with the 6px `--pnl-pos` live-pulse dot (the product's only infinite animation; frozen static under reduced motion), hero h2/CTAs tokenized so accent appears exactly once above the fold; trust row + footer + donation `code` chips on tokens; OG meta tags added; cache-busters bumped to `?v=20260805-phase5`.
- Public trades board → terminal tape (recentTradesView.js): rows are now symbol | Long/Short tag | Win/Loss/Flat/Open badge | date, consuming the Phase-1 whitelisted feed shape (`result` field now normalized); the price-cell grid that rendered dashes since Phase 1 is gone; "Verified Vantage Trades" pill deleted, replaced by an honest "Live Feed · Delayed" tag; open rows carry the live-pulse dot.
- Auth modal: §4 treatment (flat 0.65 overlay — no blur, light-theme override, `--surface-2` panel, `--shadow-modal`, scale 0.98→1 enter on tokens, `--z-overlay`/`--z-modal`), focus trap on Tab, Escape close (pre-existing) + return-focus-to-trigger; modal sits over the still-pulsing board.
- Trade entry: Long/Short segmented control (progressive enhancement — buttons drive the hidden native `#direction` select, so read/edit/reset paths are untouched); form-shake (240ms, offending field only) + `.is-invalid` border flash (the reduced-motion fallback); `readTradeForm` errors now name the offending field; trade sections are opaque `--surface-inset` wells with token kickers; status toggle, screenshot preview, tag-set chips tokenized.
- Calendar: hairline grid (1px gaps on `--line`), traded days are real `<button data-date>`s that set journal dateFrom/dateTo and switch views; 4-step `--day-intensity` `color-mix` ramp with static soft-tint fallback lines; today ring via inset accent shadow; ≤760px agenda list of traded days only (+ empty-month note); summary cards on the panel recipe with mono metric values.
- Cleanup: deleted now-orphaned hero live-field specs/tone groups in app.js (heroCurrentPrice/heroPips/heroCurrentTone/heroRowTone), unused tape deps, and all remaining rgba/gradient/font literals — zero legacy-alias consumers remain in styles.css (Phase 7 can delete the alias block).

**Why.** Blueprint §7 Phase 5 / §4 treatments for forms, modals, calendar, landing; grafts 2, 3, 7, 8, 13, 14.

**Verification.** `node --check` clean on app.js and recentTradesView.js; styles.css braces balanced (549/549); zero rgba/gradient literals outside the token block, mask, and the §4-specified overlay colors; zero `var(--green/--red/--blue/--cyan/--amber/--text-main)` consumers left; curl on the dev server serves `direction-toggle`, `live-pulse-dot`, `og:title`, `--day-intensity`, `formShake`, `recent-trades-live-tag`. trade_handler.php untouched.

## Phase 6 — Feature adds

**What.** Ship-now #4/#6/#7/#9/#10. Trust sweep: live % on open trades is now
the leveraged dollar P&L (from positionSize via calculateTradeMetrics)
relative to the account balance, not the raw price move; the "TS" close-reason
guess renders "Manual"; bulk import no longer fabricates stop/TP/exit (missing
values stay 0, flagged "—" in a 10-column preview with a Status column; rows
without an exit import as open positions), every import stamps an
importBatchId and an "Undo Last Import (N)" button in the bulk panel removes
the last batch; a ⓘ dialog (native <dialog>) documents the discipline/daily/
trader score formulas; the balance card shows a "Manual override active" warn
chip when balanceOverride is set. calculateTradeMetrics now treats a missing
stop/target honestly (risk falls back to the settings risk %, RR = 0).
Analytics: psychologyReport (P&L + win rate), sessionReport, and
rMultipleReport (fixed 1R buckets, toned bars) computed in calculateAnalytics
and drawn on three new dashboard canvases through the existing
drawStrategyPerformanceChart pattern (new annotate + per-entry tone options),
hash-guarded like the other charts. Close-at-market: Close buttons on open
journal rows and progress cards confirm against the cached live price and
close through buildTradeRecord + persistState (debounced CSRF autosave).
Risk-budget strip on the dashboard tracks today vs dailyMaxLoss and week vs
weeklyMaxLoss (breach logic mirrors the violation filters; warn at >=60%,
--pnl-neg on breach). Journal headers click/Enter-sort the filtered array with
aria-sort + mono arrow indicators. A hash router keeps location.hash <->
switchView in sync (replaceState for the first programmatic set, push after),
restores the view on refresh for both auth-restore and preview sessions, and
handles back/forward via hashchange; aria-current continues to flow through
switchView.

**Why.** Blueprint §7 Phase 6; §6 ship-now items 4, 6, 7, 9, 10.

**Verification.** node --check on app.js, charts.js, tradeDisplay.js; a node
self-check drove the real tradeDisplay module (leveraged % = +1% on a $100
gain over a $10k account for 0.1 lot XAUUSD, null-balance fallback to "OPEN",
"Manual" resolution label); curl against the running php -S server confirmed
the new markup (riskStrip, scoreInfoDialog, rMultipleChart, bulkUndoBtn,
data-sort headers, balanceOverrideNote), CSS, and app.js markers are served.
Mojibake grep ('â€', 'âˆ') across app.js/src/index.html: zero matches
(Phase 4 fixed all sites). trade_handler.php untouched.

## Phase 7 — Accessibility, polish, QA gate

**What.** Ship-now #11/#12 remainder + the AA sign-off gate. Async buttons get
real pending states via setPendingState (login "Signing in…", register
"Creating…", reset "Resetting…", server save/load "Saving…/Loading…", bulk
import "Importing…" with a paint-first setTimeout) — .is-pending dims + inerts
and aria-busy is set. Donation addresses get mini-btn Copy buttons
(navigator.clipboard, "Copied"/"Copy failed" feedback). Admin panels
(login-activity + users) moved out of public HTML into an app.js template
injected into #adminPanelsMount only when the session is admin; their
<details> open state persists in localStorage (axiom_journal_admin_panels_v1)
instead of snapping shut on every render — collapseAdminPanels deleted. Dead
handleLandingPreviewAutoExpand + its scroll listener deleted. Reflections cap
surfaced in the history panel copy ("Latest 40 shown; …most recent 180").
summary:focus-visible added to the shared focus-ring rule. Legacy alias block
(--bg/--panel/--green/--red/--blue/--cyan/--amber/--violet/--text-main…)
deleted from :root — grep confirms zero consumers and zero unresolved var()
references (only --day-intensity, which JS stamps inline by design).

**Contrast pass (scratchpad node script, WCAG relative-luminance).** 54
pairings checked across both themes (text/soft/faint on every surface, accent,
inverse-on-accent, pnl pos/neg at 13px and 26px, chips on soft bgs, warn/info,
accent-muted). Fixes: dark --text-faint #6b7386→#7d8598 (was 3.81–4.12 on
surfaces, now 4.52–5.30); light --text-faint #737b8c→#646c7d; light --pnl-pos
#0c8a58→#0c7b4e; light --pnl-neg #cf2f58→#cb2e56; light --warn
#a86e0e→#96620e (soft/line rgba components updated to match; --chart-axis
follows in both themes). Result: 0 failures at 4.5:1 body / 3:1 large.

**AA sign-off checklist.**
- [x] Every --text/--text-soft/--text-faint pairing ≥4.5:1 on every surface, both themes (script-verified)
- [x] .is-pos/.is-neg P&L text ≥4.5:1 at 13px and ≥3:1 at 26px, both themes (script-verified)
- [x] Delta chips / soft-bg text ≥4.5:1 over composited backgrounds, both themes (script-verified)
- [x] :focus-visible ring on every interactive element (buttons, nav, inputs, summaries, sortable th, calendar cells, info-btn, direction toggle) — grep inventory
- [x] Auth modal focus trap + Escape + return-focus (Phase 5 code re-verified) ; score dialog is a native <dialog>
- [x] Pending states kill auth/save/import double-submit (disabled + pointer-events none + aria-busy)
- [x] Reduced motion: zeroed duration tokens + global kill block + prefersReducedMotion() JS guard (Phases 2/3, re-verified present)
- [x] No ::after UI copy remains (only decorative content:"" and aria-sort arrow glyphs)
- [x] No mojibake ('â€', 'âˆ') anywhere — grep zero matches
- [x] No blur() in styles.css; no translateY(- hover lifts — grep zero matches
- [x] Legacy alias block deleted; zero alias consumers; zero unresolved var()
- [x] Admin markup absent from the served public HTML (curl grep: 0 hits)
- [ ] Manual browser pass (keyboard-only walk, 375/768/900-980/1280 in both themes) — requires a human + DB-backed login; all static proxies above pass

**Verification.** php -l trade_handler.php OK (untouched); node --check on
app.js + all 6 src files OK; curl 127.0.0.1:8000 serves the new markers
(adminPanelsMount, copy-btn ×2, reflections cap copy) and 0 admin panel ids;
served styles.css contains .is-pending and 0 legacy alias references.

## Verification session — 2026-08-05

Full browser verification on `php -S 127.0.0.1:8000` (local preview mode, no DB), desktop 1440/1280 + mobile 375, both themes.

**Bugs found and fixed (commit 53d4172):**
- `getClosedTrades` was called at three sites (`calculateAnalytics`, monthly review, edge table) but never defined — a runtime `ReferenceError` aborted the first `renderAll()` on every page load, leaving static-HTML defaults on the dashboard and suppressing the empty state. Defined once next to `calculateAnalytics` with a `state.trades` default so all three call sites resolve.
- `METRIC_DELTA_SPECS` was declared after the top-level `init()` call, so the first render hit it in the temporal dead zone. Hoisted above `init()` with a comment explaining the constraint.
- Both were invisible to `node --check` (parse-clean) and to the console-message tool (load-time errors predate attach); caught with a temporary `window.__errs` error trap injected into the head during verification, removed afterward.

**Verified working end to end:** empty state + CTA; trade save → metrics/delta chips/hairlines/risk strips; all 7 canvas charts painted in both themes (pixel-sampled); theme toggle + FOUC guard; hash router incl. back/forward; journal sort (aria-sort both directions); calendar day → filtered journal click-through; close-at-market guard path (no live price locally → friendly error); form-shake + validation on invalid submit; bulk import preview honesty ("—" flags, open rows), import, and batch undo (confirm-gated); score formula popover; donation copy buttons; landing hero + terminal tape + auth modal (mobile + desktop); zero mojibake / `blur(` / hover-lift / gradient regressions; static undefined-reference sweep over all seven JS files clean.

## Elevation pass — dashboard + landing (2026-08-05)

Requested as a "go crazy" design push on the two surfaces that sell the product. The Ultracode design panel was launched but all seven agents failed instantly on a usage limit, so the elevation was designed and built directly, synthesizing the three briefed angles (bento composition, living-instrument motion, editorial scale).

**Dashboard — Command Bento.** The uniform 12-card wall is replaced by a three-tier hierarchy inside `#dashboardMetricGrid` (id preserved, so the empty-state toggle still works): a 12-column deck with an 8-col balance hero (clamp 38-58px numeral, delta + today chips, and a theme-aware equity sparkline canvas bleeding to the card edges) beside a 4-col risk-budget card whose headline numeral is now the *remaining* budget; an edge quad (win rate, profit factor, expectancy, avg R:R) at ~31px; and a hairline-joined dense rail carrying the remaining seven metrics at 17px, with best/worst-day dates demoted to `.metric-sub` captions and delta chips suppressed for density. The view head drops its panel box for an editorial kicker + heading row. Charts become a real bento (equity 8 + drawdown 4 / strategy 8 + radar 4 / three reports 4-4-4), and discipline + edge table pair 5/7. The command bar is now one compact row — the in-progress ticker was a card inside a card and lost its inner frame.

**Landing — Terminal Poster.** The single centered hero becomes a scroll narrative: hero (clamp 2.4-4.25rem headline, primary CTA leading, honest stat trio — 12 metrics / 7 reports / 0 dependencies — over an ambient equity curve that draws itself on a masked canvas) → product showcase (a mini dashboard mock built from the real tokens, so it cannot misrepresent the product) → feature triptych (Capture / Analyze / Control) → the live tape under its own section head → a closing CTA band. Sections fade up via IntersectionObserver.

**Motion.** `dashReveal` staggers the stats tiers (45ms × `--i`); dashboard panels and landing sections use IntersectionObserver reveals; the sparkline and hero atmosphere animate with rAF behind dataset-hash guards. Every mechanism is skipped outright under `prefers-reduced-motion` (JS opts out; the global CSS kill block covers the rest).

**Local-preview navigation.** Preview mode had no route to the landing and no logout (there is no session). Added a preview-only "View landing" button in both navs and "← Back to app" on the landing; both are hidden whenever a real session exists, so a signed-in user still only sees Logout.

**Bug found and fixed during verification.** `dashSparkHash`/`dashSparkFrame` were declared with `let` below the top-level `init()` call, so the first render threw `ReferenceError: Cannot access 'dashSparkHash' before initialization` — aborting `renderAll` and leaving the risk strip, edge table, journal table, and discipline scores on their static HTML defaults. Hoisted above `init()` beside `METRIC_DELTA_SPECS`. This is the second instance of this failure mode in this codebase; the pattern is now documented in both places.

**Verified:** both themes at 375 / 740 / 1400px; all 8 canvases painting (7 charts + sparkline); hero/quad/rail/bento composition at each breakpoint; landing scroll reveals; auth modal over the landing; preview-mode round trip; view switching including reveal-after-hidden-view; Monthly Review's `.metric-grid.compact` untouched; zero console errors.

## Phase A — Chart engine rebuild (2026-08-05)

Per the "go crazy" direction, `src/modules/charts.js` was rewritten as a depth-and-motion renderer. The anti-decoration rules are relaxed here; the token contract, both themes, reduced motion, and the hash guard are not.

**Equity + drawdown.** Quadratic-through-midpoints smoothing (`traceSmoothPath`, now a named export so `drawDashSparkline` in app.js traces the identical curve instead of duplicating it); a 3-stop area gradient sized to the curve's actual envelope; a 3-pass stroke (wide halo → tight halo → crisp core) using `shadowBlur`; a haloed head marker with an expanding "ping" ring on the tail of the draw-in; a peak / max-DD annotation with a dashed drop line, clamped inside the plot; a receding grid (top rules fade, baseline solid) with compact-currency Y labels in a new left gutter; and a mono readout block top-left. Drawdown is now a true underwater curve — the positive magnitudes are plotted negated below a zero rule, so axis labels, readout, and tooltip all read as negative money.

**Bars (strategy, psychology, session, R-multiple).** Real pseudo-3D: an offset deep face (`--chart-*-deep`) behind a pill-capped front face, a clipped highlight→shade gradient for the cylinder, and a top edge hairline. Recessed row tracks, a zero spine that fades at both ends, value labels outside the bar end (flipping inside in `--text-inverse` when they would overflow), and a reserved right column for the psychology win-rate note so it can never collide with a value.

**Radar.** Concentric rings drawn outside-in with an alternating wash, a radial-gradient polygon with a glow stroke, haloed vertex dots, two-line uppercase axis labels with the score beneath, and a draw-in that reveals the polygon through a rotating radar wedge with a glowing leading edge.

**Hover.** `mousemove`/`mouseleave` per canvas (mouse only — touch keeps scrolling, and every chart is readable without a pointer). Line charts get a dashed crosshair, a glowing point, and a floating value+date readout; bars get a lit row, a glowing bar, and a label/value/win-rate tooltip. Each canvas stores its own repaint closure, so a hover repaints one chart, never seven, and repaints are suppressed while the draw-in tween is running.

**Tokens.** 30 new `--chart-*` / `--spark-*` tokens defined for both themes (glow, area stops, extruded faces, highlight/shade, track, crosshair, tooltip, ring wash, radar gradient, canvas well). Every fade stop repeats its own RGB at alpha 0 — canvas gradients interpolate RGBA literally, so fading to `transparent` would grey the ramp. Dead `--chart-fill` deleted (zero consumers after the rewrite). `.panel-chart canvas` became a lit stage (radial wash + vertical gradient + inset highlight + drop shadow, crosshair cursor on the two line charts only).

**Verification.** New `tests/charts.smoke.mjs` (`node tests/charts.smoke.mjs`, no deps) stubs DOM + a recording 2D context and drives every renderer through empty, flat, populated, count-metric, draw-in and settled states plus hover hit-tests — asserting no non-finite coordinate, no `undefined`/`NaN` in any drawn string, no empty gradient stop, that hover repaints and that a miss does not, and that the reduced-motion instance still paints. 12,206 canvas ops / 1,239 text draws pass. `node --check` on app.js + charts.js, `php -l trade_handler.php`, curl of the served CSS/JS for the new markers. Cache buster → `20260805-charts3d`.

## Phase B — Landing page rebuild (2026-08-05)

The logged-out shell became a scrolling sales page built around the real feed. Both explicit user requirements are addressed: the live tape is now the hero centrepiece, and the only path off the page is creating an account.

**Hero — claim 7 : live terminal 5.** `#recentTradesList` moved out of its own section and into `.hero-terminal`, a device-chrome panel with a rail (window dots, `recent_trades`, a live-pulse badge), the real board, and a foot carrying `#landingScrollHint`. It sits above the fold on a 7:5 grid beside an editorial `--fs-hero-xl` headline whose last line is a gradient-clipped accent (guarded by `@supports` so it can never render invisible). At ≥980px the panel rests at `rotateX(4deg) rotateY(-9deg)`, settles in from a steeper angle on load, and follows the mouse ±5° via `setupHeroTilt()` — bound only for `pointerType === "mouse"` on `(hover: hover) and (pointer: fine) and (min-width: 980px)` with motion allowed, rect cached on `pointerenter` so the tape's repaints never hit a forced layout. `:focus-within` flattens it for keyboard users.

**Trust, not a bypass.** The hero carries a three-line trust ledger (free, no card; CSV/JSON export; dark + light) and the CTA row is one primary "Create your free account" plus a hairline "Log in". The two local-preview buttons (`#previewAppBtn`, `[data-preview-landing]`) are now `.dev-chip`s — dashed pill, muted, with an amber `dev` tag — so they read as a debug affordance, never an alternative to signing up. They stay fully functional in preview mode.

**Scroll narrative.** Proof strip (12 metrics / 7 reports / 6 workspaces / 0 dependencies — all counted from the code) → dashboard showcase in a stage that unrotates from `rotateX(9deg)` to `2.5deg` on reveal and flat on hover → a three-beat "how it works" rail → the feature triptych with 3D hover lift and an accent halo → a capability ledger table → a closing CTA band with a masked dot field and radial accent wash. Every claim is checkable in the app; no testimonials, counts, logos or invented metrics.

**Atmosphere.** Three drifting radial washes, a perspective grid floor and a slow light band, all inside `.landing-atmosphere`. It is anchored to the top of the shell and masked out before the proof strip — a contrast requirement, not taste: composited over the page surface at peak alpha, `--text-faint` and the accent kicker fall to 3.4:1 / 3.9:1. Above the fold only `--text` and `--text-soft` sit on the wash (10.6:1 and 4.9:1 dark, 12.4:1 and 5.4:1 light, script-verified); everything below reads on clean surface. Grid floor and `#landingAtmos` parallax off `--landing-scroll`, one number written by a rAF-throttled passive scroll listener.

**Motion + reveals.** Reveal rules are now gated on `body.auth-ready` so a JS-disabled visitor never gets invisible sections, and `.reveal-stagger > *` adds a 70ms nth-child cascade inside each revealed section — pure CSS, no JS change to the existing IntersectionObserver. The reduced-motion kill block gained `animation-delay: 0ms` / `transition-delay: 0ms`, without which the `backwards`-filled terminal settle and the staggered children would sit invisible through their delays.

**`drawLandingAtmos` restyled** to Phase A's language: `traceSmoothPath` instead of raw `lineTo`, a 3-stop area gradient and a two-pass glow stroke with a lit head marker, all reading `--chart-*` tokens.

**Verified.** `node --check` on app.js, charts.js, recentTradesView.js; `tests/charts.smoke.mjs` (12,206 ops) green; `php -l trade_handler.php`; balanced braces and zero unresolved `var()` in styles.css (`--i` / `--day-intensity` come from inline styles); HTML tag balance parsed clean; served markup and CSS greped for the new markers. Contrast checked by script for every new colour pairing including the composited aurora peaks. Cache buster → `20260805-landing3d`.

## Phase C — Dashboard: depth, tilt, choreography

The bento stopped being flat cards on a flat page. Three layers were added on
top of Phase A's chart engine, without moving a single node.

**Surfaces.** `.panel`, `.metric-card`, `.dashboard-empty`, `.dash-risk` and
`.dash-rail` now paint a 178deg two-stop plane (`--deck-top` → `--deck-bottom`)
with an inset top highlight and a real drop shadow (`--deck-shadow`). The two
tall deck cards get an accent radial wash at their top edge. The balance hero
gained a left bloom in the day's P&L colour whose opacity rides the existing
`--pl-intensity` scalar, and its numeral carries a tone-matched text glow.
`.metric-card:not(.dash-rail-item)` is a load-bearing exclusion — the rail's
inset hairline separators (and their nth-child rewrites in the responsive
blocks) would be clobbered by a later box-shadow.

**3D.** `.dash-deck` / `.dash-quad` are perspective containers; the six
`[data-tilt]` cards (hero, risk meters, four quad cards) rotate up to 3.5deg
toward the pointer and carry a specular that follows it. `setupHeroTilt` was
refactored into a shared `bindPointerTilt(stage, panel, maxTilt)` that both the
landing terminal (5deg) and the deck (3.5deg) use — it writes `--tilt-x/-y`,
`--px/--py`, `--sheen` and nothing else. Binding is refused under reduced
motion, and every handler is gated on `pointerType === "mouse"` plus
`(hover: hover) and (pointer: fine) and (min-width: 980px)`. The matching CSS
drops `perspective` and the specular entirely below 980px / on coarse pointers.
`isolation: isolate` + a `z-index: -1` pseudo keeps the sheen on the surface and
under every numeral without touching a child's position — `.dash-spark-wrap`
keeps its own absolute layout.

**Motion.** `dashReveal` is now rise + scale + fade on a `--stagger-dash` tier
ladder (deck 760ms, quad 520ms, rail 700ms). Risk meters fill from zero via a
`scaleX` keyframe, so JS keeps writing `width` and the animation works at any
data value. Delta chips, the today chip and the override note pop in on the
`[hidden]` → visible transition. `tickUp`/`tickDown` keep their names (app.js
matches them on `animationend`) but gained a ring and a glow. Open positions
carry a pulsing status dot. The command bar got gradient press-depth buttons and
the ticker strip became a lit plane with an accent edge and a hover lift. The
desktop nav's six blinking underlines became one rail that slides between items,
positioned by `positionNavRail()` from the active button's box — called on view
switch, gate change and the existing debounced resize, never in the 5s live
loop.

Verified: `node --check` on app.js, `node tests/charts.smoke.mjs` green, CSS
braces balanced, served output greps for `deck3d` + `PHASE C` + six `data-tilt`
hooks. Cache busters bumped to `v=20260805-deck3d`.

## Phase D1 — Claymorphic design system + shared components (2026-08-05)

The hairline-and-flat aesthetic of the blueprint is deliberately replaced with
clay. Token DISCIPLINE is unchanged: semantic names, both themes, no magic
literals, every existing token name still resolves.

**Token layer.** `--radius-clay-sm/md/lg/xl` (14/20/26/32) plus the legacy
scale re-pointed at it (`--radius-sm` 4→8, `--radius-md` 6→12, `--radius-lg`
→ clay-sm, `--radius-xl` → clay-lg), so 76 existing `border-radius` rules
round up without being touched. Four shadow stacks per theme —
`--clay-raised` (cards), `--clay-float` (interactive), `--clay-soft` (quiet
containers, outer drop only), `--clay-pressed` (wells + active), plus
`--clay-accent` for the primary button. Every outer shadow is hue-matched
(245deg surfaces, 220deg accent), never neutral grey. Dark is re-derived, not
inverted: the top inset is `hsl(245 25% 80% / 0.12-0.17)`, not white 0.9.
`--shadow`, `--shadow-modal`, `--deck-shadow`, `--deck-shadow-lift` and
`--edge-highlight` now alias the clay stacks, which converts every Phase C
consumer (panels, metric cards, dash-risk/rail, ticker strip) in one move.
New: `--clay-edge`/`--clay-edge-strong` (barely-there soft edge, load-bearing
in dark), `--control-edge` (see below), `--ease-squish`/`--dur-squish`.

**Surfaces.** Both ramps re-cut so surfaces are always LIGHTER than the page
and the page is never `#000`/`#fff`: dark `#0b0c11` page / `#171a23` card,
light `#ecedf5` page / `#fbfbff` card. The Phase C deck gradient drops to a
whisper (clay volume comes from the insets; a strong plane gradient fights
them). `--chart-grid`, `--chart-axis` and `--chart-canvas-*` follow the new
ramp — charts still read everything through `getComputedStyle`, untouched.

**Components (new PHASE D section).** Containers lose their border and take
clay: `.panel` `.view-head` `.metric-card` `.dash-hero/-risk/-quad-card`
`.sidebar` `.dashboard-empty`; `.dash-rail` takes `--clay-soft` only (seven
read-only panes must not read as seven buttons). Buttons are pill-radius,
puffy, `min-height: 44px`, and press by moving transform + shadow direction +
fill together. Inputs/selects/textarea become opaque pressed wells
(`--surface-inset` + `--clay-pressed`, 14px radius, 44px min-height). Tables,
calendar cells and chart interiors stay deliberately FLAT — clay on a
repeating row is the canonical way this style ruins a data product. Pills,
delta chips and the today chip lose their borders for soft semantic fills.
Modals go to 32px radius. Breathing room up one rung (`.panel` 20→24px, view
and grid gaps 14→16px), stepping back down at 720/560px so a 375px screen
still belongs to the numbers.

**The money rail** moved from `border-left` (which tapers into a wedge against
a 20px radius) to an inset shadow — except on `.dash-rail-item`, which keeps
the original border because its separator shadows are rewritten by nth-child
in two responsive blocks. Same trap Phase C flagged; not re-armed.

**Contrast.** `scratchpad/clay-contrast.mjs` resolves both token blocks,
composites alpha over its backdrop and checks 62 pairings per theme —
every text colour on all five surfaces, on the deck gradient, on each semantic
soft fill, and over the clay top-inset highlight and bottom shade (the
lightest and darkest pixels a numeral can land on). Four rounds of fixes:
`--text-faint` dark `#7d8598`→`#969eb2`, `--surface-3` pulled back, light
`--surface-3`/`--surface-inset` lightened, and light `--pnl-pos/-neg/--warn/
--info` darkened one step. **Worst surviving text pairing 4.57:1** (dark,
`--accent` on `--accent-muted` over `--surface-1`); all body text ≥ 4.5:1 in
both themes. Focus ring measured against BOTH the card and the page (5.4/6.1
dark, 6.2/5.5 light) because `outline-offset` puts it on the page while the
eye compares it to the card. A soft shadow edge measures ~1.4:1, so every
CONTROL (button, input, select, chip, toggle) keeps one 1px `--control-edge`
hairline at ≥3:1 against both card and page — WCAG 1.4.11. Reduced motion
drops the press transform entirely; the fill and shadow flip carry the state.

**Verification.** `node --check` on app.js; `node tests/charts.smoke.mjs`
green (12,206 ops); CSS braces balanced (1049/1049) and zero undefined `var()`
beyond the four inline-style-driven ones; `clay-contrast.mjs` exits 0; curl of
the served page and stylesheet greps the new markers. Cache buster →
`v=20260805-clay1`. Landing page deliberately untouched beyond what falls out
of the token change — a later phase owns it, as does the bottom tab bar + FAB.

## Phase E — Dashboard + command bar in clay (2026-08-05)

The user's complaint was specific: the top of the dashboard was cluttered, said
OPEN twice, spent vertical space on a marketing tagline, and rendered the
in-progress trade as boxes inside boxes.

**Command bar.** The brand collapses to the mark alone — the kicker and the
"Execution analytics, risk control, and discipline tracking…" tagline were
DELETED from `index.html`, not hidden, in the sidebar and the desktop nav. The
dashboard view head lost its own duplicate kicker and, via a compound
`.view-head.view-head-dashboard` selector, its Phase D clay box: everywhere
else a `.view-head` is still a clay panel, but here a header box was eating
rows the numbers should own.

**In-progress trade, rebuilt.** One calm clay object instead of a 5-cell chip
grid: identity row (symbol + direction + ONE status chip), the live price as a
33px tabular hero numeral with its move beside it, two quiet 44px pill actions,
and entry/SL/TP/$ folded into the existing disclosure. The chip now reads
"Live" and wears `--info`, not the money green Phase C gave it — `--pnl-*` is
money by contract — so "OPEN" survives only as the percent node's no-feed
fallback, which `patchLiveNodes` also writes. Money colour rides the MOVE, not
the price: the price keeps full-contrast `--text` and the sign glyph carries
direction. All four `data-live-field` tags, both `data-*` handlers,
`.is-details-open` and the `<strong>` the toggle relabels are preserved. ~120
lines of now-dead `.progress-trade-price-chip*` / `-live-inline` CSS deleted.

**Dashboard.** Bento gaps 12→16px (clay without air reads as a bug), stepping
back to 12 at 560px. Score items became pressed wells, chart panel heads got
air, `.panel-chart canvas` dropped to the clay-sm radius, and panel hover lift
no longer *transitions* box-shadow — a 4-layer clay stack re-blurring on every
pointer pass is the repaint mobile Safari cannot pay while the 5s loop runs.
`--chart-canvas-top/-bottom` were re-cut in BOTH themes: light was `#ffffff` on
a `#fbfbff` card, a well that read as a bump. Reveal retuned to `--ease-clay`
(cubic-bezier(0.22,1,0.36,1), no overshoot), 820ms base, 72ms stagger, 16px
travel. Mobile: command bar stacks at 900, buttons go 50/50 with `min-width: 0`
(the 760px block's 160px floor overflowed a 375px screen), the trade card drops
to one column at 560.

**Not touched, deliberately:** `.dash-rail-item` (its nth-child separator
shadows), the chart renderers, `--pl-intensity`, risk warn/breach, the
dataset-hash guard, the empty-state toggle, `.metric-grid.compact`.

**Verified.** `node --check app.js`; `tests/charts.smoke.mjs` green (12,206
ops); CSS braces 1100/1100 and no undefined `var()` beyond the five
inline-style/JS-driven ones; HTML tag balance clean; served page, stylesheet
and module greped for the new markers. Contrast harness extended with the
chart-well pairings, the status chip, both quiet actions and the move pill,
plus a luminance assert that the chart well is darker than the card in both
themes — all pass, worst text pairing unchanged at 4.57:1. Cache buster →
`v=20260805-clay2`.

---

## Phase F — Mobile tab bar, centre "+" FAB, responsiveness pass (2026-08-05)

**The headline ask lands.** A floating clay pill bar (research brief §7b, not
the notch-cut §7c variant — a mask clips `box-shadow` and would force the whole
elevation onto a `filter: drop-shadow` wrapper) with a 60px raised accent
circle overlapping its top edge. Four destinations: Dashboard / Review /
Calendar / Reflect; Trade Entry belongs to the FAB and Monthly Review stays
behind the sidebar hamburger, which keeps working untouched.

**Zero router changes.** The four tabs carry `class="nav-btn"` + `data-target`,
which is exactly what `ui.navButtons` already collects — so `switchView()`, the
hash router, the `is-active`/`aria-current` sync and the auth-gate `disabled`
pass own them for free. app.js gained precisely two lines: `tabBarNewTradeBtn`
in the `ui` map and one `?.addEventListener` next to `#journalNewTradeBtn`. No
module-level state, so the init()/TDZ trap was not approached.

**Geometry contract** (every number derives from four): bar inset 12px +
safe-area, bar height 64px, FAB 60px centred on the bar's top edge (so it
protrudes exactly 30px, `bottom: safe + 46`), clearance 12+64+30+18 = 124px.
Clearance is `padding-bottom` on `.site-footer`, **not** on body — `html, body`
are `height: 100%`, so body padding lands at the 100vh mark instead of after
the overflowing content. `scroll-padding-bottom` matches. Landscape phones
(`max-height: 480px`) get a 52/52 compact set at 108px clearance with labels
clipped screen-reader-only (never `display:none` — that strips the accessible
name). Viewport meta finally gained `viewport-fit=cover,
interactive-widget=resizes-content`; a `:has(input:focus)` rule slides both bar
and FAB out while a text field is focused so the keyboard cannot trap them.

**A11y.** FAB is a `<button>` sibling OUTSIDE the `<nav>` landmark (inside it
screen readers announce "5 of 5, tab"); its non-circular route is the sidebar's
Trade Entry item, and `#journalNewTradeBtn` from 900px up. Active tab is never
colour-only — accent + a 3px indicator rail + `aria-current`. Pressed states
pair the squish with a fill change, never shadow alone. `:not(:focus-visible)`
guards the active tab's `box-shadow: none` or it would outrank the global focus
ring. Icons are inline SVG, `stroke: currentColor`, no external assets.

**Responsive pass.** 44px floor on `.btn`, `.mini-btn`, `.nav-toggle`,
`.direction-btn`, `.strategy-toggle-btn`, `.tag-set label`, `.row-actions
.mini-btn` and the sidebar list under `(max-width: 899px), (pointer: coarse)`.
Last sub-11px type in the app (`.dash-rail-item .metric-delta`, 10.5px) → 11px
with tighter padding. `.dash-quad-card .metric-value` floor went
viewport-relative below 560px: "-$1,234.56" at the 24px desktop floor needs
144px and a 360px phone gives the cell 128. `#journalNewTradeBtn` hides below
900 — a second New Trade button 40px from the FAB is noise.

**Verified.** `node --check app.js`; CSS braces balanced; served page,
stylesheet and module greped for `tabBarNewTradeBtn` / `.tabbar-fab` /
`viewport-fit=cover`; 16 `.nav-btn` all carrying `data-target`. Contrast
harness extended with four pairings (FAB glyph on the accent gradient top, tab
label, active tab + indicator, tab hover) — all pass both themes, worst new
pairing 5.03:1 (DARK accent on `--surface-2`), global worst unchanged at
4.57:1. Overflow reasoned at 360/375/414/768: table is card-mode ≤900, calendar
is agenda ≤760, canvases size from `clientWidth`, every grid resolves to
`minmax(0, 1fr)`. Cache buster → `v=20260805-clay3`.

---

## Phase G — Guest (demo) mode + the landing's clay finish (2026-08-05)

**The complaint was a trust problem.** "Create an account to see anything"
undercuts a free product. So the app is now fully usable without one, and the
ONLY thing an account buys is persistence — which the whole design says out
loud rather than discovering at the moment of loss.

**Storage-target indirection, not a second code path.** `readStorageJson` /
`writeStorageJson` in `src/lib/core.js` grew an optional third `store`
argument (defaults to `localStorage`), and `loadState` / `persistState` /
`renderLastSaved` route through two new one-line helpers, `journalStore()` and
`journalKey()`. Demo mode resolves to `sessionStorage` under a `demo:` prefix:
dies with the tab, cannot collide with a real key name, cannot be read back
into a real session. `state.auth.isAuthenticated` stays **false** throughout,
so `queueServerAutosave()`, `saveToPhpStorage()`, `loadFromPhpStorage()` and
the CSRF/session logic exclude the demo *by construction* — not by a new
guard that could rot. `tests/guestStorage.check.mjs` drives the real helpers
against fake Storage objects and asserts localStorage is untouched.

**Sample journal, generated not shipped.** `buildDemoJournal()` derives 16
closed trades + 1 open XAUUSD position + 2 reflections from a spec of four
instruments, a fixed 16-entry R sequence and index-cycled context fields.
Sizes are tuned so every trade risks ~1% of the $10k starting balance, giving
9W/6L/1BE, +12.6R = **+$1,260** over 27 days — a believable month, not a
highlight reel. `tests/demoJournal.check.mjs` runs the real generator through
the real `calculateTradeMetrics`/`getPipSpec` and asserts each R-multiple.
Every row is labelled `SAMPLE DATA —` in its notes and stamped with
`importBatchId: "demo-sample-journal"` (a field `normalizeTrades` already
preserves), which is what makes honest carry-over possible.

**Carry-over that cannot destroy a journal.** `takeGuestCarryOver()` runs in
`submitAuth` only *after* the server confirms the account — a failed login
leaves the demo intact. It keeps only non-sample work, tears the demo down and
reloads the real localStorage journal so the rest of the auth path is the
ordinary one. **Register** carries over automatically (a new account has
nothing to lose). **Login** appends, never replaces, and only after an
explicit `confirm()` naming the count — an existing journal is never silently
overwritten.

**Honesty surface.** A sticky `.demo-notice` lives outside every `.view`, so
it is on all six screens; Hide dismisses it for the current view and
`switchView` brings it back. `nudgeGuest()` re-shows it and writes the same
sentence at the three moments persistence would have mattered — saving a
trade, exporting CSV/JSON, and the server Save/Load buttons (which now say
"the server journal needs an account" instead of "login first"). A third
message tone, `.form-message.notice` on `--warn`, exists because red says
"it failed" (it did not) and green says "all good" (it will not persist).
Logout becomes **Exit demo**: no request is sent, sessionStorage is wiped, the
real journal reloads.

**Landing in clay.** `--depth-shadow`/`--depth-shadow-sm` now resolve to
`--clay-float`/`--clay-raised` and `--glass-top/-bottom` became opaque whisper
gradients, which converted the hero terminal, showcase frame and closing CTA
in two token edits. Then targeted work: radii to the clay scale (32 on hero
surfaces, 26 on cards, 20 on nested cells), every container border dropped to
`--clay-edge`, the proof strip from two hairlines to a `--clay-soft` tray, the
feature icon and tape cards to pressed wells, the showcase money rail from
`border-left` to an inset (a 2px edge tapers into a wedge against a 20px
radius), and step/feature hover to **transform only** — a 4-layer large-blur
stack must never be transitioned.

**Not touched, deliberately:** `.dash-rail-item` (fifth phase running — its
nth-child separator shadows), the ledger/tape/showcase rows and the auth
modal, all of which stay flat. No new module-level state below `init()`; every
demo constant sits beside `STORAGE_KEYS`, far above the call.

**Verified.** `node --check` on app.js and core.js; `php -l` clean;
`tests/charts.smoke.mjs` green (12,206 ops); the two new check scripts green;
CSS braces 1170/1170 with no undefined `var()` beyond the five JS-driven ones;
served page/stylesheet/module greped for the new markers. Contrast harness
extended with 16 pairings — the demo chip, notice copy, Hide, the notice tone
on two surfaces, the "See inside first" label, the CTA fine print and eight
landing-glass pairings (the glass values changed, so every hero-terminal and
showcase numeral moved). All pass both themes; worst new pairing **4.92:1**
(LIGHT, `--warn` on `--surface-inset`), global worst unchanged at **4.57:1**.
Cache buster → `v=20260805-clay4`.

## Clay V2 — imported from claude.ai/design (2026-08-06)

Imported the "Fable 5 trading redesign" project via the DesignSync MCP and implemented `Redesign.dc.html`'s handoff, `handoff/clay-v2.css`, as `clay-v2.css` — a drop-in layer loaded after `styles.css` that retones tokens rather than restructuring markup.

**What changed.** Palette moves off blue-graphite onto a warm bone ground (`--surface-0: #e2dace`) with a violet accent (`#6b3ed8` light / `#9e7bf0` dark); light becomes the primary theme and dark is re-derived warm rather than inverted; Sora → Space Grotesk (JetBrains Mono stays, since swapping the numeral face would move every journal column width); radii go up one rung (clay stops reading as moulded below ~14px). Charts needed zero JS: `charts.js` reads its palette from `getComputedStyle` and re-reads on `themechange`, so retoning the tokens retoned all seven canvases plus the sparkline.

**Depth as data** is the rule that carries the redesign: raised = profit, pressed = loss, travel scaling with `--day-intensity`. Applied to calendar cells (grid becomes a pressed well with air between tiles), losing metric cards, and journal rows. The money colour and the result pill still carry the state, so depth is never the sole signal (WCAG 1.4.1).

**Two "REQUIRES MARKUP" items from the handoff were implemented:**
- Journal rows now get `.trade-row-win` / `.trade-row-loss` from `renderJournalTable`; open rows stay flat since the outcome is not yet known.
- The `⌘K` hint span was added to `#journalNewTradeBtn` — and the shortcut was actually wired (`mod+K` → `openFreshTradeEntry`), because a keycap that does nothing is a worse affordance than none. The sidebar shortcut list was updated to match.

**Two corrections to the handoff, both measured:**
- Light `--text-faint` shipped as `#6f6659`, tuned against `--surface-1`. It also lands on `--surface-inset` (table heads, wells) where it measured **4.27:1**, under the 4.5:1 body floor. Darkened to `#6a6154` — 4.61:1 on inset, 5.36:1 on `--surface-1`. Worst surviving pairing across both themes is now 4.61:1.
- §7 grows `.dash-spark-wrap` from 74px to 118px, but the mobile hero reserved only 82px of padding-bottom for it (tuned to the old height), so the delta and "Today" chips fell inside the carved well. Re-reserved at 126px in a §9 block appended on import.

**Not implemented, deliberately.** The design doc's sections 1b (natural-language quick capture), 1c (unjournalled-trade queue) and 1f (six proposed features — playbooks, setup pages, equity-curve scrubbing, voice notes, drafted weekly review, loss-budget speed bump) all change application logic. The instruction was "change the whole design but keep the same logic", so they are catalogued here as the next build, not shipped.

**Verified:** both themes at 375 and 1400px; all seven canvases plus the sparkline repainting on the violet retone; journal rows 7 raised / 4 pressed / 1 flat-open; calendar loss tile pressed; ⌘K opens trade entry; FAB at 66px with no tab overlap; no horizontal overflow; charts smoke test green; CSS braces balanced.

## Phase 1a — Dashboard (2026-08-07)

Implemented `docs/renovation/design-source/1a-dashboard.html`, replacing the dashboard view and the top nav outright.

**Nav.** The six-item text nav is gone (1f listed it as a cut). `.desktop-nav` → `.topnav`: TJ mark, DASH / TRADES (unjournalled badge) / CAL / JOURNAL, a RULES action, a moon toggle and a `<details>` overflow menu (Trade entry, Monthly review, Export CSV, dev preview, Logout). Every destination still carries `.nav-btn` + `data-target`, so `switchView`, the hash router, `aria-current` and the auth gate are unchanged. The TJ mark shares dashboard's `data-target` and is marked `data-nav-silent` so only one element claims `aria-current="page"`. Mobile keeps the sidebar drawer + tab bar; the top bar is desktop-only. `positionNavRail` and its rail CSS are deleted — the active item is a moulded pill now, and two active affordances read as a bug.

**Dashboard.** New header: greeting (`Wednesday · London open in 42m`, computed by `src/lib/sessions.js` against each venue's own zone via Intl, weekends rolled forward, DST free) + `Good morning, <name>.` (journal name, else username, else no address — never invented) + an inline LIVE ticker + `Log a trade` with ⌘K. The ticker is the old in-progress strip restyled; the 5s poll still patches its `[data-live-field]` nodes in place, and its `aria-live="polite"` was dropped — announcing a price every 5s is hostile. `.journal-action-bar` is deleted; `#journalNewTradeBtn` / `#exportCsvBtn` kept their ids in their new homes.

**Cards.** Balance hero gains a working 1M/3M/ALL toggle (scopes the sparkline and a range-return chip) plus today's change and vs-last-week, all read off `analytics.equity`/`equityDates` — never off a manual balance override. Risk card: SAFE/WARN/BREACH, an SVG dial on the *tightest* of the daily/weekly budgets, used/limit figures, and a consequence line computed from the real budgets × risk-per-trade ("2 more losses at 1% and the desk locks until tomorrow"). Cooldown/RULES both jump to Risk Controls — phase 6 owns the actual lock. Metric deltas now lead with ▲/▼ and say "— sinking" in words, and a negative quad tile sinks (§5b), so depth is never the only signal.

**New boards.** Playbook renders expectancy per setup from `setupStats` as raised/sunk clay tiles with net, count and win rate; an alert appears only when a setup's most recent closed trades are an unbroken run of ≥3 losses, naming the dominant psychology tags. Unjournalled: rule is **closed trade with an empty notes field** (psychology ships with a populated default, so testing it would flag nothing) — count, three most recent rows, chevron jumps to and flashes that row in the journal view, plus a journal streak (consecutive trading days fully journalled) and 7 real per-day bars. With an empty queue the card flips to an all-clear state rather than hiding, so the streak stays visible.

**Deleted.** 733 lines of superseded CSS (`.desktop-nav*`, `.journal-action-bar`, `.progress-trade-*`, `.view-head-dashboard`, `.nav-btn-top`, `.nav-logout-desktop`), the progress-card disclosure, `positionNavRail`, `renderDashHeroToday`. The 7-item secondary rail (drawdown, streaks, best/worst day) is **kept** below the quad: the mockup omits it but nothing else in the app surfaces those numbers, and deleting them would lose data, not chrome.

**Verified.** `node --check` on app.js; `src/lib/sessions.js` imports clean; `tests/charts.smoke.mjs`, `tests/demoJournal.check.mjs`, `tests/guestStorage.check.mjs` green; new `tests/sessions.smoke.mjs` green (DST both ways, weekend roll-forward, the 09:30 ET half-hour open, formatting); `php -l` clean; CSS braces balanced in both sheets; every `getElementById` target in app.js resolves in index.html apart from the four pre-existing JS-injected admin ids; served page greped for `topnav-btn`, `dash-log-btn`, `riskDialArc`, `dashPlaybookGrid`. Focus rings restored where clay shadows out-specified them; `@media (pointer: coarse)` lifts the range and Close controls to 44px. Cache buster → `v=20260807-dash1a`.

## Phase 1b — Quick capture (2026-08-07)

Implemented `docs/renovation/design-source/1b-quick-capture.html`. The long trade-entry form stops being the way you open a position; it becomes the detail/edit form it always really was.

**Route 1 — ⌘K command bar.** New `<dialog id="captureBar">`. One mono input, parsed live by the new `src/lib/tradeParse.js` (pure, DOM-free): symbol aliases (`btc→BTCUSDT`, `gold→XAUUSD`, 25 in all, everything else passes through upper-cased), long/buy/short/sell, `sl|stop`, `tp|target`, `size|qty|lots`, risk as `1%` / `$250` / `risk 2`, glued and `=`/`:` forms (`sl117900`, `sl=117900`), and a positional fallback so bare numbers fill entry → stop → target. The chip row is the interpretation, not a prediction: resolved symbol, LONG/SHORT, entry, stop, `risk 1% = $140.30` converted against the **real** account balance, the computed size, and `no target — R:R unknown` when no target is given. Enter saves and closes with no screen change; a `role="status"` toast is the only feedback. Unparseable input refuses — 10 failure cases, including a stop on the wrong side of entry (the mistake that silently inverts risk).

**Route 2 — the sheet.** New `<dialog id="tradeSheet">`, five fields: Symbol, Direction (Long/Short segmented, the chosen side lifts and takes its money colour), Entry, Stop, Risk (0.5 / 1 / 2 / Custom chips). Live readout of SIZE / AT RISK / BUDGET AFTER, all computed: size runs the real stop distance through the app's own `getPipSpec` pip model (lots for forex/metals, base units for crypto), at-risk is `balance × risk%`, budget-after is the configured daily loss limit minus today's realised P&L minus this trade. No daily limit set ⇒ it says `no limit set` rather than inventing headroom. Below it the pre-trade checklist (`PRE_TRADE_RULES`, fixed ids so a label rename never orphans history) with the mockup's copy; ticked ids are stored on the trade as `trade.preTradeRules`. `Open trade` writes an **open** position; `Add detail` hands the five fields (plus inferred context and computed size) to the full form without saving.

**Route 3 — thumb.** `#tabBarNewTradeBtn` no longer navigates: it opens the same sheet, which is a bottom sheet under 620px with `transform-origin: bottom center` so it grows out of the FAB. `openQuickCapture()` routes touch/mobile to the sheet and desktop to the command bar, so ⌘K and `Log a trade` are the same affordance everywhere.

**Inference, honestly.** A five-field capture still needs a full record. Session comes from the real clock (`getNextSessionOpen`), market from the symbol, setup and timeframe carry over from the last trade — all structural and editable. **Psychology and execution quality are deliberately NOT carried over**: they are post-trade judgements and belong to step 2 (Close & journal, next phase), so they keep the schema defaults `normalizeTrades` already applies. The step-2 half of the indicator is rendered as pending and is not a control.

**Deleted / changed.** `openFreshTradeEntry()` and all three of its call sites; the trade-entry view head is retitled "Full trade detail" and now says what it is for. `buildTradeRecord` carries `preTradeRules` across an edit (`readTradeForm` never asks for them, so an empty array is absence, not a de-tick); `normalizeTrades` defaults them to `[]` for every pre-existing and imported row.

**Verified.** `node --check app.js` and `src/lib/tradeParse.js`; new `tests/tradeParse.check.mjs` (40 assertions — the mockup's exact line, aliases, every keyword form, both risk units, and the 10 refusals) green; `charts.smoke`, `demoJournal.check`, `guestStorage.check`, `sessions.smoke` all green; served page greped for `captureBar` / `tradeSheet` / `sheetRulesList`, served `app.js` for `openQuickCapture`, served `clay-v2.css` for `sheet-readout-val`. Both themes tokenised (no new hexes except the two direction-button clay shadows, which are hue-matched to `--pnl-pos`/`--pnl-neg`); focus rings restored on all 6 new clay controls; rule rows and every button ≥44px; reduced-motion kills both dialog animations and the backdrop blur. Cache buster → `v=20260807-capture1b`. Not verified in a browser (browser tools were off this phase).

## Phase 1c — Close & journal (2026-08-08)

Implemented `docs/renovation/design-source/1c-journaling.html`. Step 2 lives in the **same** `<dialog id="tradeSheet">` as 1b — two `.sheet-body` forms, one visible at a time (`setSheetStep`) — so "open → close → journal" is one object and the step indicator is honest (step 1 becomes a tick).

**The sheet.** Everything the trade already knows is printed, never asked: `Closed · 14:22 · London` (real `closedAt` + the trade's own session), symbol, `SHORT · H1 · Breakout`, signed net, and `Loss · -1.00R · -42.00 pips`. The result **word** is in that line on purpose — colour and clay depth are never the only win/loss signal (WCAG 1.4.1). Four inputs, one tap each except the note: mood chips (Focused / Hesitant / Emotional / Revenge / Perfect — labels only; the stored values stay `Revenge Trade` / `Perfect Execution`, so the psychology filter, the psychology chart and every historic trade are untouched), an A+/A/B/C/F grade row, multi-select "what went wrong" tags, and the note textarea. Chosen chips lift out of the sheet, unchosen ones stay pressed into it; a ticked mistake tag sinks and goes red with a ✓ prefix. `aria-pressed` is flipped **in place** rather than by re-render, so a keyboard user pressing Enter on a chip does not lose focus.

**Custom tags.** The vocabulary is the four seeds plus every tag any trade already carries — so a custom tag persists the moment its trade is saved, with no parallel store, no settings-schema change and nothing to migrate. `+ new tag` reveals an inline input; Enter commits (case-folded onto an existing tag if it only differs by case) and focus lands on the new chip.

**Chart.** Drop, paste or pick. The paste path is a document-level listener gated on the sheet being open (text pastes still reach the textarea); the `⌘V paste chart` button uses `navigator.clipboard.read()` and **hides itself** where that API does not exist rather than shipping a control that fails. Storage reuses the existing screenshot fields and the existing 350KB inline cap, now a single shared `MAX_INLINE_IMAGE_BYTES` + `readInlineImage()` that the trade form also uses — one size ceiling in the app, not two.

**Voice note: omitted, deliberately.** The mockup's `🎙 Voice note` is not shipped. There is no blob backend; the journal lives in localStorage (sessionStorage in demo mode), ~5MB for everything, already shared with 350KB screenshots. And with no speech API there is no transcription, so a stored clip would be unsearchable bulk that cannot enter any analytic. Per the brief, omitted and declared rather than shipped dead.

**The queue.** New predicate `isTradeJournalled(trade)` = `journalledAt || notes` — one rule for the card, the mobile pill, the streak, the bars and the nav badge. The `notes` half is the migration: every trade written before today keeps exactly the status it had. The queue rows, the new `Journal` action on every closed journal row, the ticker's Close and the journal table's Close all open this sheet for that trade; saving stamps `journalledAt`, drops it out of the queue and advances the streak, and the toast says how many are left. Mobile gets the mockup's dark `Trades to journal` pill (count + chevron) in place of the row list under 620px, pointed at the oldest trade still waiting.

**Deleted / changed.** `focusTradeInJournal()` and its `#journal tbody tr.is-flagged` CSS are gone — the chevron opens the sheet instead of scrolling to a table row. `handleScreenshotUpload` rewritten onto `readInlineImage`. `normalizeTrades` gains `mistakeTags: []` and `journalledAt: ""`; `buildTradeRecord` carries both across a full-form edit the same way it carries `preTradeRules`; CSV export gains both columns (every cell is quoted, so the comma-joined tags are safe).

**Verified.** `node --check app.js`; new `tests/journalQueue.check.mjs` (slices the real predicate + tag vocabulary out of `app.js`: pre-1c notes-only trades stay journalled, whitespace is not a note, graded-with-no-note counts, case-variant tags fold, empty tags never enter) green; `charts.smoke`, `demoJournal.check`, `guestStorage.check`, `sessions.smoke`, `tradeParse.check` all green; `php -l index.html` clean; CSS braces balanced; served page greped for `journalSaveBtn` / `dashJournalCta`, served `clay-v2.css` for 55 `jrn-` hits, served `app.js` for `openJournalSheet`. No new hexes — every colour is a token, both themes. Nothing new animates, so no reduced-motion branch was needed. Focus rings restored on all 8 new clay controls; chips, grades, the drop zone and the mobile pill are ≥44px. The desktop-only `:has()` width bump is fenced above 621px so it cannot out-specify §11e's bottom sheet. Cache buster → `v=20260808-journal1c`. Not verified in a browser (browser tools were off this phase).

## Phase 1e — Trade Review + Calendar (design-source/1e-review-calendar.html)

**Trade Review.** The `.view-head` + `.filter-grid` panel is gone. Header is now
`.rev-head`: "Trade Review", a live count line (`N of M trades · filtered to …`,
every clause read off a filter that is actually on — never the mockup's fixed
"last 30 days"), the search well with its `/` hint (the `/` shortcut was already
wired), and Export. `.rev-chips` is the primary control: All / Wins / Losses /
Rule broken / "No note · N" plus Setup ▾ / Session ▾ / Mood ▾ as native
`<select>`s styled as chips — no custom dropdown, no JS, keyboard for free.
"Rule broken" = `riskPercent > settings.riskPerTrade`, the same predicate
`calculateAnalytics` uses, so the chip and the Risk Controls list can't disagree.
Date range, market, timeframe, Clear Filters and the backup/import/server
buttons moved into a `<details class="rev-more">` and stay reachable.

**Table 13 → 7 + chevron.** Date, Symbol, Setup ("Liquidity Grab · H1 ·
London"), Net, R, Pips, Mood. Market, direction, result pill, execution, prices,
risk, the 1b checklist, 1c tags and notes, and all row actions moved into the
detail row the chevron opens (`expandedTradeIds`, patched in place so the 5s
live tick is never restamped mid-hover). Click-to-sort and the ≤900px card
transform both still work. Depth now scales: `--row-intensity` per row from the
biggest result on screen. Colour + the signed `+/-` on Net and R + the Result
pill in the detail carry win/loss independently of depth (WCAG 1.4.1).

**Calendar.** "August 2026" is the heading, meta is `14 trading days · 44 trades
· most traded BTCUSDT`, MONTH NET sits beside ‹ ›; the two summary cards are
deleted (and their CSS stripped). The month `<input>` survives as a compact
"jump" control — arrows walk, it leaps. Tiles are day number / signed P&L / one
meta line. Day click still sets the journal date filters and switches view, and
now opens the More-filters disclosure so the applied range is visible.

New: `state.filters.quick` + `state.filters.session` (the Result `<select>` was
deleted and folded into the chips). New check: `tests/reviewFilters.check.mjs`.

## Phase 1d — Landing

The logged-out shell is replaced end to end: top bar (TJ mark + Trader Journal,
Log in, Start free) → hero → "What you get back" → closing CTA. Deleted with it:
the aurora/grid-floor/scanline atmosphere, the `#landingAtmos` equity canvas and
its 132-line renderer, the landing parallax rAF, the hero-terminal 3D tilt, the
proof strip, the fake dashboard showcase (1f says the live tape does that job
honestly), the how-it-works rail, the feature triptych and the capability
ledger. ~1,380 lines of landing CSS replaced by ~640; 57 dead selectors stripped
from the rest of styles.css. `setupHeroTilt` / `setupLandingAtmos` /
`setupLandingParallax` / `drawLandingAtmos` / `toggleLandingTradePreview` /
`syncLandingExpandedLayout` and `state.landingFeed` all deleted.

**The tape.** Rewritten to one row per CLOSED trade (7 max), no Open/Closed
sections, no Show/Hide. Depth as data: a winning row is raised, a losing row is
sunk — and the WIN/LOSS/FLAT word plus its money colour ship with it, so depth
is never the only signal.

**Honesty.** (1) The mockup's "1,284 trades journalled this week" has no
backend; the badge counts the rows actually on the tape inside a real 7-day
window and hides itself at zero. (2) The mockup's `+2.4R` tape column is not
rendered — the public feed is whitelisted server-side to symbol/direction/
result/date, so R cannot be produced truthfully. (3) "delayed 2s" became
"delayed": the feed loads once, there is no 2s figure to claim. (4) The
Expectancy-by-setup panel is labelled Example in the tag, the accessible name
and a footnote — a logged-out visitor has no journal to draw it from. (5) The
tape caption re-stamps itself when the rows come from a demo/preview journal
instead of the public feed.

The hero email field is real: it is handed to the auth panel's identifier input
(username OR email) and focus moves to the password. Auth modal, reset flow,
guest/demo entry (`[data-start-demo]`, two entry points) and the dev preview
chip all still work. AA verified for all 13 new text/background pairs in both
themes — the pill tints and the Example tag had to come off `--pnl-*-soft` /
`--warn-soft`, and `--text-soft`/`--text-faint` are darkened one step inside the
shell (light only) because the page ground measured 4.3:1.

New check: `tests/landingTape.check.mjs`.

---

## Phase 1f — System features (#01–#03)

`design-source/1f-features.html` #01–#03, "the top three are what turn the
journal from a record into a system", plus the last cut from "Things I would
cut".

**#01 unjournalled queue — finished.** The counted badge now ships in the dock
as well as the top bar (`#tabBarUnjournalledBadge`, same count, one render
loop). The streak rule is stated on screen, not just in a comment: "A day
counts once every trade you closed that day carries a note. Days you did not
trade are skipped."

**#02 pre-trade checklist.** `PRE_TRADE_RULES` (a module const) became
`state.settings.preTradeRules`, edited in a new **Pre-trade checklist** panel —
which is where the RULES top-bar action now lands. Ids are stable across a
rename and fall back through the seed list, so historic ticks never orphan.
The causal half needed a new field: `trade.preTradeRulesAsked`. Without it
`preTradeRules: []` means both "never asked" and "asked, ticked nothing", and
only one of those is a skipped rule — every pre-1f row, every import and every
⌘K capture would have counted as three phantom skips. The Discipline Monitor
now carries **What the checklist costs**, and renders a verdict only when a
rule has ≥5 closed trades on BOTH sides; below that it prints the threshold and
how close the best-covered rule is.

**#03 cooldown lock.** `getCooldownState()` fires on weekly-budget breach,
daily-budget breach, or N consecutive losses (N and the on/off switch live in
Risk Controls; 0 disables the streak trigger). All four routes into logging —
the dashboard button, the FAB, the empty-state CTA and ⌘K — pass through
`requestTradeCapture()`, which asks one question first. It is a speed bump:
answering always proceeds, and the answer is stamped on the trade
(`cooldownOverride` / `cooldownNote`), which is what makes "2 cooldown
overrides, −$160, 1 tagged Revenge Trade" computable. "Cooldown rules →" now
has a real destination.

**The cut.** `<details id="tradeAdvancedDetails">` is gone. Psychology,
execution grade, screenshot and notes are four ordinary sections in the form
flow; 1,978 chars of `.trade-advanced-*` CSS stripped.

Not swapped: the cooldown button keeps its accent background and gains a warn
ring + a worded badge — `--accent` and `--warn` invert between themes and one
background override cannot keep the label legible in both.

New check: `tests/systemFeatures.check.mjs` (rule ids through a rename, the
asked≠ticked split, all four cooldown triggers, the override log).

## Full redesign verification pass (2026-08-09)

Browser-verified all six shipped sections. Two defects found and fixed.

**1. Boot-aborting temporal-dead-zone error (critical).** `QUICK_FILTER_LABELS` was declared as a module-level `const` below the top-level `init()` call, so `describeJournalFilters()` → `renderReviewHeader()` → `renderJournalTable()` → `renderAll()` threw `ReferenceError: Cannot access 'QUICK_FILTER_LABELS' before initialization` on every page load. This aborted `init()` mid-render, which silently disabled everything bound after it — most visibly the ⌘K command bar's live parse readout, which stayed stuck on its empty-state help text no matter what was typed. Hoisted above `init()` next to `dashSparkHash`/`METRIC_DELTA_SPECS` with a comment naming the trap.

This is the FOURTH time this exact failure mode has shipped in this codebase (`getClosedTrades`, `METRIC_DELTA_SPECS`, `dashSparkHash`, now `QUICK_FILTER_LABELS`). The pattern is documented in the workflow brief and in memory; it keeps recurring because the file is large and new module state is naturally appended at the bottom.

**2. Unsigned expectancy on losing playbook tiles.** The sunk tile rendered `▼ $210.00/trade` — the arrow, colour and the signed `Net −$420.00` line carried the loss, but the headline figure itself read as a positive per-trade expectancy at a glance. The design source signs it (`Reversal -$68`), so the minus was restored.

**Verified working:** compact TJ top bar with unjournalled badge and overflow menu; greeting with real per-venue session countdown; LIVE ticker; balance card with 1M/3M/ALL re-scoping; risk dial (78% LEFT, SAFE) with the computed consequence line; four edge tiles; playbook raised/sunk tiles from real setupStats; unjournalled queue; ⌘K live parse (`btc long 118400 sl 117900 1%` → BTCUSDT / LONG / entry 118,400 / stop 117,900 / risk 1% = $140.30 / size 0.2806 BTC / no target — R:R unknown); the five-field sheet with live SIZE/AT RISK/BUDGET AFTER and the pre-trade rules checklist; Trade Review filter chips with real counts and the reduced 8-column table; calendar with computed month net; landing with the honest tape counter, raised/sunk rows and the fake dashboard mock removed. Zero console errors; all nine test files green.

## Phase 2a — PHP → Vercel port: audit and specification (2026-08-05)

No application code. `trade_handler.php` read in full, `db/schema.sql` and every
`fetch()` in `app.js` / `src/modules/livePrices.js` inventoried, and the four
architectural unknowns settled with local evidence where evidence was possible.

**The bug.** Vercel has no PHP runtime, so `trade_handler.php` is never executed
there — it is served as a static file. Every API call gets HTML/PHP source
instead of JSON, which surfaces as "Auth service unavailable". Two consequences
the port must fix, not one: the API is dead, *and* the handler's source is
publicly readable.

**Bcrypt interop — proven, not assumed.** `bcryptjs@3.0.3` (pure JS, no native
build, the only thing that survives serverless bundling cleanly). Verified both
directions locally with PHP 8.5 and Node 25:

- Node verifies PHP `$2y$` for ASCII, an 80-byte password, and a UTF-8 password
  with emoji; rejects the wrong password.
- `bcryptjs` emits `$2b$`. PHP's `password_verify()` accepts that `$2b$` output
  as-is, and also accepts it with the prefix rewritten to `$2y$`.

`$2y$`, `$2a$` and `$2b$` are the same algorithm — the letter is a marker, not a
parameter, and bcryptjs handles all three. New hashes will be written with the
prefix rewritten to `$2y$` so the column stays uniform and a rollback to the PHP
handler still logs everyone in. The frozen hash/password pair becomes a
committed test fixture (synthetic — not a real account).

**Sessions.** Signed HttpOnly cookie (HMAC-SHA256, `node:crypto`, no dependency)
carrying `{uid, username, csrf, iat}` — chosen over a sessions table because the
table buys revocation and nothing else, and revocation can be had for free from
data already in `login_info`: a cookie is refused when the user has a successful
`logout` or `reset` row newer than the cookie's `iat`. That keeps PHP's
server-side logout invalidation *and* closes the gap PHP had, where a password
reset did not kill live sessions. Zero schema change.

**Postgres.** `pg` with a module-scope `Pool({ max: 1 })` cached on `globalThis`,
so each warm instance holds at most one connection. Neon's HTTP driver was
rejected: it only speaks to Neon, and the live database is Railway. The user's
`DATABASE_URL` on Vercel must be the **public** Railway URL —
`*.railway.internal` is unreachable from outside Railway.

**No DDL at runtime.** The PHP re-ran ~30 `CREATE TABLE IF NOT EXISTS` /
`ADD COLUMN IF NOT EXISTS` statements on every single request. The port issues
none. The live schema already matches `db/schema.sql`, and the strongest
data-safety guarantee available is that the new code cannot alter it.

**Two findings that are not obvious.** (1) Vercel applies `rewrites` *after* the
filesystem check, so a deployed `trade_handler.php` would shadow the rewrite and
keep serving source — `.vercelignore` must exclude it, and must also carry over
the `.dockerignore` exclusions (`db/`, `docs/`, `scripts/`, `tests/`), which
zero-config Vercel would otherwise publish as static downloads. (2) Vercel caps
request and response bodies at 4.5 MB. `save` posts every screenshot on every
write (350 KB cap each, ~467 KB base64), so roughly nine attached screenshots
break saving. PHP had no such ceiling. Port keeps PHP semantics exactly and the
ceiling is logged as the first follow-up.

## Phase 2b — PHP → Vercel port: the build (2026-08-05)

The port itself. `trade_handler.php` is **not deleted** — the cutover phase does
that, so rollback stays a one-line `.vercelignore` edit until the port is proven
against the live database.

**Shape.** `api/handler.js` is the only function; `vercel.json` rewrites
`/trade_handler.php` → `/api/handler`, so the URL contract is unchanged and
**app.js and src/modules/livePrices.js were not touched at all**. Behaviour lives
in `api/_lib/`: `router.js` (the 15 actions), `db.js` (all SQL), `session.js`
(signed cookie + CSRF), `sanitize.js` (payload coercion), `prices.js` (live
quotes). The handler does HTTP plumbing only. `ctx` carries db, env, clock and
`fetch` into the router, which is what makes every action testable against a
fake db with no Postgres, no network and no credentials.

All 15 actions ported: `session`, `register`, `login`, `forgot_password`,
`validate_reset_token`, `reset_password`, `logout`, `save`, `load`,
`recent_trades`, `public_recent_trades`, `live_prices`, `update_prices`,
`login_logs`, `users_admin`.

**Data safety, in order of strength.**

1. *No DDL, at all.* As specified in 2a. Asserted in `tests/apiDb.check.mjs`
   against the module source, not against one code path: `db.js` may contain no
   `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `DROP` or `TRUNCATE`, and the
   only `DELETE` permitted is the per-user screenshot re-sync the PHP also did.
   A fresh database is set up once by hand from `db/schema.sql`.
2. *Sanitizers proven equal to the PHP's, not merely similar.* The PHP sanitizer
   functions (lines 1418–2169) were extracted into a standalone harness and run
   over a fixture of deliberately awful rows — snake_case keys, numeric strings,
   missing fields, unparseable dates, screenshots, client-invented keys, a bare
   string and a null in the array. Output diffed against the JS. **Identical in
   every field bar one:** PHP encodes an empty replay-notes map as `[]`, JS as
   `{}`; `normalizeReplayNotes()` in app.js maps both to `{}` and `{}` is the
   column default, so it is invisible. That PHP output is now the committed
   expectation in `tests/fixtures/legacyRows.expected.json`, which keeps the
   guarantee after `trade_handler.php` is gone.
3. *Every write parameterised.* `'BAD; DROP TABLE trades;--'` as a symbol is
   rejected by the charset check and never reaches the driver — asserted.

**Bcrypt.** As specified: `bcryptjs@3.0.3` reads the existing `$2y$` hashes
(verified against real PHP output at cost 10 *and* cost 12 — PHP 8.5 moved
`PASSWORD_DEFAULT` to cost 12, so both may exist in the column, and the cost
travels in the hash). New hashes are written `$2y$` cost 10 by rewriting
bcryptjs's `$2b$` prefix; only the prefix changes, salt and digest are untouched,
and PHP's `password_verify()` accepts both — checked directly, so rollback still
logs everyone in.

**Sessions.** Signed HttpOnly `tj_session` cookie carrying
`{username, userId, csrf, iat, exp}`, HMAC-SHA256 via `node:crypto`. Revocation
comes from `login_info` exactly as specified: a cookie older than the user's
newest successful `logout` or `reset` row is refused. That required one addition
the PHP never had — a successful reset now writes a `reset` row (`success=true`,
so it cannot pollute the reset rate limit). Comparison is strictly greater, so
"log out, log straight back in" survives. Anonymous cookies carry no username
and skip the lookup entirely, so public page views cost no extra query.

**Security controls, all preserved and two improved.** CSRF on every
state-changing POST bar the four pre-session actions; DB-backed rate limit
(6 failures / 10 minutes, scoped by IP and — for login and forgot — identity,
checked *before* the user table is touched so it cannot be used as an account
oracle); auth on `update_prices`; admin gating with the bootstrap fallback still
opt-in; identical responses for wrong-password vs unknown-account and for
existing vs non-existing forgot-password addresses; no reset URL in any response;
no exception detail in any response. Improved: the CSRF token is now **rotated on
login and register** (PHP carried `$_SESSION` across `session_regenerate_id()`,
so a token planted before login stayed valid after it), and every response
carries `Cache-Control: no-store`.

**Front-end untouched.** `git diff` over `app.js`, `index.html` and `src/` is
empty. `res.status().send()` (a Vercel-only helper) was swapped for plain
`res.statusCode` / `res.end()` so the same function runs under `vercel dev` or a
bare node server — which is how it was smoke-tested.

**Verified locally:** 13 test files green (`npm test`), including four new ones —
`bcryptCompat`, `apiRouter` (CSRF, rate-limit window, public whitelist + cap,
dispatch, revocation, admin gating), `apiSanitize` (the PHP differential),
`apiDb` (no-DDL, parameterisation, TLS). Every backend module imports cleanly;
`php -l trade_handler.php` still passes; the front-end still loads from the PHP
dev server on 127.0.0.1:8000. `api/handler.js` was booted behind a real
`node:http` server: `action=session` returns 200 with a CSRF token and a correctly
flagged `Set-Cookie` (`HttpOnly; SameSite=Lax`, `Secure` only under HTTPS), and
with the database unreachable it returns the generic 500 with the connection
error in the log only.

**Cannot be verified without the user's database or a deploy:** that the live
schema matches what the queries expect; that existing rows load and re-save
unchanged; that real stored `$2y$` hashes authenticate; that the Vercel rewrite
resolves `/trade_handler.php` to the function rather than serving source (the
`.vercelignore` exclusion is what makes that work — filesystem beats rewrites);
Railway TLS negotiation from Vercel's network; Resend delivery.

**Left for the cutover phase:** delete `trade_handler.php`, `Dockerfile` and
`.dockerignore` — kept for now precisely so rollback is trivial. The 4.5 MB
Vercel body cap on `save` (~9 screenshots) is unchanged from PHP semantics and
remains the first follow-up.

## Phase 2c — PHP → Vercel port: cutover and cleanup (2026-08-05)

**The PHP is gone.** `trade_handler.php` (2,100 lines) deleted, along with
`Dockerfile`, `.dockerignore` and `scripts/migrate_legacy_json.php`. That last
one went for two reasons: it was the only remaining `.php` file, and it carried
the second copy of the `*.railway.internal → sslmode=disable` special-case plus
a drifted duplicate of the schema. Its job — importing file-based legacy JSON —
was done long ago; the data lives in Postgres. Git history keeps all four.

Deleting `trade_handler.php` rather than merely `.vercelignore`-ing it is the
security decision. On Vercel a file on disk beats a rewrite, so a deployed
`.php` file would both shadow the `/trade_handler.php` route *and* be served as
readable source — credentials logic, admin gating and all. The ignore rule
alone is one edit away from failing silently.

**No Railway app config left, and no host-specific code.** The two things the
task named were already absent from the Node backend: `resolveSslOption` in
`api/_lib/db.js` reads `sslmode` from the `DATABASE_URL` query string, then
`PGSSLMODE`, with no hostname branch; `buildResetUrl` in `api/_lib/router.js`
resolves `APP_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → the
request `Host` header, with no `RAILWAY_PUBLIC_DOMAIN`. Both host-neutral
already, so this phase deleted the PHP originals rather than rewriting anything.

**The Railway *database* is untouched and stays.** Every remaining "Railway"
string in the tree is either a comment explaining that the queries run against
the existing database, or documentation telling the user to point `DATABASE_URL`
at Railway's *public* host. Nothing in this phase — or the port — issues DDL.

**`vercel.json` now has a belt and braces.** Two rewrites:

```json
{ "source": "/trade_handler.php",  "destination": "/api/handler" }
{ "source": "/:path(.*\\.php)",    "destination": "/api/handler" }
```

The first is the front-end contract. The second means that even if a `.php` file
ever returns to the repo *and* slips past `.vercelignore`'s `*.php`, the path
resolves to the function (which answers JSON) instead of to source text. The
patterns were validated against `path-to-regexp` directly: both compile, all of
`/foo.php`, `/a/b/deep.php`, `/wp-admin/setup-config.php` route to the function,
and `/`, `/app.js`, `/styles.css`, `/a.php.js` are left to static serving.
`db/schema.sql` stays in the repo as live-schema documentation and stays out of
the deployment via `.vercelignore`'s `db/`.

**Front-end contract verified, not assumed.** `git grep` finds 13 backend URLs
across `app.js` (12) and `src/modules/livePrices.js` (1). Every one is a
relative `trade_handler.php?action=…`, so every one resolves to the single path
`/trade_handler.php` and is covered by rewrite #1. Query strings pass through
untouched. `app.js`, `index.html` and `src/` were not edited in this phase.

**Docs.** `README.md` rewritten: Vercel deployment, every environment variable
documented by name in required/recommended/optional tables, TLS driven by the
URL, the no-DDL guarantee, `vercel dev` replacing `php -S`, and the honest
caveat that `vercel dev` on plain-HTTP localhost still triggers the front-end's
local-preview auth bypass — so the real session path has to be exercised over
HTTPS or by curling the endpoint directly. New `docs/DEPLOY.md` is the
user-performed runbook: Railway public URL, Vercel project settings, env vars
by name only, first deploy, a five-step end-to-end verification that ends at
"log in with your existing password", turning off the Railway *app* service
while leaving Postgres running, and a rollback plan. It opens with a blockquote
telling the user never to paste a secret into a file in this repo.
`MVP.md` and `docs/launch-checklist.md` were de-Railwayed and de-PHPed
(`php -l trade_handler.php` → `npm test`; "let the handler create missing
tables" → "the backend issues no DDL").

**Verified locally:** `npm test` green, 13/13, including `bcryptCompat` (the
PHP `$2y$` round-trip) and `apiDb` (no-DDL, parameterisation, TLS resolution).
`node --check` clean on all six backend modules. `vercel.json` parses and its
rewrites compile and match correctly. `api/handler.js` boots behind a real
`node:http` server and, with no `DATABASE_URL`, returns the generic 500 with the
cause in the server log only — no leak. The front-end serves and loads from a
plain static server (`index.html`, `app.js`, both stylesheets, `src/` modules
all 200) while `/trade_handler.php` now 404s from disk, which is precisely the
condition that lets the Vercel rewrite win. The leftover `php -S` dev server
from phase 2b was stopped; it was serving stale content.

**Cannot be verified without a deploy:** that Vercel accepts the rewrite config
end to end; that `DATABASE_URL` reaches the Railway public host through Vercel's
network and negotiates TLS; that existing rows load and re-save unchanged; that
real stored `$2y$` hashes authenticate against the live table; Resend delivery.
All five are step 5 of `docs/DEPLOY.md`.

**Rollback** is code-only — no schema changed, no row was rewritten, and new
hashes are still written with the `$2y$` prefix, so restoring `trade_handler.php`
from `880750e` re-authenticates every account including ones created on Vercel.

---

## Phase M1 — Trade Review mobile

The user said "most are bugging" and the audit measured `#journal` at **852px
wide inside a 375px viewport**. Seven elements were listed as overflowing —
`.rev-chips` 864, `.rev-head` 840, `.rev-head-tools` 840, `.rev-search` 744,
`#filterSearch` 657, `details.rev-more` 840, `table` 820. Six of those seven are
not bugs. They are `width: 100%` of an 852px parent, and the parent was 852px
because of exactly one rule.

**Root cause:** `clay-v2.css` §13d shipped `#journal table { min-width: 820px }`
unconditionally. `styles.css` turns rows into cards at `max-width: 900px` and
that transform depends on `table { min-width: 0 }` — but `#journal table` scores
`(1,0,1)` against `table`'s `(0,0,1)`, so the desktop 820px floor survived into
the card layout on every phone, inflated `.table-wrap` (820 + 2×10px well
padding + 12px = 852), and dragged the whole `#journal` grid — header, tools,
search, chips, details — out to match. Fixing the header elements individually
would have been six patches on one bug.

**The fix is three rules.**

1. `#journal table { min-width: 820px }` moved inside `@media (min-width: 901px)`
   — the widths that still render a real table. Below that the `styles.css`
   reset lands and the table is `min-width: 0`, so `#journal` is 363px wide
   (`.app-layout` is `min(100%, 100vw - 12px)`) and every header element that
   the audit flagged is now 363px with no rule of its own. The existing
   `@media (max-width: 760px)` header rules were already correct; they had
   nothing to do.

2. `.rev-chips` lost a negative `margin-inline: calc(var(--space-3) * -1)`. That
   bleed assumed a 12px page gutter; the phone layout has 6px per side, so the
   strip was itself pushing the page 6px past the viewport on each edge. Its
   padding is now `4px 0 10px` — vertical room the strip genuinely needs,
   because `overflow-x: auto` computes `overflow-y` to `auto` too and was
   clipping both the chips' clay shadow and their focus ring.

3. `#journal tbody td { overflow-wrap: anywhere }` at ≤900px. With the table
   floor gone, the last way a row could exceed the phone is one long unbroken
   setup name or symbol in a `minmax(0, 1fr)` value column.

**Chips: scroll strip, not wrap — and why.** Eight controls at the 44px touch
floor wrap into four ragged rows at 375px: roughly 200px of an 812px screen
spent on filters before a single trade is visible, on the one view whose entire
job is showing trades. The strip keeps the table above the fold. The cost of
scrolling is discoverability, so the strip now carries a right-edge
`mask-image` fade as a permanent "there is more" signal — iOS renders overlay
scrollbars invisibly and ignores `::-webkit-scrollbar`, so a styled scrollbar
would have been an affordance that only exists on desktop. Also added
`overscroll-behavior-x: contain` so a swipe past the last chip does not trigger
the browser's back gesture, and `-webkit-overflow-scrolling: touch`, which is
switched back to `auto` under `prefers-reduced-motion` — inertia is motion the
user did not ask for, and the strip still scrolls without it.

**`.table-wrap` deliberately stays `overflow: visible` at phone widths.** The
phase brief asked for `overflow-x: auto`; that would be a regression here.
`overflow-x: auto` forces `overflow-y` from `visible` to `auto`, and the row
cards' win/loss depth is an *outer* `box-shadow` on `tr` — `.trade-row-win`
lifts, `.trade-row-loss` sinks — which the resulting clip would cut off. With
the table's `min-width` now `0` there is nothing left to scroll horizontally, so
`visible` is both the correct value and the one that preserves "depth as data".
The card contents are unchanged: Date, Symbol, Setup, Net, R, Pips and Mood all
still carry `data-label`, so `td::before` still prints the column name, and the
chevron cell and detail row still opt out of the label column.

**Desktop is untouched by construction.** Every line added or changed sits
inside `@media (max-width: 900px)`, `@media (max-width: 760px)`, or the new
`@media (min-width: 901px)` gate. At 1400px only the third applies, and it
restores precisely the declaration that was there before. Nothing at
`min-width: 901px` and above evaluates differently than it did at `880750e`.

**Verified:** `npm test` green, now 14/14 — `tests/reviewMobile.check.mjs` is
new. It parses `clay-v2.css` with a brace walker, carries each rule's `@media`
context, and fails if any rule declares a `min-width` above 375px without a
`min-width` media guard; it also asserts `.rev-chips` has no negative
`margin-inline` at phone widths, still scrolls, still has its fade, and that no
phone-width `.table-wrap` rule sets `overflow-x: auto`. The regression was
re-introduced by hand to confirm the check throws, then reverted. `node --check`
clean on `app.js` (untouched this phase — no module state was added, so the
top-level `init()` TDZ trap was not in play). Static server returns 200 for
`clay-v2.css` and serves all four markers.

---

## Phase: sitewide mobile polish (11px type floor, 44px touch floor)

**One rule, applied everywhere, instead of eight patches.** The audit listed
eight sub-11px items; walking both stylesheets found **23**. Every one is the
same defect with a different class name: a component drawn from a desktop
mockup ships its own micro-kicker (`.jrn-kicker`, `.cooldown-kicker`,
`.rule-cost-title`, `.rev-detail-key`, `.lnd-expect-tag`, `.dev-chip-tag`, …)
at whatever size looked right at 1400px, and nothing in the build ever
compared it to the `--fs-micro: 11px` the design system calls "the floor". So
the fix is one section — `clay-v2.css` §15, last in the last stylesheet — that
restates the floor for the whole product at once, plus a test that re-derives
it from the CSS so component #24 cannot quietly reintroduce 9px.

**Type floor (§15a, `@media (max-width: 899px)`).** `.dash-dial-label` 9 →
11px; `.rev-detail-facts dt` / `.rev-detail-key` 9.5 → 11; `.tabbar-badge`
9.5 → 11 (its disc grows 17 → 19px to match, still smaller than the 24px icon
it sits on); `.cal-net-label`, `.rev-flag`, `.dash-unj-streak-label`,
`.sheet-readout-key`, `.rule-cost-title`, `.cooldown-kicker`, `.dev-chip-tag`
10 → 11; `.dash-clock`, `.dash-range-btn`, `.dash-risk-state`,
`.dash-unj-date`, `.sheet-label`, `.sheet-rules-title`, `.jrn-kicker`,
`.jrn-label`, `.calendar-cell-meta`, `.lnd-row-result`, `.lnd-expect-tag`
10.5 → 11. `small` is stated rather than inherited: the UA's 0.83em under a
12px label is what put the trade-entry hints and `#screenshotLabel` at 10px.

Two of these would have cost horizontal room, so the tracking pays for the
type: `.dash-clock` and `.cal-net-label` drop from 0.16em/0.14em to 0.10em,
which makes an 11px glyph *narrower* than the 10.5px one it replaces — the
greeting still fits "Wednesday · New York open in 3h 12m" on one line at 375px.
`.dash-dial-label` goes to 0.08em: "LEFT" measures ~33px inside the mobile
dial's 70px clear diameter (96px ring − 2×13px stroke), so the ring is
untouched. No layout was kept small to keep small text.

`.rev-search-key` — the `/` hotkey pill in the review search — is hidden below
900px instead of grown. It advertises a shortcut a phone does not have, and it
was taking width from the search field the audit already found cramped.

**Touch floor (§15b + a one-line fix at §10h).** `.dash-range-btn` (32px) and
`.dash-live-close` (38px) already *had* 44px rules — behind a bare
`@media (pointer: coarse)`. Emulated and headless viewports report
`pointer: fine`, which is exactly why the 375px audit still measured 32 and 38.
That query is now `(max-width: 899px), (pointer: coarse)`: a phone-width
viewport is a thumb whatever the UA claims. `#cooldownRulesBtn`
(`.dash-risk-link`) becomes `inline-flex` with `min-height: 44px` so it stays
inside its sentence while growing from a 19px text run; `.info-btn` gets 44×44.

The two checkbox findings were not missing targets: `#tradeInProgress` and the
five reflection checkboxes already sit inside padded label wrappers that reach
44px (`.trade-status-toggle`, `.tag-set label`), so the whole chip is the hit
area. What was wrong is that a 14–15px box inside a 44px chip is still a 14px
thing to *aim at*, so only the box grows, to 18px — no visual bloat, no change
to the chip.

**One real collision found in the sweep.** The tab bar is shown from 899px
down, but §11e lifted `.capture-toast` above it only below 620px. Between 621
and 899 — iPad portrait, a small laptop window — the "trade logged"
confirmation landed *on* the dock. Now tied to the bar's own breakpoint (§15c).
The rest of the sweep came back clean: all four `<dialog>`s already scroll
internally (`.sheet-body` and `.cooldown-body` set `max-height` +
`overflow-y: auto`; `#scoreInfoDialog` keeps the UA `dialog:modal` scroll,
since §11a's `overflow: visible` opt-out lists only the other three), inputs
already hold 16px below 620px so iOS never zoom-jumps on focus, the calendar is
already an agenda list below 760px, `.dash-hero-top` already wraps so the 44px
range buttons cannot overflow the hero at 360px, and `.tag-set` is already a
2-up grid with wrapping labels.

**Desktop safety by construction.** Every added declaration is inside
`@media (max-width: 899px)`; the two touch blocks add `, (pointer: coarse)`,
which is the condition styles.css §6's existing control pass already uses. At
1400px with a mouse, not one line in this phase evaluates. The only edit
outside a new block is the §10h media *condition*, which widens when an
existing rule applies and never changes what it declares.

**Verified:** 15/15 test files green — `tests/mobileFloors.check.mjs` is new.
It parses both stylesheets with the §1e brace walker, resolves `font:`
shorthands and `var(--fs-*)` tokens, models the cascade per selector (equal
selector ⇒ equal specificity ⇒ last phone-applicable rule wins), and fails on
anything under 11px that is not `display: none` at phone width or gated off the
phone entirely (`.topnav-*` is `min-width: 1025px`; `.kbd-hint` and
`.dash-log-flag` live inside `#journalNewTradeBtn`, which the FAB replaces
below 899px). It also asserts each of the six audited controls has a
phone-applicable rule reaching `min-height: 44px`. Regression re-introduced by
hand (`.dash-dial-label` back to 9px) to confirm it throws, then reverted.
`node --check` clean on `app.js` — untouched this phase, so no module state was
added and the top-level `init()` TDZ trap was not in play. The static server
returns 200 and serves the §15a/§15b/§15c markers; the two stylesheet
cache-busters were bumped to `?v=20260810-mobile2` so a returning browser
actually gets them.
