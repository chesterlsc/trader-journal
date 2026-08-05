# Dashboard + Landing Elevation Spec

**Backbone: Command Bento (judge tally 2–1).** Every judge-agreed graft is applied; nothing on any kill list ships. Grounded against `index.html` (dashboard view :241–548, landing :43–143), `styles.css` (metric grid :1070–1158, view-head :1050, analytics grid :1195, risk strip :3589–3656, auth hero :267–420), `app.js` (init :369, renderAll :3460, setCountUpValue :3986, tweens :4119, syncLandingExpandedLayout :978), `charts.js` (lastChartHash :15, drawAllCharts :91, getCanvasContext :590).

## 1. Design intent

**Dashboard.** The uniform 12-cell `auto-fill` wall becomes one deliberate 12-column bento that reads in the order a trader thinks at 6:30am: an 8-column, 2-row hero cell fusing the Account Balance numeral at display scale with the relocated equity canvas (number + direction + trajectory in one fixation), a 2×2 support quartet (Win Rate, Profit Factor, Expectancy, Avg R:R) at 30px, and the seven tertiary numbers compressed into one hairline-divided Bloomberg strip at 17px. Every existing node survives — cells are re-ranked by size, not reinvented. Motion informs, never performs: the entrance settle plays exactly once per session, delta chips render with their cards, tertiary numbers never animate, and the hash-guarded chart draw stays all-at-once.

**Landing.** The centered static hero becomes an asymmetric 7:5 composition: claim on the left at up to 4rem Sora, and on the right the REAL ticking `#recentTradesList` wrapped in-place in terminal chrome — the product demos itself above the fold with live data, the most honest demo the blueprint's stance permits. Below it, four new static beats (proof strip, product bento with one DEMO-tagged canvas, spec-sheet feature ledger, closing CTA) revealed by one IntersectionObserver behind a no-JS-safe `reveal-ready` guard. Accent appears exactly twice (hero CTA, close CTA). The live-pulse dot remains the only infinite animation in the product.

### Conflict rulings (final, not revisitable in QA)

