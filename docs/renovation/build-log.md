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