| # | Ruling |
|---|---|
| R1 | **Hero fusion ships.** Judge 2's kill of the equity-canvas relocation was conditional on Terminal Editorial's sparkline + span-8 co-hero alternative — which judges 1 and 2 themselves killed as a duplicate focal point. The backbone's defining move, endorsed 2-of-3 and feasibility-verified (`getCanvasContext` width-900 fallback, charts.js:590), stands. |
| R2 | Delta-chip 600ms delayed reveal is **dead** (J1 kill). Chips render with the card — the delta is part of the first-3-seconds read. |
| R3 | **No dashboard clock.** The single UTC clock is the blueprint §4 chip in `.desktop-nav-actions` (added in Phase D since it doesn't exist yet, index.html:207–210). The view-head keeps its restyled descriptive `p` instead. |
| R4 | Entrance choreography plays **once per session** via `body.has-entered` (J1+J3 graft). Decided now, not in QA. |
| R5 | Strip delta chips: `display:none` entirely, with a comment at the rule (J1 graft; J2/J3 concur). No 10px, no 11px compromise. |
| R6 | `--fs-hero-xl` caps at **4rem** (Bento's value; 4.5/4.75rem variants killed). |
| R7 | Tape stays **in place** — wrapped where it sits inside `.auth-hero-copy`; ≤979px DOM order identical to today. TE's relocation into a separate section is dead. |
| R8 | Placement via **explicit per-card grid-area classes** in index.html. `:has()`-based placement is dead. |
| R9 | Exactly **one** DEMO-tagged canvas on the landing (`#landingDemoChart` in the product bento), fired-once. No other synthetic curves anywhere — LI's hero canvas is dead including its motion amendment. |
| R10 | Best/Worst Day "(Tue)" suffix stays 17px via `textContent` — no innerHTML on a money field. Ellipsis contract instead (R13). |
| R11 | Progress-ticker scroll-snap rework **deferred** — journal-view scope. `.progress-trade-track` untouched by this spec. |
| R12 | Count-up stays simultaneous (LI's cascade dead) and exclusive to hero + support quartet: the seven tier-3 keys are deleted from the tweens map (app.js:4119). |
| R13 | `white-space:nowrap; text-overflow:ellipsis; overflow:hidden; min-width:0` is the **shipped rule** on strip values, tested with 5-digit balances at 1100px and 375px. |
| R14 | The reduced-motion kill block gains `animation-delay: 0ms !important; transition-delay: 0ms !important;` **in the same commit as the first stagger** (J3 required fix — the existing block zeroes durations only, so backwards-filled delayed cells would sit invisible). |
| R15 | LI's IO-gated per-canvas draws, `display:contents`, count-up delays, and TE's SAMPLE mock + `::after` sheet frame: all dead per kill lists. Existing hash-guarded all-at-once draw stays. |

---

## 2. DASHBOARD

### 2.1 Grid definition

`#dashboardMetricGrid` keeps its id (empty-state `hidden` toggle untouched) and gains class `.bento`. **All rules scoped to `#dashboardMetricGrid.bento`** so `.metric-grid.compact` (monthly review, index.html:1084) is untouched.

**Desktop ≥1200px**

```css
#dashboardMetricGrid.bento {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-rows: minmax(var(--bento-row), auto); /* 132px */
  gap: var(--space-3);
  grid-template-areas:
    "hero hero hero hero hero hero hero hero winrate winrate pf pf"
    "hero hero hero hero hero hero hero hero expect  expect  rr rr"
    "strip strip strip strip strip strip strip strip strip strip strip strip";
}
```

**Tablet 761–1199px** (verify at 768)

```css
grid-template-areas:
  "hero hero hero hero hero hero hero hero hero hero hero hero"
  "winrate winrate winrate pf pf pf expect expect expect rr rr rr"
  "strip strip strip strip strip strip strip strip strip strip strip strip";
/* hero min-height 220px; .bento-strip switches to repeat(4, 1fr) → 2 rows */
```

**Mobile ≤760px** (verify at 375)

```css
grid-template-columns: repeat(2, minmax(0, 1fr));
grid-template-areas:
  "hero hero" "winrate pf" "expect rr" "strip strip";
/* hero min-height 200px; .bento-strip switches to repeat(2, 1fr) → 4 rows */
```

**Chart bento** — `.panel-grid-analytics` (styles.css:1195) becomes 12-col:

| Breakpoint | Row 1 | Row 2 | Row 3 |
|---|---|---|---|
| ≥1200 | Drawdown span 5 · Strategy span 7 | Psychology 4 · Session 4 · R-Multiple 4 | Trader Score 5 · Edge table 7 |
| 761–1199 | Drawdown 6 · Trader Score 6 | Strategy 12 | Psychology 6 · Session 6 · R-Multiple 12 · Edge 12 |
| ≤760 | all span 12, source order | | |

Per-panel classes added in index.html: `.panel-dd`, `.panel-psych`, `.panel-session`, `.panel-rmultiple` (strategy and trader-score panels already carry classes); the Edge Detection panel (index.html:476–498) **moves inside** `.panel-grid-analytics` and gets `.panel-edge`. R8: explicit classes, no `:has()`.

### 2.2 Cell inventory — every existing element mapped, nothing orphaned

| Existing element (index.html) | New home | Treatment |
|---|---|---|
| `.metric-card-balance` + `[data-metric="accountBalance"]` (:261) | `.cell-hero`, `grid-area: hero` | Internal `grid-template-rows: auto auto 1fr`; padding `--space-5`. Row 1: existing `.metric-label` + new mono 11px kicker `EQUITY · STARTING + SEQUENCE` (text from the deleted equity panel-head). Row 2: value at `--fs-display`, delta chip + `#balanceOverrideNote` inline on the same baseline (note stays adjacent to the curve per its reconciliation copy). Row 3: `#equityChart`. Signed `--pl-intensity` hairline (styles.css:1103–1116) unchanged — now sizes a ~276px card. |
| `#equityChart` canvas (:348) | **Moved in index.html** into `.cell-hero`, `data-height="180"` (all widths) | Full-bleed: `margin: var(--space-4) calc(-1 * var(--space-5)) calc(-1 * var(--space-5))`. Zero JS: charts.js re-measures `clientWidth` per pass. Its old `.panel` shell is **deleted**. |
| `winRate`, `profitFactor`, `expectancy`, `avgRR` cards | `.cell-support` + one of `.area-winrate/.area-pf/.area-expect/.area-rr` | Value 30px (`--fs-metric-lg`). Existing `.is-pos/.is-neg` hairlines and delta chips work unchanged, chips render immediately (R2). |
| `totalTrades`, `currentDrawdown`, `maxDrawdown`, `bestDay`, `worstDay`, `winningStreak`, `losingStreak` cards | Physically grouped (HTML reorder) inside new `<div class="bento-strip">`, each card gains `.cell-strip` | `.bento-strip { grid-area: strip; display:grid; grid-template-columns: repeat(7, minmax(0,1fr)); gap:1px; background: var(--line); border:1px solid var(--line); border-radius: var(--radius-lg); overflow:hidden; }` — calendar hairline recipe: separators survive every wrap for free. `.cell-strip { border:0; border-radius:0; background: var(--surface-1); min-height:64px; padding: var(--space-3) var(--space-4); box-shadow:none; }` Value 17px with the R13 ellipsis contract. Signed state: `.cell-strip.is-pos { border-left:0; border-bottom:2px solid var(--pnl-pos-line); }` (mirror `.is-neg`) — overrides the base 2px left border (styles.css:1092). |
| Strip `.metric-delta` spans | Stay in DOM | `.cell-strip .metric-delta { display:none; } /* Tier-3 numbers don't chip. renderMetricDeltas keeps toggling [hidden] — harmless. Do NOT remove this rule without restoring chip room. */` (R5, comment mandatory). |
| `#riskStrip` (:247) | Stays directly above the bento | Twin micro-gauge band: container drops panel chrome (`padding:0; border:0; background:transparent; display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3);` — 1-col ≤760px). Each `.risk-strip-item`: `--surface-1`, 1px `--line`, `--radius-md`, internal `grid-template-columns: auto 1fr auto`, 6px track. `is-warn`/`is-breach`/`hidden` logic (app.js renderRiskStrip :4200) untouched. |
| `.view-head-dashboard` (:242) | Unboxed masthead | `border:0; background:transparent; box-shadow:none; border-radius:0; padding: var(--space-2) 0 var(--space-3); border-bottom:1px solid var(--line); display:flex; align-items:baseline; justify-content:space-between;` h2 stays Sora 700 22px; the `p` restyles to mono 500 12px `--text-soft` right-aligned, hidden ≤760px (R3 — no clock here). Recovers ~90px. |
| 7 chart panels | Chart bento per §2.1 | Panel recipe unchanged. **Graft:** `.panel-chart .panel-head h3` → mono 600 11px uppercase ls 0.08em `--text-faint` over a 1px `--line` bottom rule (§4 kicker recipe — Sora stays exclusive to view headings); `.panel-head p` → 12px `--text-soft`, hidden ≤900px. Strategy toolbar toggles unchanged, right-aligned in the kicker row. |
| Discipline Monitor panel (:449–474) | Below chart bento, full width | `.score-stack` (styles.css:2394) → `grid-template-columns: repeat(3, auto) 1fr` ≥980px: three scores inline at 30px mono 700 with `#riskViolations` beside them (≈4:8); stacks ≤979px. Markup order unchanged. `#traderScoreValue` also 30px. |
| Edge Detection panel | Moved into chart bento row 3 (`.panel-edge`, span 7) | Table/thead contract untouched. |
| Risk Controls panel + `#riskForm` (:500–542) | Last full-width panel | **Graft:** `.compact-form` internal grid `repeat(3,1fr)` ≥1000px / `repeat(2,1fr)` 700–999px / 1-col below; `.form-actions` spans all columns, right-aligned. Two rows instead of a tall stack. |
| `#adminPanelsMount` (:546) | Untouched, last. |
| `#dashboardEmptyState` (:330) | Untouched | JS already swaps `hidden` on grid vs empty state; the equity canvas now hides with the grid — charts.js paints into it via the width-900 fallback (charts.js:590), harmless. Inherits the unboxed masthead above. |
| `.progress-trade-*`, `.journal-action-bar` | **Untouched** (R11). |
| 900–980px table scroll fix | Untouched. |

### 2.3 Type ladder (exact px)

| Tier | Elements | Size |
|---|---|---|
| 1 | `accountBalance` value | `--fs-display: clamp(38px, 4.5vw, 52px)` mono 700, lh 1.05, `"tnum"` — the only 38px+ number on the page |
| 2 | `winRate`, `profitFactor`, `expectancy`, `avgRR`, `#disciplineScore`, `#dailyTradingScore`, `#goalProgress`, `#traderScoreValue` | `--fs-metric-lg: 30px` mono 700 |
| 3 | seven strip values | `--fs-metric-sm: 17px` mono 600, R13 ellipsis, suffix stays inline (R10) |
| Labels | all `.metric-label`, strip labels, chart kickers | mono 600 11px uppercase ls 0.08em `--text-faint` (the existing floor) |
| — | `--fs-metric` 26px retired from dashboard; token stays (monthly review consumes it) |

### 2.4 Motion choreography

| Name | Spec | Reduced motion |
|---|---|---|
| **cellSettle** (entrance, once per session) | `@keyframes cellSettle { from { opacity:0; transform:translateY(6px); } }` — applied as `body:not(.has-entered) .view.is-active .bento > *, body:not(.has-entered) .view.is-active .bento .cell-strip, body:not(.has-entered) .view.is-active .panel-grid-analytics > .panel { animation: cellSettle var(--dur-slow) var(--ease-out) backwards; animation-delay: calc(var(--cell-i) * var(--stagger-cell)); }` with `--cell-i` stamped by ~14 pure-CSS nth-child/class rules (hero 0, supports 1–4, strip wrapper 5 as one shared delay, chart panels 6+). JS stamps `body.has-entered` ~1s after first dashboard paint (R4) — never replays on view switches. | Zeroed durations + R14 delay-zeroing = instant |
| **hero sequence** | Existing count-up (600ms rAF) at t=0; `#equityChart`'s own cellSettle gets `animation-delay: 120ms` — the number appears to cause the curve. Zero JS changes to either system; chart draw stays the existing hash-guarded 640ms (charts.js:71). | Final value + progress 1 |
| **delta chips** | Render with the card, no delay, no chipFade (R2). Strip chips hidden (R5). | n/a |
| **count-up** | Hero + support quartet only — the seven tier-3 keys deleted from the tweens map (app.js:4119); `setCountUpValue` already handles a null tween by direct write (R12). Simultaneous, no cascade. | Direct set (existing guard, app.js:4002) |
| **pnl-tick / view-enter / chart-draw / skeletons** | Untouched, per §5 inventory. | Existing behavior |
| **UTC clock** (nav, R3) | 1s `textContent` swap into `[data-utc-clock]` chip in `.desktop-nav-actions`, mono 11px `--text-faint` tabular-nums. Stillness — zero animation, zero jitter. | n/a |

---

## 3. LANDING

Five beats, all inside `.auth-shell` (auth panel/overlay/reset flow untouched; modal keeps opening over the ticking tape). `.auth-shell` drops `justify-content:center` (styles.css:282) for natural flow; the hero's own `min-height: min(88vh, 780px)` does the centering. `is-trades-expanded` / `#landingScrollHint` logic keeps operating on the tape exactly as today (R7).

### 3.1 Hero — claim + live proof (7:5)

**Markup plan** (DOM order inside `.auth-hero-copy` unchanged — R7): wrap `#recentTradesList` in place:

```html
<div class="hero-terminal">
  <div class="hero-terminal-rail">
    <span>LIVE FEED &middot; DELAYED 2s</span>
    <span class="live-pulse-dot" aria-hidden="true"></span>
  </div>
  <div class="recent-trades-board" id="recentTradesList" ...></div>
</div>
```

**≥980px:** `.auth-hero-copy { display:grid; grid-template-columns: 7fr 5fr; gap: var(--space-10); text-align:left; align-items:center; max-width:1280px; grid-template-areas: "pre term" "head term" "text term" "cta term" "hint hint"; }` — preheadline/h2/text/cta assigned to left areas, `.hero-terminal { grid-area: term; }`. `.auth-hero` max-width rises to 1280px.

- Preheadline + live-pulse dot: unchanged.
- Headline: `--fs-hero-xl: clamp(2.6rem, 5.5vw, 4rem)` (R6), Sora 700, ls -0.02em, lh 1.06, three `.hero-line` spans kept.
- Subcopy: 15px `--text-soft`, max-width 46ch.
- CTA row left-aligned: `#heroRegisterBtn` becomes `.btn.primary` (accent use 1 of 2); `#heroLoginBtn` stays hairline secondary.
- `.hero-terminal`: `border:1px solid var(--line-strong); border-radius: var(--radius-xl); background: var(--surface-1); box-shadow: var(--shadow); overflow:hidden;` Rail: mono 600 11px uppercase `--text-faint`, `--surface-inset` bg, 1px bottom hairline. Per-card Live tag suppressed inside: `.hero-terminal .recent-trades-live-tag { display:none; }` — renderer untouched.
- Atmosphere: `.hero-terminal::before` masked dot grid (radial-gradient `--line` 1px dots, 24px pitch, opacity 0.35, inset -40px, mask fading outward). No canvas, no blur, no synthetic curve (R9/kill).
- **≤979px:** today's single-column centered layout, DOM order literally identical; mobile expand/scroll-hint path untouched.

### 3.2 Sections (new static HTML, appended after `.auth-hero`)

| Section | Spec |
|---|---|
| **Proof strip** `<section class="landing-proof" data-reveal>` | Full-width `border-block: 1px solid var(--line)`, padding `var(--space-4) 0`; inner flex, centered, wrap; four mono 600 11px uppercase `--text-faint` items dot-separated: `12 CORE METRICS · 7 LIVE CHARTS · CSV IMPORT/EXPORT · DARK + LIGHT`. Honest, static. |
| **Product bento** `<section class="landing-bento">` | 12-col grid, max-width 1120px, section padding `var(--space-24) 0` (96px; `--space-16` ≤760px). Cell A (`span 7`, 2 rows, `data-reveal` `--reveal-i:0`): "Your equity, drawn live" + `<canvas id="landingDemoChart" data-height="160">` drawing a hard-coded 14-point array, mono 11px `DEMO DATA` tag pinned top-right — the one permitted demo canvas (R9). Cell B (`span 5`, `--reveal-i:1`): "Risk budget enforcement" + static gauge mock reusing the real `.risk-strip-item` classes at 55% `is-warn` fill. Cell C (`span 5`, `--reveal-i:2`): "Psychology on the record" + three static mono rows using existing badge classes. Each cell = §4 panel recipe + mono kicker. ≤760px: stacked. |
| **Feature ledger** `<section class="landing-ledger" data-reveal>` | A real `<table>` styled by the existing table recipe (mono thead, hairline rows), max-width 880px: CAPABILITY \| WHAT IT DOES × 6 rows (Trade entry ≤30s · Edge detection by setup · Calendar P&L heat · Discipline scoring · Live open-position P&L · Bulk CSV import). The app's own table styling as marketing; near-zero new CSS. |
| **Close** `<section class="landing-close" data-reveal>` | Centered, padding `var(--space-24) 0`; h2 Sora 700 `--fs-h2` "Start your journal tonight."; one `.btn.primary` (accent use 2 of 2) wired to the existing `setAuthIntent('register')` path via a shared class with `#heroRegisterBtn`; `::before` dot grid 16px pitch masked to a centered ellipse; mono 12px `--text-faint` reassurance line "Free · No card · Your data stays yours". |
| **Footer** | Existing `.trust-row` + `.site-footer` untouched; they now sit under the close band and inherit the `--space-16` rhythm. |

Accent audit after this pass: exactly two `.btn.primary` on the logged-out page.

### 3.3 Scroll-reveal mechanics + motion inventory

- **reveal-ready guard (graft):** pre-reveal hiding only under `body.reveal-ready` stamped by JS at boot — no-JS visitors always see everything. `body.reveal-ready [data-reveal] { opacity:0; transform:translateY(8px); transition: opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out); transition-delay: calc(var(--reveal-i, 0) * var(--stagger-reveal)); } body.reveal-ready [data-reveal].is-inview { opacity:1; transform:none; }`
- One IntersectionObserver (threshold 0.15, rootMargin `0 0 -10%`), adds `.is-inview` once, unobserves. REDUCED: stamps `.is-inview` on all targets synchronously, never observes.
- **Hero entrance:** existing `fadeUp` retimed as two beats — copy at 0ms, `.hero-terminal` at `animation-delay:120ms`, both 320ms `--ease-out`. Pure CSS.
- **Tape liveliness (graft):** when the 2s poll changes a row, that row gets the existing `pnl-tick` class (~6-line diff in recentTradesView.js) — genuine data-cadence motion with an animation the app already owns. Live-pulse dot remains the only infinite animation.
- **Demo sparkline:** draws once on first reveal (640ms ease-out-cubic, same curve as charts.js), fired-once flag (graft), redraws on `themechange`, then holds. REDUCED: single frame.
- **document.hidden (graft):** landing poll/repaint work pauses under one `visibilitychange` listener.
- CTA hover: token 140ms background/border only. No parallax, no marquee, no lifts.

---

## 4. New CSS tokens (pasteable)

```css
:root {
  /* == Elevation additions — sizes/rhythm only, theme-independent: ==========
     no [data-theme="light"] overrides are required for any of these. */
  --fs-display: clamp(38px, 4.5vw, 52px);   /* tier-1 hero metric (balance) */
  --fs-metric-lg: 30px;                     /* tier-2 metrics + scores */
  --fs-metric-sm: 17px;                     /* tier-3 stat-strip values */
  --fs-hero-xl: clamp(2.6rem, 5.5vw, 4rem); /* landing headline — 4rem cap is
                                               final (ruling R6) */
  --bento-row: 132px;                       /* dashboard bento base row */
  --stagger-cell: 40ms;                     /* cellSettle step (dashboard) */
  --stagger-reveal: 60ms;                   /* scroll-reveal step (landing) */
  --space-16: 64px;                         /* landing section rhythm */
  --space-24: 96px;                         /* landing section rhythm */
}

/* No new colors, surfaces, lines, durations, or easings — the elevation
   spends existing tokens. Both stagger tokens are consumed inside *-delay
   calc()s, so the block below is REQUIRED (R14): the existing kill block
   zeroes durations only, and a backwards-filled cell would otherwise sit
   invisible through its full delay under reduced motion. Ships in the same
   commit as the first stagger rule. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-delay: 0ms !important;
    transition-delay: 0ms !important;
  }
}
```

---

## 5. New JS work

| Behavior | Sketch |
|---|---|
| **Entrance gate** | In `init()` (app.js:369), after the first authenticated `renderAll()`: `setTimeout(() => document.body.classList.add("has-entered"), 1000)` (12 delays × 40ms + 320ms ≈ 800ms; 1s is safe). ~3 lines. All cellSettle rules scoped `body:not(.has-entered)`. No REDUCED branch needed — CSS tokens + R14 make the gated animation instant. |
| **Tier-3 count-up removal** | Delete the seven strip keys (`totalTrades, currentDrawdown, maxDrawdown, bestDay, worstDay, winningStreak, losingStreak`) from the `tweens` map in `renderDashboardMetrics` (app.js:4119). `setCountUpValue` (:3986) already direct-writes on a null tween. Deletion only. |
| **`initLandingReveals()`** (~18 lines) | Called from `init()` only when `!document.body.classList.contains("is-authenticated")`. Stamps `body.reveal-ready` **first**, then: if `prefersReducedMotion()` (app.js:64) or no `IntersectionObserver`, add `.is-inview` to all `[data-reveal]` synchronously; else observe (threshold 0.15, rootMargin `0px 0px -10% 0px`), add class once, unobserve. |
| **`drawLandingDemoChart()`** (~30 lines, app.js) | Module-scope `let landingDemoDrawn = false` (fired-once graft). Called from the IO callback for cell A and from the `themechange` listener (app.js:448) — theme repaint resets nothing else. Hard-coded 14-point array; reads `--chart-line/--chart-fill/--chart-grid` via `getComputedStyle`; 640ms rAF progress tween, skipped under `prefersReducedMotion()` (progress = 1). Deliberately duplicates ~15 lines of `drawLineChart`'s core rather than importing the state-coupled charts module. |
| **Tape row tick** (~6 lines, recentTradesView.js) | Keep a module-scope map of previous row keys (`symbol+status+pnl`); on re-render, rows whose key changed get the existing `pnl-tick` class (keyframe + `animationend` removal already exist in-app). REDUCED: existing tick guard covers it. |
| **Visibility pause** (~4 lines) | One `visibilitychange` listener; the landing 2s poll callback returns early while `document.hidden` (skip fetch + render; sparkline draws once so needs nothing). |
| **`startUtcClock()`** (~8 lines) | Blueprint §4 chip, added to `.desktop-nav-actions` markup as `<span class="nav-clock" data-utc-clock></span>`; `setInterval(1000)` writing `HH:MM:SS UTC` via `textContent`; started once in `init()`; tabular-nums kills jitter. One clock in the product (R3). |
| **NO JS for** | Equity canvas relocation (charts.js re-measures `clientWidth`; `getCanvasContext` width-900 fallback covers the hidden empty-state case — verified :590), entrance stagger (pure CSS nth-child), delta chips (render with card), hero 2-beat entrance (CSS `animation-delay`), strip layout (CSS). |

---

## 6. Implementation order

### Phase D — Dashboard (one day)

**Files:** `index.html`, `styles.css`, `app.js`.

**Work items, in order:**
1. Tokens + R14 reduced-motion delay block into `styles.css` (one commit with the first stagger rule).
2. `index.html`: add `.bento` to `#dashboardMetricGrid`; reorder metric cards to hero → 4 supports → `.bento-strip` wrapper containing the 7 strip cards; add `.cell-hero/.cell-support/.area-*/.cell-strip` classes; move `#equityChart` (with `data-height="180"`) into the hero cell and delete its panel shell (its head text becomes the hero kicker); add `.panel-dd/.panel-psych/.panel-session/.panel-rmultiple/.panel-edge` classes and move the edge panel into `.panel-grid-analytics`; add the `[data-utc-clock]` chip to `.desktop-nav-actions`.
3. `styles.css`: bento grid (3 breakpoints), strip recipe (gap-1px hairline + `display:none` chips with comment + R13 ellipsis), type ladder, unboxed masthead, risk-strip band, chart-bento spans, kicker panel heads, score-stack flatten, `.compact-form` 3/2/1 grid, `cellSettle` + `--cell-i` rules scoped `body:not(.has-entered)`, hero-canvas 120ms delay.
4. `app.js`: has-entered stamp, tweens-map trim, `startUtcClock()`.

**Must not break:** all 12 metrics compute and bind (`[data-metric]` querySelectorAll survives reorder + wrapper); delta logic (`renderMetricDeltas` toggling hidden chips is harmless); empty-state swap (grid ↔ `#dashboardEmptyState`); `--pl-intensity` hairline; risk-strip warn/breach logic; `.metric-grid.compact` in monthly review (grep `.metric-grid` consumers before the sweep); 900–980px table scroll; strategy toolbar; admin mount; progress ticker (untouched, R11).

**Browser verification:** 1280 / 768 / 375, both themes — hero reads balance + delta + curve in one fixation; strip hairlines survive 2-row and 4-row wraps with a 5-digit balance in Best/Worst Day (ellipsis, no overflow); clear all trades → empty state renders, log a trade → grid returns and equity draw-in replays (hash change); switch views repeatedly → cellSettle plays only on first entry; toggle theme → charts repaint including hero canvas; OS reduced-motion → everything instant, no invisible-delayed cells (R14 proof); 4-col report canvases legible at ~350px width (else bump those three to `data-height="260"`).

### Phase L — Landing (one day)

**Files:** `index.html`, `styles.css`, `app.js`, `src/modules/recentTradesView.js`.

**Work items, in order:**
1. `index.html`: wrap `#recentTradesList` in `.hero-terminal` + rail (in place, R7); flip `#heroRegisterBtn` to `.btn.primary`; append `landing-proof`, `landing-bento` (with `#landingDemoChart`), `landing-ledger`, `landing-close` sections with `data-reveal`/`--reveal-i`.
2. `styles.css`: 7:5 hero grid areas ≥980px, `--fs-hero-xl` headline, terminal chrome + masked dot layer + live-tag suppression, section recipes on `--space-16/24` rhythm, `reveal-ready`-gated reveal rules, hero 2-beat delays; `.auth-shell` drops `justify-content:center`.
3. `app.js`: `initLandingReveals()`, `drawLandingDemoChart()` + themechange hook, visibility pause, close-CTA register-intent listener.
4. `recentTradesView.js`: row-diff `pnl-tick`.

**Must not break:** auth modal open/close/focus over the still-ticking tape at every beat; reset-password flow; ≤979px expand/collapse — `syncLandingExpandedLayout` (app.js:978), `#landingScrollHint`, `is-trades-expanded` at 375px before/after (DOM order is identical, so this is regression-proofing, not rework); `is-preview` mode; tape polling and renderer (finds `#recentTradesList` by id); no-JS visitors see full content (kill JS, reload — nothing hidden).

**Browser verification:** 1280 / 768 / 375, both themes — tape ticks in terminal chrome above the fold and a row change flashes `pnl-tick`; accent appears exactly twice (audit); scroll → sections reveal once with 60ms bento stagger; demo canvas draws once, never redraws on re-entry, repaints on theme toggle, carries its DEMO DATA tag; background the tab → poll pauses (network panel), foreground → resumes; reduced-motion → all sections visible immediately, static pulse dot; Lighthouse CLS ≈ 0; open auth modal at each beat and complete a login.