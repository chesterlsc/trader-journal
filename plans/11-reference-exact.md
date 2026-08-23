# BUILD SPEC — the reference dashboard, and a TV you can actually watch

Everything below was measured on the running page (`php -S 127.0.0.1:8010`) at **1999x1150**, **1440x900**, **1200x900**, **1100x800** and **375x812**, not derived. Every line number was re-read from the file today. Where the brief's citations were wrong, the corrected address is used silently — the corrections are listed at the end.

---

## 0. What the measurement changed about the plan

Six things the brief got wrong that only showed up on the live page. Each one would have been a bug.

| # | Found by | What it is |
|---|---|---|
| 1 | measuring `.dash-ledger` | `styles.css:3537` — `table { min-width: 980px }` is **global**. A bare `<table>` in a 597px panel renders **980px wide**. It also inherits `thead th { position: sticky; background: var(--surface-inset); text-transform: uppercase }` (`styles.css:3548`) and `th,td { border-bottom: 1px solid var(--line) }` (`styles.css:3541`). Four overrides are mandatory, not cosmetic. |
| 2 | measuring `.strip-cell` | Cell 5's caption must be a `<span>`, not a `<p>`. As a `<p>` the base paragraph margin (11px top **and** bottom) makes the cell **96px in an 84px box**. As a `<span>` it is 76. |
| 3 | applying the empty-state escape | The cull at `clay-v3.css:4003` is **(3,3,0)**, not (1,2,0) — `:has(#dashboardEmptyState…)` and `:not(#dashboardEmptyState)` each contribute an ID. `> .dash-edge-mini { display:grid }` at (2,3,0) **loses**; measured 0x0. The winning form is `> #dashEdgeMini:not([hidden])` at (3,3,0), placed after it. |
| 4 | moving `.dash-now` | `.dash-month-card` is a **2-column grid** (`clay-v3.css:3007`). A third child lands in r1c2 and **pushes the calendar to r2c1**. `.dash-now` must become a sibling of `.dash-month-card` inside `.dash-stats`, not a sibling of `.dash-hero`. |
| 5 | measuring at 1100 and 1200 | `.panel-chart canvas { width:100%; height:auto }` (`styles.css:2841`) gives the radar its **bitmap aspect ratio** below 1240 — measured **667px tall**. And `.panel-grid-analytics` is 12 columns at 1200 but 2 at 1100, so a class-less `#dashLedger` is **84px wide** at 1200. Both need one `@media (max-width:1239px)` block. |
| 6 | grepping `app.js:12349` | The reference's "day cells carrying money **and** a trade count" **already ships**. `.mc-n` is emitted at `app.js:12349` and shown by `clay-v3.css:3945`. Zero work. |

Plus the one the brief's own adversarial pass flagged and I confirmed by running the regex: guard 6 (`tests/instrumentPanel.check.mjs:115`) throws on **any** clay-v3 rule whose selector text contains `.dash-edge-mini` and whose block contains `display: none`. Both of the brief's proposed clay-v3 rules match. Neither ships in clay-v3.

---

## 1. Height arithmetic — it closes

### 1999 x 1150 (the owner's screen) — measured

`--chrome-h` measures **57**, `--rail-w` **56**. `#dashboard` box = **1943 x 1093** (measured, `clientWidth`/`clientHeight`).

**Width.** `.view.is-active#dashboard { padding-inline: var(--space-4) }` (`clay-v3.css:3837`, 16px) → 1911 usable. 12 cols, 11 gaps x 12 = 132. Pitch = (1911 − 132)/12 = **148.25px** — measured exactly, matching the shipped comment at `clay-v3.css:3834`.

| span | width | measured | who |
|---|---|---|---|
| lines 1→4 (3 col) | 468.75 | **468.8** | Edge score, Net daily P&L |
| lines 4→8 (4 col) | 629.00 | **629.0** | Cumulative curve, Recent trades |
| lines 5→11 (6 col) | 949.50 | **949.5** | Calendar |
| lines 11→13 (2 col) | 308.50 | **308.5** | Desk rail |

Closure: 1590.5 (cols 1–10) + 12 + 308.5 = **1911** ✓

**Height.** 1093 − 32 padding-block − 4 gaps x 12 = **1013** of track.

```
grid-template-rows: 36px 108px 20px minmax(0, 0.52fr) minmax(0, 0.48fr)
fixed = 164 · pool = 849 · 0.52x849 = 441.48 · 0.48x849 = 407.52
36 + 108 + 20 + 441 + 408 = 1013 ✓
```
Measured computed value: `36px 108px 20px 441.477px 407.516px`. `#dashboard.scrollHeight === clientHeight === 1093`. **No scroll.**

**Inside the tracks — measured:**

- **Band B, 108:** padding 12+12 = 24 → 84 content. Tallest cell is #4 (label 14 + gap 4 + read 40 + gap 4 + sub 14) = **76**. Measured `grid-template-rows: 76px`. 8px slack.
- **Band C, 20:** one 16px line, `scrollWidth === clientWidth === 1911` (no clipping).
- **Band D, 441.5 → Edge score canvas:** 441.5 − 32 padding − 16.9 head − 16 (two 8px grid gaps) − 63 foot = **313**. Measured `clientHeight 313`, `clientWidth 435`. `drawRadarChart` radius (`charts.js:1519`) = max(min((435−150)/2, (313−90)/2), 46) = **111.5**. Clear of the 46px floor by 2.4x.
- **Band D → equity canvas:** measured **333.5** tall. Above the `bare < 140` ladder at `charts.js`, so the nice-number y-axis runs.
- **Band E, 407.5 → calendar grid:** 407.5 − 24 padding − 20 head − 20 weekdays − 16 (two 8px gaps) = **327.5**; six rows at **51.25px** each (measured). Above 44 with room.
- **Band E → ledger table:** measured **595 x 166** in a 597 x 359.5 content box. The only panel with real slack — pooled in one place, which is what the reference does too.

### 1440 x 900 — measured

Box **1384 x 843**. Pitch (1384 − 32 − 132)/12 = **101.664** (measured). Track budget 843 − 32 − 48 = **763**.

```
grid-template-rows: 32px 88px 18px minmax(0, 0.52fr) minmax(0, 0.48fr)
fixed = 138 · pool = 625 · 0.52x625 = 325 exactly · 0.48x625 = 300 exactly
32 + 88 + 18 + 325 + 300 = 763 ✓
```
Measured: `32px 88px 18px 325px 300px`. `scrollHeight === clientHeight === 843`.

- Radar canvas **295 x 203** → radius **56.5**. Clear of the floor by 10.5. (This was the brief's tightest number at 51.5, and the reason the foot loses its 16px margin and 12px padding on this grid.)
- Strip cells **63** in 68 content — the `gap: 2px` short-screen rule is what buys the 5px; without it cells 4 and 5 come to exactly 68 and any label wrap overflows.
- Calendar tiles **33.3px** (vs 36.5 today). `.mc-n` is dropped at this height so the tile content is 8 padding + 10 index + 13 money = 31 in 33.3.

### Below 1240

The whole `@media (min-width:1240px)` block drops. `.dash-stats` / `.dash-month-card` / `.dash-boards` / `.panel-grid-analytics` stop being `display: contents` and become boxes again. Measured at 1100x800 and 1200x900:

- Hero + calendar side by side in `.dash-month-card`'s 2-column grid, unchanged.
- `.dash-now` becomes a full-width strip under the card in `.dash-stats`'s single-column grid, in its own base 2-column layout (147px tall at 1100 — identical to today's).
- All four analytics panels go full width, stacked in DOM order: Edge score, Equity curve, Net daily P&L, Recent trades. **Zero holes at both 1100 (2-col grid) and 1200 (12-col grid)** — verified.
- Radar canvas pinned to 260px → radius 85.
- Calendar drops the 8th column and hides `.mini-cal-week` at ≤899, so week rows re-align to 7 (verified at 375: 7 columns, 6 rows, 44px tiles, 7 visible weekday headers).
- The page already scrolls below 1240 (`scrollHeight` 3460 vs `clientHeight` 743 at 1100). Pre-existing. Not touched.

---

## 2. Build order — every step ships

Run `node tests/instrumentPanel.check.mjs` after each step.

| step | what | shippable because |
|---|---|---|
| **1** | **TV popout** (§6 + §7a + §7b). No layout change. | Independent of everything else. One class, one button, two CSS blocks. If the owner hates it, revert one commit. |
| **2** | **Ledger renderer + markup** (§4.5, §5.5, §7c). Panel appears in `.panel-grid-analytics` as a 5th/4th panel on the old 4-band grid. | The old grid places `.panel-grid-analytics > .panel` children; an unplaced extra lands in the implicit flow. Ugly for one commit, never broken. |
| **3** | **Edge score out of the drawer** (§4.4, §5.4). Still on the 4-band grid, still no `grid-area`. | Same. The radar already paints every render (`charts.js:583`), so nothing new starts running. |
| **4** | **Weekly totals + 8th column** (§4.6, §5.6, §7d). | Purely additive; the flat grid takes an 8th cell per row for free. |
| **5** | **Band B strip + band C line** (§4.2, §4.3, §5.2, §5.3, §7e, §7f). | The moment the strip markup lands, the band-B CSS must land with it — same commit. |
| **6** | **The 5-band grid** (§5.1) + **test edits** (§8). | This is the flip. Everything it places already exists. |
| **7** | **Short-screen + below-1240 branches** (§5.7, §5.8). | Degradation only. |

---

## 3. Deliberately not built

| reference element | why not |
|---|---|
| **"All accounts" / "group 1" chips** | `index.html:1854` states the product's own contract: *one equity curve per account, every screen scoped to the active one*. Every trade read routes through the active-account filter. There is no cross-account aggregate, and `grep -n 'group' app.js` finds no `group` field on an account. Both chips are a label over nothing. The real accounts already render as a `<select>` (`renderAccountSwitcher`, `app.js:11991`) that hides itself under 2 accounts (`app.js:12009`) — restyle that as chips if the owner wants the look, but do not ship the other two. |
| **`‹ 10 Aug – 16 Aug ›` stepped navigator** | `.dash-range` (`index.html:1410`) exists but scopes **one thing**: `state.dashboard.balanceRange` feeds the equity curve. The strip, calendar, day bars and edge score are all-time or current-month and read none of it. A window control over that would *look* like it moves the dashboard and would move one chart. A real window means threading a date range through `calculateAnalytics` (`app.js:8404`) and every renderer downstream. Separate work. |
| **"Share card" button** | Zero hits for `shareCard`, `navigator.share`, `toBlob` or canvas export across `app.js` and `index.html`. The card is DOM, not canvas, so a real export needs a rasteriser — a new dependency the constraints forbid. `#dashCardDate` (`index.html:1505`) and the `TJ · traderjournal.space` mark (`index.html:1571`) already exist for a manual crop. A button that does nothing is worse than no button. |
| **Flame "64 plan-followed streak"** | The honest analogue is `renderJournalStreak` (consecutive fully-journalled trading days), already rendered into `#dashJournalStreak`. Band C already carries six live figures; a seventh needs the 20px row to grow. Add it by swapping one cell if the owner asks. |
| **"100% plan adherence"** | `computeRuleCosts` (`app.js`) produces per-rule **money**, not a rate. The rate is derivable, but every pre-checklist and every imported trade has `preTradeRulesAsked: []`, so a fresh or imported journal has an empty denominator and must read "no checklist yet", not 100%. Not worth a band-C cell that says nothing for most users. |
| **A third TV size (`max`/cinema)** | Native fullscreen **already works on this exact tile** — `.bb-mon-full` at `app.js:16460`, handled at `app.js:15262-15272`, whose own comment says *the iframe node is never re-created, so a playing stream survives both directions*. The listener is on `document`, so it already fires on `#dashEdgeMiniTv`. That is the cinema. The popout is the one thing missing: a non-modal big that leaves the journal readable. One boolean, no enum, **no new module-level const**. `// ponytail: one popout size; a second (cinema) is `[data-tv="wide"|"max"]` plus one rule if the owner asks — native fullscreen covers it today.` |
| **`.mini-cal-footrow` on this grid** | 42px + 8px gap of "N GREEN · N RED · AVG" under a calendar whose header already prints the month net and whose rows now print week totals. Already dropped at ≤960 height (`clay-v3.css:4031`). The node stays; only the box goes. |
| **Playbook + Discipline Monitor panels** | No sixth and seventh slot on a five-band reference. Both keep their DOM nodes — `app.js:9808-9810` writes `ui.disciplineScore` / `ui.dailyTradingScore` / `ui.goalProgress` `.textContent` with **no null guard** and would throw the moment the markup is deleted. The playbook already owns the `#playbook` view. Take the slot from the ledger (the panel with real slack) when either comes back. |

---

## 4. index.html — exact edits

### 4.1 Panel titles (sentence case, reference wording)

| line | from | to |
|---|---|---|
| 1734 | `<h3>Equity Curve</h3>` | `<h3>Daily net cumulative P&amp;L</h3>` |
| 1819 | `<h3>Net Daily P&amp;L</h3>` | `<h3>Net daily P&amp;L</h3>` |

### 4.2 Band B — replace `index.html:1503-1550`

`1502` is `<section class="dash-month-card">` and `1550` is the article's `</article>`. **Replace 1503-1550 inclusive**, nothing outside it.

```html
              <!-- ── BAND B: ONE SURFACE, FIVE CELLS ─────────────────────────
                   Not five cards. This is the hero card, already spanning the
                   row and already carrying the only raised edge in the band,
                   re-tracked into five columns. The dividers are borders on the
                   cells, not gaps between panels: a gap would let the ground
                   through and make five surfaces out of one.

                   The gauge in each cell is a SIBLING of its [data-metric]
                   node, never a child. setCountUpValue (app.js:9545) assigns
                   node.textContent and the count-up rAF rewrites it again mid
                   tween, so a gauge nested inside a figure is deleted on every
                   render and again 16ms later. -->
              <article class="metric-card metric-card-balance dash-hero dash-reveal" style="--i: 0">
                <div class="strip-cell">
                  <div class="dash-hero-top">
                    <span class="dash-card-date" id="dashCardDate" aria-hidden="true"></span>
                    <p class="metric-label" id="dashBalanceLabel">Net P&amp;L</p>
                  </div>
                  <span
                    class="metric-note"
                    id="balanceOverrideNote"
                    title="This balance is set manually in Risk Controls and may differ from the computed equity curve."
                    hidden
                    >Manual override</span
                  >
                  <!-- NOT a relabel of accountBalance: that node is queried by
                       attribute on every price poll by renderLiveEquity and
                       keyed by METRIC_DELTA_SPECS, so it keeps its name and
                       drops to a 13px clause underneath. ui.metricNodes is a
                       flat querySelectorAll("[data-metric]") evaluated at
                       app.js:377, above init(), so any node carrying the
                       attribute is fed wherever it sits. -->
                  <p class="metric-value dash-hero-value" data-metric="totalPnl">$0.00</p>
                  <p class="dash-hero-equity"><span class="dash-hero-tag" id="dashEquityTag">Account balance</span><span class="metric-value" data-metric="accountBalance">$0.00</span></p>
                  <span class="dash-hero-range" id="dashHeroRange" hidden></span>
                </div>

                <div class="strip-cell">
                  <p class="metric-label">Trade win %</p>
                  <div class="strip-read">
                    <p class="metric-value" data-metric="winRate">0%</p>
                    <span class="gauge" id="gaugeWinRate" aria-hidden="true"></span>
                  </div>
                </div>

                <div class="strip-cell">
                  <p class="metric-label">Profit factor</p>
                  <div class="strip-read">
                    <p class="metric-value" data-metric="profitFactor">0.00</p>
                    <span class="gauge" id="gaugeProfitFactor" aria-hidden="true"></span>
                  </div>
                </div>

                <div class="strip-cell">
                  <p class="metric-label">Day win %</p>
                  <div class="strip-read">
                    <p class="metric-value" id="dayWinValue">0%</p>
                    <span class="gauge is-dial" id="gaugeDayWin" aria-hidden="true"></span>
                  </div>
                  <span class="strip-sub" id="dayWinSub"></span>
                </div>

                <div class="strip-cell">
                  <p class="metric-label">Avg win/loss trade</p>
                  <p class="metric-value" id="avgWinLossRatio">0.00</p>
                  <span class="split-bar" id="avgWinLossSplit" aria-hidden="true"><i class="sb-w"></i><i class="sb-l"></i></span>
                  <!-- A SPAN, not a P. Measured: as a <p> the base paragraph
                       margin (11px top AND bottom) makes this cell 96px in an
                       84px box and the whole strip overflows its track.
                       renderDashboardMetrics writes it by attribute
                       (app.js:9695) and it is not in `values`, so
                       setCountUpValue never touches it. -->
                  <span class="strip-sub" data-metric="avgWinLoss">$0.00 / $0.00</span>
                </div>

                <div class="dash-spark-wrap" aria-hidden="true">
                  <canvas id="dashSparkline" class="dash-spark" width="1000" height="180"></canvas>
                </div>
                <div class="dash-ground-caps" aria-hidden="true">
                  <span id="dashGroundLabel"></span>
                  <span id="dashGroundHiLo"></span>
                </div>
              </article>
```

`.dash-spark-wrap`, `.dash-ground-caps`, `#dashCardDate`, `#balanceOverrideNote` and `#dashHeroRange` all keep rendering into hidden nodes — `clay-v3.css:3891-3895` (rewritten below) still matches them as descendants of `.dash-hero`. `#dashSparkline` stays in the DOM so `ui.dashSparkline` is never null.

**Then delete the three cards those figures came from**, in `.eq-footnotes` (which opens at 1770 and closes at 1815):

- **1796-1800** — the `winRate` `<article>` (opening tag through `</article>`)
- **1801-1805** — the `profitFactor` `<article>`
- **1811-1814** — the `avgWinLoss` `<article>`

Leave 1806-1810 (Expectancy) and 1815 (`</div>`) alone. `.eq-footnotes` then carries **six** figures: `totalTrades`, `currentDrawdown`, `maxDrawdown`, `winningStreak`, `losingStreak`, `expectancy`. Two `[data-metric-delta]` chips die with the first two cards; `renderMetricDeltas` (`app.js:9623`) iterates a flat `ui.metricDeltaNodes` (`app.js:378`) and optional-chains `.closest`, so nothing throws.

### 4.3 Band C — move `.dash-now`

Cut `index.html:1529-1542` (the whole `<div class="dash-now">…</div>`) out of the article and paste it **immediately after `</section>` at 1574**, i.e. as the next sibling of `.dash-month-card` inside `.dash-stats`, before `<aside id="estimatedAnalyticsNotice">` at 1575. Contents unchanged; all six ids unchanged.

> **Do not** paste it inside `.dash-month-card`. Measured: `.dash-month-card` is `grid-template-columns: clamp(300px,26vw,400px) minmax(0,1fr)` (`clay-v3.css:3007`), and a third child lands in r1c2 and pushes `#dashMiniCal` to r2c1. As a child of `.dash-stats` (`display: grid`, one column, `styles.css:4714`) it is a full-width strip below 1240 and a grid item of `#dashboard` above it, because `.dash-stats` is in the `display:contents` promotion list at `clay-v3.css:3639-3641`. It also stays inside the node `renderDashboardMetrics` hides on the empty state (`app.js:9708`).

### 4.4 Band D left — Edge score out of the drawer

Cut `index.html:1996-2012` (`<article class="panel panel-chart panel-trader-score">` through `</article>`) and paste it as the **first child** of `<section class="panel-grid panel-grid-analytics">` (opens 1731), rewritten to:

```html
            <!-- OUT OF THE DRAWER. clay-v3.css:4011 closes #dashDepth with a
                 CHILD combinator, so this escapes the moment it stops being a
                 descendant. It lands inside .panel-grid-analytics on purpose:
                 the min-content blowout fix at clay-v3.css:1134 and the
                 subtitle fix at 1138 are BOTH selectored
                 `#dashboard .panel-grid-analytics .panel-trader-score` and
                 match nothing today. Any other home means widening two
                 selectors and re-fighting the measured 349.8px-track-in-a-
                 240.1px-box regression.

                 THREE CHILDREN, not four. .panel-trader-score is
                 `grid-template-rows: auto minmax(0,1fr) auto` (styles.css:2914);
                 a fourth child creates an implicit auto row, takes an extra 8px
                 gap and its own box out of the canvas, and at 1440x900 that is
                 what drops the radar onto its 46px floor. The caption stays
                 INSIDE .trader-score-foot where it already lives. -->
            <article class="panel panel-chart panel-trader-score" id="dashEdgeScore">
              <div class="panel-head"><h3>Edge score</h3></div>
              <canvas id="traderScoreChart" width="900" height="320" data-height="240" aria-label="Edge score radar chart"></canvas>
              <div class="trader-score-foot">
                <div class="trader-score-value-wrap">
                  <p class="metric-label">Your edge score</p>
                  <p id="traderScoreValue" class="trader-score-value">0</p>
                </div>
                <span class="score-rail" id="edgeScoreRail" aria-hidden="true"></span>
                <p id="traderScoreCaption" class="trader-score-caption">Add more trade data to build the score.</p>
              </div>
            </article>
```

Left behind in the drawer: `<p class="depth-caption" id="depthCaptionScore">` at 1995 (outside the article — `renderDepthCaptions`, `app.js:9673`, keeps working) and `<p class="depth-caption" id="depthCaptionPsych">` at 2013. `<details id="dashDepth">` at 1989 and its `<summary>` stay.

**The `data-score-info` button at 2002 is DELETED with the article.** It is inside `.panel-head-inline`, not outside it. `ui.scoreInfoButtons` (`app.js:419`) still resolves non-empty because a second `data-score-info` button lives at `index.html:1677`, so the `forEach` at `app.js:1619` still binds. The reference has no info chrome inside a panel.

**Do not touch the toggle listener at `app.js:2024-2028`.** `#psychologyChart` (2020) and `#rMultipleChart` (2034) stay in the drawer with the same zero-`clientHeight`-while-closed problem, and that listener is their forced repaint.

### 4.5 Band E left — the ledger. New, immediately after the `.panel-span-4` article closes at 1840

```html
            <article class="panel" id="dashLedger">
              <div class="panel-head"><h3>Recent trades</h3></div>
              <!-- No span class: below 1240 every analytics panel is pinned
                   full width by one rule, because .panel-grid-analytics is a
                   12-column bento at 1200 and a 2-column one at 1100 and a bare
                   panel would be 84px wide in the first. -->
              <table class="dash-ledger">
                <thead><tr><th scope="col">Close date</th><th scope="col">Symbol</th><th scope="col">Net P&amp;L</th></tr></thead>
                <tbody id="dashLedgerBody"></tbody>
              </table>
            </article>
```

### 4.6 Band E right — the calendar's 8th header cell. `index.html:1566`

```html
                  <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span></span>
```

Mandatory: `.mini-cal-weekdays` and `.mini-cal-grid` share one `grid-template-columns` rule (`clay-v3.css:3158-3163`) whose own comment says the two can never desync.

### 4.7 The TV control — insert **before** `index.html:1468`, inside `.dem-cmd`

(1468 is where `#dashEdgeMiniToggle` **opens**; 1474 is its closing line.)

```html
              <!-- WATCH. The picture goes big without moving one node in the
                   DOM: this button only writes a class on the rail, and the CSS
                   is position:fixed on #dashEdgeMiniTv, the element that
                   already contains the iframe. Native fullscreen is the second
                   size and already lives inside the tile (.bb-mon-full,
                   app.js:16460 / app.js:15262). -->
              <button
                class="dem-min"
                type="button"
                id="dashEdgeMiniOut"
                aria-controls="dashEdgeMiniTv"
                aria-pressed="false"
                aria-label="Pop out the live monitor"
              ><span class="dem-tv-out-label">watch</span></button>
```

`.dem-cmd` is **static markup** — `renderEdgeMini` (`app.js:16949`) writes text into `#dashEdgeMiniAsOf` and html into `#dashEdgeMiniTv` / `#dashEdgeMiniNews` / `#dashEdgeMiniBody`, and never rewrites the command bar. So `aria-pressed` and the label survive the once-a-second render with no re-sync call. The button ships in the docked state, which is also the boot state, so there is no boot-time call to place.

There is no "no stream linked" state to guard: `getWallChoice()` (`app.js:16808`) always backfills four real roster ids, so slot 0 always resolves, and the whole rail ships `hidden` and stays hidden without `terminalPro` (`app.js:16955`) — the button can never render dead.

---

## 5. clay-v3.css — exact rules, named by address

### 5.1 The grid — `clay-v3.css:3650-3652`, replace the comment + declaration

```css
    /* 1093 view box - 32 padding-block - 48 row gaps = 1013 of track.
       36 + 108 + 20 + 0.52x849 + 0.48x849 = 36+108+20+441.48+407.52 = 1013.
       Measured at 1999x1150: 36px 108px 20px 441.477px 407.516px, and
       #dashboard.scrollHeight === clientHeight === 1093. */
    grid-template-rows: 36px 108px 20px minmax(0, 0.52fr) minmax(0, 0.48fr);
```

> Keep the two lines above it byte-identical — `tests/instrumentPanel.check.mjs:127` anchors on the literal string `"#dashboard.is-active {\n    grid-template-columns"` after comment-stripping.

### 5.2 Band B — replace `clay-v3.css:3860-3895` entirely

That range is: the BAND B comment (3860-3864), the `.dash-hero` rule (3865-3873), `.dash-hero > *` (3874), `.dash-hero .dash-now` (3875-3887), `.dash-now > *` (3888), a comment (3889-3890) and the long-tail cull (3891-3895). **Keep 3896-3897** (`.dash-quad { display: none }`).

```css
  /* ── BAND B: ONE SURFACE, FIVE CELLS, ZERO NEW BOXES ───────────────────
     The hero card already spans this row and already carries the band's only
     raised edge. It becomes a five-track grid; the dividers are borders on the
     cells, not gaps between them, because a gap would let the ground through
     and turn one surface into five. .dash-now is no longer a child of it —
     it moved one level up in index.html and takes band C. */
  #dashboard.is-active .dash-hero {
    grid-area: 2 / 1 / 3 / -1;
    padding: 12px 0;
    display: grid;
    grid-template-columns: 1.3fr 1fr 1fr 1fr 1.2fr;
    grid-auto-rows: auto;
    align-content: center;
    column-gap: 0;
  }
  #dashboard.is-active .strip-cell {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    padding: 0 16px;
    border-left: 1px solid var(--line);
  }
  #dashboard.is-active .strip-cell:first-child { border-left: 0; }
  /* The figure and its mark are SIBLINGS. setCountUpValue (app.js:9545)
     assigns node.textContent and the count-up rAF rewrites it again mid tween,
     so a gauge nested inside a [data-metric] node is deleted on every render
     and again 16ms later. */
  #dashboard.is-active .strip-read {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  #dashboard.is-active .strip-sub {
    font: 500 11px/14px var(--font-mono);
    color: var(--text-faint);
    margin: 0;
  }
  #dashboard.is-active .strip-cell .metric-label {
    font: 500 11px/14px var(--font-mono);
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-faint);
    margin: 0;
  }
  /* ONE rule for both, so the two never fight: .strip-cell .metric-value and
     [data-metric="totalPnl"] are both (1,2,0) and source order would decide. */
  #dashboard.is-active .strip-cell .metric-value,
  #dashboard.is-active [data-metric="totalPnl"],
  #dashboard.is-active .dash-hero-value {
    font: 700 28px/30px var(--font-mono);
    letter-spacing: -0.02em;
    margin: 0;
  }
  /* (1,3,0). The account-balance clause is a [data-metric] node inside a
     .strip-cell, so the rule above would otherwise blow it up to 28px —
     clay-v3.css:3804 is only (1,2,0) and loses. */
  #dashboard.is-active .dash-hero-equity .metric-value {
    font: 600 13px/16px var(--font-mono);
    color: var(--text-faint);
  }
  /* The hero's long tail. Each keeps rendering into a hidden node, which costs
     nothing; #dashSparkline stays in the DOM so ui.dashSparkline is never null. */
  #dashboard.is-active .dash-hero .dash-spark-wrap,
  #dashboard.is-active .dash-hero .dash-ground-caps,
  #dashboard.is-active .dash-hero .metric-note,
  #dashboard.is-active .dash-hero-range,
  #dashboard.is-active .dash-hero #dashCardDate { display: none; }

  /* ── BAND C: RUN FACTS, NO SURFACE ─────────────────────────────────────
     The reference's thin line. .dash-now is a grid item of #dashboard now (via
     display:contents on .dash-stats), so its own border-top and margin have to
     go or the line reads as the strip's underline. Measured at 1999x1150:
     scrollWidth === clientWidth === 1911, so nothing clips. */
  #dashboard.is-active .dash-now {
    grid-area: 3 / 1 / 4 / -1;
    display: flex;
    align-items: baseline;
    flex-wrap: nowrap;
    overflow: hidden;
    gap: 16px;
    margin: 0;
    padding: 0 16px;
    border-top: 0;
  }
  #dashboard.is-active .dash-now > * {
    display: flex;
    align-items: baseline;
    gap: 8px;
    white-space: nowrap;
    padding: 0;
    border-left: 0;
  }
  #dashboard.is-active .dash-now-label {
    font: 500 11px/14px var(--font-mono);
    text-transform: none;
    letter-spacing: 0;
    margin: 0;
  }
  #dashboard.is-active .dash-now-sub { font: 500 11px/14px var(--font-mono); }
```

**Also rewrite `clay-v3.css:3819-3821`** (the old band-C type):

```css
  #dashboard.is-active .dash-now-fig { font: 700 13px/16px var(--font-mono); }
  #dashboard.is-active #dashHeroToday,
  #dashboard.is-active #dashNowOpen { font-size: 13px; line-height: 16px; }
```

**And `clay-v3.css:3799-3803`** — delete the `[data-metric="totalPnl"]` rule; it is folded into the combined rule above. (Leave `3804-3807` `[data-metric="accountBalance"]` alone; the `.dash-hero-equity .metric-value` rule beats it where it matters and it still governs elsewhere.)

### 5.3 Panel titles — rewrite `clay-v3.css:544-549`

```css
  /* Sentence case, muted, small. A panel title is a LABEL, not an
     announcement; mono-uppercase-tracked at 13px is what made six quiet boxes
     read as six competing ones. */
  #dashboard .panel-grid-analytics .panel-head h3 {
    font: 500 11px/14px var(--font-mono);
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-faint);
  }
```

### 5.4 Bands D and E — replace the grid-area rules

**`clay-v3.css:3899-3905`** (BAND C comment + the three rules) becomes:

```css
  /* ── BAND D: WHERE IS MY EDGE ──────────────────────────────────────────
     display:contents places the panels directly on the outer grid, which is
     what kills .panel-span-8's `grid-column: span 8` clamp without a new
     override. Placed by ID where a new panel needs one, so a class-based area
     can never tie with it. */
  #dashboard.is-active .panel-grid-analytics { display: contents; }
  #dashboard.is-active .panel-grid-analytics > #dashEdgeScore { grid-area: 4 / 1 / 5 / 4; }
  #dashboard.is-active .panel-grid-analytics > .panel-span-8  { grid-area: 4 / 4 / 5 / 8; }
  #dashboard.is-active .panel-grid-analytics > .panel-span-4  { grid-area: 4 / 8 / 5 / 11; }
  #dashboard.is-active .panel-grid-analytics > #dashLedger    { grid-area: 5 / 1 / 6 / 5; }
```

**`clay-v3.css:3907-3912` stays untouched** — `#drawdownChart { display: none }` is marked LOAD BEARING and its comment is correct.

**`clay-v3.css:3914-3916`** becomes:

```css
  /* No room on a five-band grid, and both have a home already: the playbook
     owns the #playbook view (renderPlaybookPage), and the discipline numerals
     are the Edge score's own axes said twice. The NODES STAY — app.js:9808-9810
     writes ui.disciplineScore / ui.dailyTradingScore / ui.goalProgress
     textContent with no null guard, exactly like #drawdownChart. Only the
     boxes go. */
  #dashboard.is-active #dashPlaybook,
  #dashboard.is-active .dash-board-slot { display: none; }
  #dashboard.is-active #propTracker { grid-area: 5 / 5 / 6 / 11; }
  #dashboard.is-active:has(#propTracker:not([hidden])) #dashMiniCal { display: none; }
```

**`clay-v3.css:3924`** (inside the `.dash-edge-mini` rule at 3923-3928) — the rail spans the two fr rows, which are now 4 and 5:

```css
    grid-area: 4 / 11 / 6 / -1;
```

**`clay-v3.css:3946-3947`** becomes:

```css
  #dashboard.is-active #dashMiniCal { grid-area: 5 / 5 / 6 / 11; }
  #dashboard.is-active .mini-cal-footrow { display: none; }   /* the head prints
                                        the month net and every row now prints
                                        its own total; already dropped at
                                        max-height 960 for the same reason */
  #dashboard.is-active .mini-cal-open { min-height: 0; }      /* a 42px touch
                                        target in a pointer-only layout; the
                                        18px it returns is what puts the tiles
                                        at 51.25px instead of 39.3 */
```

**`clay-v3.css:3953-3956`** — replace the four rule lines only. **Do not touch 3949-3952**: 3952 is the closing `*/` of the comment above, and deleting it leaves `/*` open from 3949 and swallows the rest of the sheet.

```css
  #dashboard.is-active:has(.dash-edge-mini[hidden]) .panel-grid-analytics > .panel-span-4,
  #dashboard.is-active:has(.dash-edge-mini[hidden]) #dashMiniCal,
  #dashboard.is-active:has(.dash-edge-mini[hidden]) #propTracker,
  #dashboard.is-active:has(.dash-edge-mini[hidden]) #dashboardEmptyState { grid-column-end: -1; }
```

(The two `#dashPlaybook[hidden]` branches go: the playbook no longer holds a slot, so its absence cannot leave a hole. `clay-v3.css:3723` — the `[hidden]` guard the test pins — stays.)

### 5.5 The empty state keeps the rail — `clay-v3.css:4003-4007`

Leave 4003-4006 exactly as they are. **Insert immediately after 4006**, before 4007:

```css
  /* THE ONE ANCESTOR THE CULL ABOVE WAS CLOSING. .dash-edge-mini is a direct
     child of #dashboard, so a terminalPro trader who deletes their last trade
     while watching loses the stream — a pre-existing hole in the never-
     display:none contract that the popout makes reachable.

     MEASURED SPECIFICITY, because the obvious fix does not work: the cull is
     (3,3,0) — :has(#dashboardEmptyState…) contributes an ID and so does
     :not(#dashboardEmptyState). `> .dash-edge-mini` at (2,3,0) LOSES; I applied
     it live and the rail measured 0x0. `> #dashEdgeMini:not([hidden])` is
     (3,3,0), a tie broken by source order, and :not([hidden]) is not padding —
     it is what keeps `hidden` closing the rail for anyone without terminalPro.
     Written with the ID, not the class, so guard 6 in
     tests/instrumentPanel.check.mjs cannot mistake it for a cull.
     Measured with the empty state showing: rail 309x861 at (1675,273), empty
     panel 422x287 at (817,484) — no overlap, no scroll. */
  #dashboard.is-active:has(#dashboardEmptyState:not([hidden])) > #dashEdgeMini:not([hidden]) { display: grid; }
```

### 5.6 The calendar's 8th column — rewrite `clay-v3.css:3161` and extend `3369-3370`

At 3161, inside the shared `.mini-cal-weekdays, .mini-cal-grid` rule:

```css
  grid-template-columns: repeat(7, minmax(0, 1fr)) minmax(0, 0.9fr);
```

Then, at top level near the other calendar rules (after `clay-v3.css:3182`):

```css
/* THE WEEK TOTAL. An 8th cell per row in a grid that has no per-week element:
   the grid is flat, seven columns of CSS auto-flow, so an 8th cell lands at the
   row end for free. It is inert — handleCalendarDayClick (app.js:12598) matches
   closest("[data-date]") and this cell carries none. */
#dashboard .mini-cal-weekdays span:last-child { background: none; }
#dashboard .mini-cal-week {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 4px;
  font: 500 11px/14px var(--font-mono);
  color: var(--text-faint);
}
/* .pnl-positive is a bare (0,1,0) global (styles.css:3621); the rule above is
   (1,1,0) and would beat it. Restated at winning specificity. */
#dashboard .mini-cal-week.pnl-positive { color: var(--pnl-pos); }
#dashboard .mini-cal-week.pnl-negative { color: var(--pnl-neg); }
```

And inside the existing `@media (max-width: 899px)` block, extend the rule at **3369-3370**:

```css
  /* Below 900 the tiles are already bleeding -6px of margin (clay-v3.css:3375)
     to reach the 44px touch floor; an 8th column would cost 12% of every one.
     display:none on the week cell removes it from auto-flow, so the remaining
     seven re-align. Verified at 375x812: 7 columns, 6 rows, 44px tiles. */
  #dashboard .mini-cal-weekdays,
  #dashboard .mini-cal-grid { gap: 3px; grid-template-columns: repeat(7, minmax(0, 1fr)); }
  #dashboard .mini-cal-week,
  #dashboard .mini-cal-weekdays span:last-child { display: none; }
```

### 5.7 The Edge score panel's foot — new rules in the 1240 block

```css
  /* THE TIGHTEST NUMBER IN THE DESIGN LIVES HERE. styles.css:2917 gives the
     foot margin-top var(--space-2) and padding-top var(--space-3), and
     styles.css:8062 raises the margin to var(--space-4) — 16 + 12 + 1 = 29px of
     chrome. At 1440x900 that puts the radar canvas at 174 and
     Math.max(Math.min(..., (174-90)/2), 46) pins it on the 46px FLOOR: the
     exact 92px-circle regression documented at src/modules/charts.js:1515-1518.
     8 + 8 buys 13px back. MEASURED after: canvas 295x203, radius 56.5. */
  #dashboard.is-active .trader-score-foot {
    margin-top: 8px;
    padding-top: 8px;
    gap: 16px;
    align-items: end;
  }
  #dashboard.is-active .trader-score-value-wrap { gap: 4px; }
  #dashboard.is-active .trader-score-value { font: 700 28px/30px var(--font-mono); }
  /* The caption stays in the DOM (renderDashboardMetrics writes it at
     app.js:9818) and inside .trader-score-foot, so the panel keeps exactly
     three grid children. Only its box goes. */
  #dashboard.is-active .trader-score-caption { display: none; }
```

### 5.8 `.eq-footnotes` now carries six — rewrite `clay-v3.css:3755-3764`

```css
  /* Six figures, not nine: win rate, profit factor and avg win/loss moved up
     into the band-B strip. Explicit rows, because with `auto` the flex
     algorithm sizes the strip before the grid wraps and clips a row. */
  #dashboard.is-active .eq-footnotes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: 18px 18px;
    row-gap: 8px;
    column-gap: 16px;
    flex: 0 0 44px;
    align-content: center;
    margin: 0;
  }
  #dashboard.is-active .eq-footnotes .metric-value { font: 500 13px/16px var(--font-mono); }
  #dashboard.is-active .eq-footnotes .metric-label { font: 500 11px/14px var(--font-mono); }
```

### 5.9 Short screens — rewrite `clay-v3.css:4016-4033`

```css
/* ── SHORT SCREENS ───────────────────────────────────────────────────────
   The fr rows absorb any height; the 162px of FIXED rows do not. At 1440x900
   the budget is 843 - 32 padding - 48 gaps = 763 of track, and
   32 + 88 + 18 + 0.52x625 + 0.48x625 = 32+88+18+325+300 = 763, both fr terms
   exact. Everything below is the type ramp stepping down with it. */
@media (min-width: 1240px) and (max-height: 960px) {
  #dashboard.is-active { grid-template-rows: 32px 88px 18px minmax(0, 0.52fr) minmax(0, 0.48fr); }
  #dashboard.is-active .dash-hero { padding-block: 10px; }
  /* 2px, not 4. At gap:4 with the 22px ramp, cells 4 and 5 come to EXACTLY 68
     against exactly 68 of content box — zero slack, and any label wrap
     overflows. MEASURED at gap:2: cells 63 in 68. */
  #dashboard.is-active .strip-cell { gap: 2px; }
  #dashboard.is-active .strip-cell .metric-value,
  #dashboard.is-active [data-metric="totalPnl"],
  #dashboard.is-active .dash-hero-value,
  #dashboard.is-active .trader-score-value { font-size: 22px; line-height: 24px; }
  #dashboard.is-active [data-metric="accountBalance"] { font-size: 12px; line-height: 14px; }
  #dashboard.is-active .dash-hero-equity { margin-top: 3px; }
  #dashboard.is-active .gauge { width: 28px; height: 28px; }
  #dashboard.is-active .eq-footnotes { flex: 0 0 40px; grid-template-rows: 16px 16px; row-gap: 8px; }
  /* Tiles are 33.3px here. 8 padding + 10 index + 13 money = 31; the count is
     the line that does not fit. */
  #dashboard.is-active .mini-cal-day .mc-n { display: none; }
  #dashboard.is-active .dem-tv { max-height: 120px; }
}
```

### 5.10 Below 1240 — new block at the end of the file

```css
/* ── BELOW THE INSTRUMENT GRID ───────────────────────────────────────────
   MEASURED, because the two facts here are not guessable. (1)
   .panel-grid-analytics is `repeat(12, minmax(0,1fr))` at 1200 (styles.css:4866)
   and `repeat(2, …)` at 1100, and a span clamps to the track count in both —
   so a class-less #dashLedger is 84px wide at 1200 and full width at 1100.
   Pinning every panel full width is the only answer that is right at both.
   (2) .panel-chart canvas is `width:100%; height:auto` (styles.css:2841), so
   with no box the radar takes its own BITMAP's aspect ratio — measured 667px
   tall at 970 wide, and self-reinforcing, because getCanvasContext writes the
   next bitmap from that clientHeight. 260 matches its data-height attribute. */
@media (max-width: 1239px) {
  #dashboard .panel-grid-analytics > .panel { grid-column: 1 / -1; }
  #dashboard #traderScoreChart { height: 260px; }
}
```

### 5.11 New base CSS — the marks, the rail, the ledger, the TV. Append at the end of clay-v3.css

```css
/* ══ THE STRIP'S MARKS ═══════════════════════════════════════════════════
   ONE primitive, three readings: a conic sweep over a track, punched hollow by
   a radial mask. --pct (0..1) is the only thing JS writes.

   Not canvas: charts.js reads its tokens once into a module-level palette cache
   (src/modules/charts.js:80-101) and getCanvasContext (charts.js:1674)
   reallocates the bitmap and needs a laid-out box on every call — and the
   dashboard already carries eight <canvas> elements. Not SVG: that is an
   innerHTML string rebuilt on every renderAll plus dasharray arithmetic. Here
   --pnl-pos and --chart-track resolve at :root, in BOTH themes, with no
   plumbing at all. Do not pin either token on these elements. */
.gauge {
  position: relative;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: conic-gradient(var(--pnl-pos) calc(var(--pct, 0) * 1turn), var(--chart-track) 0);
  -webkit-mask: radial-gradient(closest-side, transparent 62%, #000 63%);
  mask: radial-gradient(closest-side, transparent 62%, #000 63%);
}
/* THE DIAL. The mask moves to ::before, because a mask on the parent clips its
   whole subtree — a needle drawn as a child of the ring would be cut out by the
   ring's own hole. Same sweep, half a turn, opened at the bottom. */
.gauge.is-dial { background: none; -webkit-mask: none; mask: none; }
.gauge.is-dial::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from -90deg,
    var(--pnl-pos) calc(var(--pct, 0) * 0.5turn),
    var(--chart-track) 0 0.5turn,
    transparent 0
  );
  -webkit-mask: radial-gradient(closest-side, transparent 62%, #000 63%);
  mask: radial-gradient(closest-side, transparent 62%, #000 63%);
}
.gauge.is-dial::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 2px;
  height: 40%;
  border-radius: 1px;
  background: var(--text);
  transform-origin: 50% 100%;
  transform: translate(-50%, -100%) rotate(calc(var(--pct, 0) * 180deg - 90deg));
}
/* CELL 5. flex-grow does the normalisation, so the renderer writes the RAW
   magnitudes and no ratio arithmetic lives in CSS. Same idiom as .day-bar's
   --mag at clay-v3.css:3326. */
.split-bar {
  display: flex;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--chart-track);
}
.split-bar > .sb-w { flex: var(--w, 0) 1 0; background: var(--pnl-pos); }
.split-bar > .sb-l { flex: var(--l, 0) 1 0; background: var(--pnl-neg); }

/* ══ THE EDGE SCORE RAIL ═════════════════════════════════════════════════ */
.score-rail {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--pnl-neg), var(--warn), var(--pnl-pos));
}
.score-rail::after {
  content: "";
  position: absolute;
  top: 50%;
  left: clamp(0%, calc(var(--score, 0) * 1%), 100%);
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  background: var(--text);
  box-shadow: 0 0 0 2px var(--surface-1);
}

/* ══ THE LEDGER ══════════════════════════════════════════════════════════
   Four overrides, none of them cosmetic — MEASURED, this table renders 980px
   wide inside a 597px panel without the first one:
     styles.css:3537  table       { min-width: 980px }
     styles.css:3541  th, td      { padding: 8px 10px; border-bottom: … }
     styles.css:3548  thead th    { position: sticky; background: …;
                                    text-transform: uppercase; … }
   The reference is a table with nothing on it, so undoing all three IS the
   design. */
.dash-ledger {
  width: 100%;
  min-width: 0;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.dash-ledger th,
.dash-ledger td { padding: 4px 0; border: 0; background: none; text-align: left; }
.dash-ledger thead th {
  position: static;
  background: none;
  text-transform: none;
  letter-spacing: 0;
  font: 500 11px/14px var(--font-mono);
  color: var(--text-faint);
}
.dash-ledger td { font: 500 13px/16px var(--font-mono); color: var(--text); }
.dash-ledger th:last-child,
.dash-ledger td:last-child { text-align: right; }
.dash-ledger .is-pos { color: var(--pnl-pos); }
.dash-ledger .is-neg { color: var(--pnl-neg); }
.dash-ledger-empty { color: var(--text-faint); }

/* ══ THE TV GOES BIG WITHOUT MOVING ══════════════════════════════════════
   position:fixed on #dashEdgeMiniTv — the element that ALREADY CONTAINS the
   iframe. Zero DOM movement, zero reload.

   VERIFIED ON THE LIVE PAGE, not reasoned: the iframe object was captured by
   reference and compared with === across dock -> wide -> dock and through a
   rail collapse, with a data-attribute probe written on the node. Identical
   every time. And nothing on the ancestor chain (.dem-panel, .dash-edge-mini,
   #dashboard, main.content, .app-layout, body) reports transform, filter,
   backdrop-filter, contain, perspective or will-change under getComputedStyle,
   so no containing block is established and this resolves against the viewport.
   #dashboard's own overflow:hidden (clay-v3.css:3658) does not clip a fixed
   descendant. Measured in all states: scrollHeight === clientHeight === 1093.

   SPECIFICITY (1,4,0) — an attribute scores in the class column. The two caps
   it must beat, clay-v3.css:3934 (168px) and the short-screen one, are (1,2,0).
   Dropping the `#dashboard.is-active` prefix loses, and the symptom is subtle:
   the picture renders at the right width and gets clipped to 168px tall.

   Z-INDEX: #dashboard is position:fixed z-index:20 (styles.css:12113-12122),
   which creates a STACKING CONTEXT, so this number is read inside it.
   nav.rail (z:100, x 0-56) and .app-ticker (z:99, y 0-57) paint over it at ANY
   value — measured. The anchor clears both; do not re-anchor to the top-left. */
#dashboard.is-active .dash-edge-mini.is-tv-out .dem-tv {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 5;
  display: grid;
  align-content: center;
  /* MEASURED: 1999x1150 -> 920x517 at (1059,613), leaving 1039px of board
     clear — bands A and B whole, the radar whole, the curve whole. 1440x900 ->
     662x373. The height term is what stops a short wide screen from pushing the
     picture up into band B. */
  width: min(46vw, (100dvh - 260px) * 16 / 9);
  height: calc(min(46vw, (100dvh - 260px) * 16 / 9) * 9 / 16);
  max-height: none;
  padding: 0;
  border: 1px solid var(--term-line);
  border-radius: var(--radius-clay-sm);
  background: var(--term-void);
  overflow: hidden;
  box-shadow: 0 32px 80px rgb(0 0 0 / 0.62);
}
/* A phone has one size, anchored to the TOP: #tabBar (fixed, z:100, y 736 at
   375x812) and #tabBarNewTradeBtn (z:101, y 700) both paint over #dashboard's
   z:20 context, and a bottom anchor measured 173x97 sitting under the FAB. The
   top only has to clear the sticky #sidebar's 52px. MEASURED: 359x202 at (8,56). */
@media (max-width: 899px) {
  #dashboard.is-active .dash-edge-mini.is-tv-out .dem-tv {
    width: calc(100vw - 16px);
    height: calc((100vw - 16px) * 9 / 16);
    left: 8px;
    right: auto;
    bottom: auto;
    top: calc(56px + env(safe-area-inset-top, 0px));
  }
}

/* ponytail: dashboard-scoped popout. .view { display: none } (styles.css:2644),
   toggled by switchView, means navigating to Journal or Edge takes the fixed TV
   AND its iframe with it. A stream that survives navigation needs #dashboard to
   stop being display:none, which is a shell-wide layout change, not a TV change. */
```

---

## 6. styles.css — two inserts

**Insert directly under `styles.css:9746`**, beside the rule it beats:

```css
/* THE POPPED-OUT TV SURVIVES `hide`. The rule above is display:none on
   .dem-panel, and .dem-panel is the iframe's PARENT — display:none on an
   ancestor takes the whole subtree out of rendering however fixed the TV is.
   A JS classList.remove("is-min") would not hold either: syncEdgeMiniCollapsed
   (app.js:16931) re-reads EDGE_MINI_KEY and re-applies the class on EVERY
   render, once a second behind the clock.

   So the panel keeps its BOX and loses its contents. .dem-tv is out of flow, so
   the panel computes to zero height and the rail still reads as one collapsed
   line. (0,4,0) beats (0,3,0) above. Verified live: iframe identity held across
   the collapse.

   THIS LIVES IN styles.css ON PURPOSE. Guard 6 in
   tests/instrumentPanel.check.mjs:115 is a NEGATED regex over clay-v3.css that
   matches any rule whose selector text contains `.dash-edge-mini` and whose
   block contains display:none. I ran it against this exact string: it matches.
   In clay-v3 these two lines fail the suite; here they do not, and here is also
   where the rule they beat already lives. */
.dash-edge-mini.is-min.is-tv-out .dem-panel { display: block; }
.dash-edge-mini.is-min.is-tv-out .dem-panel > *:not(.dem-tv) { display: none; }
```

**Insert after `styles.css:9743`** (the `.dem-min` block):

```css
/* Two controls share the command bar's right end now, and .dem-min carries
   margin-left:auto unconditionally (styles.css:9730) — a SECOND auto margin
   splits the free space BETWEEN them instead of grouping them, which reads as a
   stray button stranded in the middle of the bar. */
.dem-cmd .dem-min + .dem-min { margin-left: 0; }
```

---

## 7. app.js — exact changes

All new functions are **declarations**, so hoisting is free and the TDZ trap at `app.js:1258` is respected by construction. **No new module-level `const`/`let` anywhere** — the popout is one class, not a persisted enum.

### 7a. The popout toggle — insert at `app.js:15448`, right after the rail's minimize handler closes (15447), inside `setupTerminal()` (15222) where every other monitor listener lives

```js
  /* WATCH. One class on the rail; every pixel of the size is CSS on
     #dashEdgeMiniTv, the element that already holds the iframe, so nothing
     moves in the DOM and no ancestor is ever closed.

     NOT a sixth WALL_SIZES token. applyWallSize (app.js:16760) writes
     #bbWall.dataset.size, then measures three terminal-only nodes and publishes
     --mon-head-h / --tape-h / --wall-head-h that only the .bb-wall[data-size]
     rules read, and it persists to WALL_SIZE_KEY — which getWallSize replays at
     app.js:16475 through WALL_SIZES.includes(). A dashboard name there matches
     no rule and silently breaks the desk's layout. Two mechanisms, one boolean
     here.

     NOT persisted. Nothing autoplays — the tile is a standby button until it is
     asked for (index.html:1482) — so a restored "out" state would paint a
     920x517 black rectangle over band D on every single reload. */
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("#dashEdgeMiniOut");
    if (!toggle) {
      return;
    }
    const host = document.getElementById("dashEdgeMini");
    const out = host.classList.toggle("is-tv-out");
    toggle.setAttribute("aria-pressed", String(out));
    toggle.setAttribute("aria-label", out ? "Dock the live monitor" : "Pop out the live monitor");
    setText(toggle.querySelector(".dem-tv-out-label"), out ? "dock" : "watch");
    if (out) {
      // One press opens it AND starts it, so "watch" never produces a 920px
      // standby rectangle. playMonitor early-returns once an iframe exists
      // (app.js:16839), so this can never reload a playing stream.
      playMonitor(document.querySelector("#dashEdgeMiniTv .bb-mon"));
    }
  });
```

### 7b. Escape — rewrite the existing handler at `app.js:15289-15297` in place. Do not add a second listener

```js
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || document.querySelector("dialog[open]")) {
      return;
    }
    // Native fullscreen first. An Escape that is LEAVING .bb-mon-full's
    // fullscreen (app.js:15262-15272) must not also dock the TV or resize the
    // wall — one key, one thing. This also fixes a pre-existing case:
    // fullscreening a wall tile and pressing Escape used to snap the wall back
    // to "half" as a side effect.
    if (document.fullscreenElement) {
      return;
    }
    const host = document.getElementById("dashEdgeMini");
    if (host?.classList.contains("is-tv-out")) {
      host.classList.remove("is-tv-out");
      const toggle = document.getElementById("dashEdgeMiniOut");
      toggle?.setAttribute("aria-pressed", "false");
      toggle?.setAttribute("aria-label", "Pop out the live monitor");
      setText(toggle?.querySelector(".dem-tv-out-label"), "watch");
      toggle?.focus();
      return;
    }
    if (document.getElementById("bbWall")?.dataset.size === "max") {
      applyWallSize("half");
    }
  });
```

### 7c. A channel change while popped out — insert after `app.js:16914`, inside `setWallSlot()`

```js
    // Popped out, a channel change must not leave a 920x517 standby rectangle
    // where a picture was. Same reasoning as the paste handler at app.js:15426,
    // whose comment already says a silent success read as broken. This is the
    // ONE innerHTML write on this element that is not channel-gated — the
    // once-a-second render at app.js:16985 is.
    if (document.getElementById("dashEdgeMini")?.classList.contains("is-tv-out")) {
      playMonitor(tv.querySelector(".bb-mon"));
    }
```

### 7d. `renderDashLedger()` — new declaration, anywhere in app.js (beside `renderDayBars`, `app.js:12382`, is where a reader will look)

```js
/* THE REFERENCE'S LEDGER. getClosedTrades returns a FRESH array
   (trades.filter, app.js:8362), so sorting it in place cannot disturb
   state.trades. Field names are from buildTradeRecord: trade.date, trade.asset
   (there is NO trade.symbol) and trade.netPnl. trade.closedAt is "" on legacy
   and imported rows, so nothing keys on it — formatCompactTradeDate
   (src/modules/tradeDisplay.js:99, destructured at app.js:810) already falls
   back through createdAt / closedAt / updatedAt. */
function renderDashLedger() {
  const host = document.getElementById("dashLedgerBody");
  if (!host) {
    return;
  }
  const rows = getClosedTrades().sort(sortTradesDesc).slice(0, 6);
  host.innerHTML = rows.length
    ? rows
        .map(
          (trade) =>
            `<tr><td>${escapeHtml(formatCompactTradeDate(trade))}</td>` +
            `<td>${escapeHtml(trade.asset || "—")}</td>` +
            `<td class="${trade.netPnl < 0 ? "is-neg" : "is-pos"}">${escapeHtml(
              // House zero rule, same as app.js:8672 and app.js:11021.
              trade.netPnl === 0 ? formatCurrency(0) : formatSignedCurrency(trade.netPnl)
            )}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="3" class="dash-ledger-empty">No closed trades yet.</td></tr>`;
}
```

**Call site: `app.js:8259`**, one line after `renderDayBars(state.analytics);` (8258), in the same `renderAll()` block that already drives `renderDashMiniCal()` (8257).

Helpers verified in scope: `sortTradesDesc` (11), `escapeHtml` (17), `formatCurrency` (24), `formatCompactTradeDate` (810), `formatSignedCurrency` (825), `getClosedTrades` (8354).

### 7e. `renderStripMarks(analytics)` — new declaration, beside `renderDashboardMetrics` (`app.js:9690`)

```js
/* ONE property per mark. Every gauge node is a SIBLING of its figure, never a
   child — see the .strip-read comment in clay-v3.css. */
function renderStripMarks(analytics) {
  const pct = (id, value) => {
    const node = document.getElementById(id);
    if (node) {
      node.style.setProperty("--pct", Number.isFinite(value) ? clamp(value, 0, 1).toFixed(3) : "0");
    }
  };

  pct("gaugeWinRate", analytics.winRate / 100);

  /* PROFIT FACTOR HAS NO MAXIMUM, and calculateAnalytics carries an explicit
     999 infinity sentinel (app.js:8536), so "fraction of a circle" is undefined
     for it. Reuse the scale this codebase already committed to:
     normalizeToScore(pf, 0, 3) is what feeds the radar's OWN Profit factor axis
     (app.js:9396). Band B and band D are two marks for one number on one
     screen; if they disagreed about how full "good" looks, that is the bug.
     Above PF 3 the difference between 3 and 52 is sample size, not edge, and
     the numeral still prints the infinity glyph at the sentinel. */
  pct("gaugeProfitFactor", normalizeToScore(analytics.profitFactor, 0, 3) / 100);

  /* DAY WIN %. The exact arithmetic exists inside computeTraderScore
     (app.js:9389-9390) but is folded into consistencyRatio and never escapes —
     and consistencyRatio is a 0.8/0.2 blend (app.js:9392), not the plain ratio,
     so it cannot be reused as the figure. Two lines here beat widening the
     analytics return. dailyPnl.size is 0 on a fresh account, so the guard is
     not optional.

     The percent and the "N of M" come off the SAME pair, so they always
     reconcile. The reference photo shows 33.33% beside "1 of 2", which cannot
     both be true; do not copy the mismatch. */
  const days = [...analytics.dailyPnl.values()];
  const traded = days.length;
  const won = days.filter((value) => value > 0).length;
  pct("gaugeDayWin", traded ? won / traded : 0);
  setText(document.getElementById("dayWinValue"), traded ? `${((won / traded) * 100).toFixed(2)}%` : "0%");
  setText(document.getElementById("dayWinSub"), traded ? `${won} of ${traded}` : "no trading days yet");

  /* The reference's headline is the RATIO, derived on computeTraderScore's
     first line (app.js:9386) and never returned. Mirrored, not exported. */
  const avgWin = analytics.avgWin || 0;
  const avgLoss = Math.abs(analytics.avgLoss || 0);
  setText(
    document.getElementById("avgWinLossRatio"),
    avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : avgWin > 0 ? "∞" : "0.00"
  );
  const split = document.getElementById("avgWinLossSplit");
  if (split) {
    // RAW magnitudes: flex-grow does the normalisation, so no ratio arithmetic
    // lives in CSS and none is duplicated here.
    split.style.setProperty("--w", String(avgWin));
    split.style.setProperty("--l", String(avgLoss));
  }
}
```

**Call site: `app.js:9811`**, immediately before the `if (ui.traderScoreValue)` block. `clamp` (16), `setText` (11975) and `normalizeToScore` (9420, a declaration) are all in scope.

### 7f. Edge score numeral and rail — rewrite `app.js:9811-9816`

```js
  if (ui.traderScoreValue) {
    // "81", not "81.0". A one-decimal composite implies a precision six
    // clamp()ed inputs (app.js:9395-9400) do not have.
    setCountUpValue(ui.traderScoreValue, String(Math.round(analytics.traderScore.score)), {
      value: analytics.traderScore.score,
      format: (value) => String(Math.round(value))
    });
  }
  const rail = document.getElementById("edgeScoreRail");
  if (rail) {
    rail.style.setProperty("--score", String(Math.round(analytics.traderScore.score)));
  }
```

(9804-9806, the `balanceOverrideNote` branch, and 9808-9810, the three unguarded discipline writes, are **above** this and stay untouched.)

### 7g. Radar axis label — `app.js:9398`

`{ label: "Recovery", value: normalizeToScore(recoveryFactor, 0, 4) }` → `{ label: "Recovery factor", … }`, to match the reference's axis names exactly. **Not line 9391** — that is `flatOrPositiveDays`, and editing it corrupts the consistency blend.

### 7h. Band A trade count — rewrite `app.js:10152-10156`

```js
  // en-GB, not en-US: en-US emits "Friday, August 14" and the reference reads
  // "Friday 14 August". Verified.
  const dateLine = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now);
  const onRecord = getClosedTrades().length;
  const next = getNextSessionOpen(now);
  // The session countdown is why this node exists and it is live, so it is
  // appended, not replaced. getNextSessionOpen returns null outside the window.
  ui.dashClock.textContent =
    `${dateLine} · ${onRecord} trade${onRecord === 1 ? "" : "s"} on record` +
    (next ? ` · ${next.name} open in ${formatCountdown(next.minutes)}` : "");
```

Delete the now-dead `const weekday` binding at 10152.

### 7i. Weekly totals — replace `app.js:12356` (`ui.miniCalGrid.innerHTML = tiles.join("");`)

```js
  /* WEEK TOTALS WITHOUT A WEEK ELEMENT. The grid is FLAT — seven columns of CSS
     auto-flow, no per-week container — so an 8th cell per row lands at the row
     end for free. Two traps. (1) The month TAIL is not padded: August ends on a
     Monday, so the last row holds one tile and a naive `i % 7 === 6` puts its
     total in the wrong column. Pad first. (2) Do NOT reuse getWeekKey
     (src/lib/core.js:119): it is ISO — Monday-start and UTC-shifted — while
     this grid is Sunday-start and local (startOffset = firstDay.getDay()), so
     it would mis-bucket every Sunday. Sum the chunk's own dayStats instead. */
  while (tiles.length % 7 !== 0) {
    tiles.push('<span class="mini-cal-day is-blank" aria-hidden="true"></span>');
  }
  const weeks = [];
  for (let start = 0; start < tiles.length; start += 7) {
    let sum = 0;
    for (let cell = start; cell < start + 7; cell += 1) {
      const dayNo = cell - startOffset + 1;
      const stats =
        dayNo >= 1 && dayNo <= daysInMonth
          ? dayStats.get(`${monthValue}-${String(dayNo).padStart(2, "0")}`)
          : null;
      if (stats) {
        sum = round(sum + stats.pnl);
      }
    }
    const tone = sum > 0 ? " pnl-positive" : sum < 0 ? " pnl-negative" : "";
    // A week with no trades prints nothing rather than a $0, which is the same
    // rule the day tiles follow.
    const label = sum === 0 ? "" : ` aria-label="Week total ${escapeHtml(formatSignedCurrency(sum))}"`;
    weeks.push(
      tiles.slice(start, start + 7).join("") +
        `<span class="mini-cal-week${tone}"${label}>${escapeHtml(sum === 0 ? "" : tileMoney(sum))}</span>`
    );
  }
  ui.miniCalGrid.innerHTML = weeks.join("");
```

`round` (15), `escapeHtml` (17), `formatSignedCurrency` (825) and `tileMoney` (12332) are all in scope. `startOffset` (12287), `daysInMonth` (12286), `monthValue` (12280) and `dayStats` (12284) likewise.

### 7j. What deliberately does not change

- **`app.js:2024-2028`** — the `#dashDepth` toggle listener stays. `#psychologyChart` and `#rMultipleChart` remain in the drawer with the same zero-`clientHeight`-while-closed problem, and that listener is their forced repaint. It was never the radar's render path: `paint(ui.traderScoreChart, …)` at `charts.js:583` runs unconditionally on every `renderCharts`.
- **`src/modules/charts.js`** — nothing. `drawRadarChart` (1497) and `getCanvasContext` (1674) are correct; the panel is sized to fit them, not the reverse.
- **`app.js:15262-15272`** — native fullscreen on `.bb-mon-full` stays exactly as it is. It already works on this tile, the browser owns Escape, and its own comment says the iframe is never re-created.
- **`app.js:12349`** — the tile template already emits `<span class="mc-n">N trades</span>`, and `clay-v3.css:3945` already shows it on this grid. The reference's trade count ships today.

---

## 8. tests/instrumentPanel.check.mjs — five assertions

| line | change |
|---|---|
| **106** | `for (const sel of ["\\.dash-edge-mini\\[hidden\\]"]) {` — drop `#dashPlaybook[hidden]`, with a note: *the playbook no longer holds a grid slot, so its absence cannot leave a hole; guard 4 above still pins its `[hidden]` companion.* |
| **129** | `assert.equal(tall, "36px 108px 20px minmax(0, 0.52fr) minmax(0, 0.48fr)", "tall-screen track set changed");` |
| **132** | `assert.equal(rowsOf(shortDecls), "32px 88px 18px minmax(0, 0.52fr) minmax(0, 0.48fr)", "short-screen track set changed");` |
| **133-134** | comment `// 1093 viewport - 32 padding-block - 48 row gaps = 1013 of track` and `assert.equal(36 + 108 + 20 + Math.round(0.52 * 849) + Math.round(0.48 * 849), 1013, "tall budget does not close");` |
| **135-136** | comment `// 843 viewport - 32 - 48 = 763` and `assert.equal(32 + 88 + 18 + 0.52 * 625 + 0.48 * 625, 763, "short budget does not close");` (both fr terms are integers at 625: 325 and 300 exactly) |
| **188** | `assert.equal(figures, 6, …)` — and the closing `console.log` interpolates the same `figures`, so it needs no edit. |

**Two new assertions. Append after guard 6 (line 117):**

```js
// ── 6b. The popped-out TV keeps a rendered ancestor ──────────────────────────
// styles.css:9746 display:none's .dem-panel when the rail collapses, and
// .dem-panel is the iframe's PARENT. Guard 6 above scans clay-v3 ONLY, so this
// blind spot is load bearing: without the escape below, `hide` kills a playing
// stream. Do NOT widen guard 6 to styles.css instead — it is a NEGATED regex
// and would match the very rule it is escaping, which nobody proposes to remove.
assert.ok(
  /\.dash-edge-mini\.is-min\.is-tv-out\s+\.dem-panel\s*\{[^}]*display:\s*block/.test(decls(styles)),
  "a popped-out TV must survive `hide` — .dem-panel is the iframe's parent and is-min closes it"
);
assert.ok(
  /\.dash-edge-mini\.is-tv-out\s+\.dem-tv\s*\{[^}]*position:\s*fixed/.test(decls(clay)),
  "the popout must be position:fixed on #dashEdgeMiniTv itself — a DOM move reloads the stream"
);
// ── 6c. The empty state stops closing the rail ───────────────────────────────
// The cull is (3,3,0): :has(#dashboardEmptyState…) and :not(#dashboardEmptyState)
// each contribute an ID. Measured — `> .dash-edge-mini` at (2,3,0) loses and the
// rail renders 0x0. The escape must be written with the ID and :not([hidden]).
assert.ok(
  /> #dashEdgeMini:not\(\[hidden\]\)\s*\{\s*display:\s*grid/.test(decls(clay)),
  "the empty state must not display:none the rail — the ID form is what out-specifies the cull"
);
```

**Guard 6 itself is unchanged and stays green**, because nothing that ships puts `.dash-edge-mini` in a `display:none` block in clay-v3.css. I ran its exact regex against every candidate string:

| string | file | guard 6 |
|---|---|---|
| `.dash-edge-mini.is-min.is-tv-out .dem-panel > *:not(.dem-tv) { display: none; }` | **styles.css** | not scanned ✓ |
| `…:not(.dash-edge-mini)… { display: none; }` | clay-v3 | **matches — never written** |
| `… > #dashEdgeMini:not([hidden]) { display: grid; }` | clay-v3 | no match ✓ |

Full suite: `npm test` (47 files) is green today and must stay green. Watch three in particular — `mobileFloors.check.mjs` (scans clay-v3; every new **base** rule here is ≥11px, and the 9px `.mc-n` stays inside `@media (min-width:1240px)` where it already is), `cssSanity.check.mjs` (balanced braces and parens — the `:has(…:not([hidden]))` selector parses), and `copyDashes.check.mjs` (no new prose dash; the `"—"` in the ledger's asset fallback is a standalone glyph with quotes on both sides, which the scanner does not match — verified).

---

## 9. VERIFY — paste into the console at 1999x1150

One assertion per reference element, one per TV state. Every expected value below was **read off the live page** with the change applied, not computed.

```js
(() => {
  const P = [], F = [];
  const ok = (name, cond, got) => (cond ? P : F).push(`${name}${cond ? "" : ` — got ${JSON.stringify(got)}`}`);
  const $ = (s) => document.querySelector(s);
  const box = (s) => { const e = $(s); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const d = document.getElementById("dashboard");

  // ── THE PROMISE ────────────────────────────────────────────────────────────
  ok("no scroll", d.scrollHeight === d.clientHeight && d.clientHeight === 1093, [d.scrollHeight, d.clientHeight]);
  ok("no page scroll", document.documentElement.scrollHeight === 1150, document.documentElement.scrollHeight);
  ok("five bands", getComputedStyle(d).gridTemplateRows === "36px 108px 20px 441.477px 407.516px",
     getComputedStyle(d).gridTemplateRows);
  ok("12 col pitch 148.25", getComputedStyle(d).gridTemplateColumns.startsWith("148.25px"),
     getComputedStyle(d).gridTemplateColumns.split(" ")[0]);

  // ── BAND A ─────────────────────────────────────────────────────────────────
  ok("A: head is row 1, 36px", box("#dashboard > .dash-head").h === 36, box("#dashboard > .dash-head"));
  ok("A: clock carries the date and the count",
     /^\w+day \d+ \w+ · \d+ trades? on record/.test($("#dashClock").textContent), $("#dashClock").textContent);
  ok("A: range pill still there", !!$("#dashboard .dash-range [data-balance-range='all']"));

  // ── BAND B: one surface, five cells, four marks ────────────────────────────
  ok("B: hero spans the row at 108", box(".dash-hero").w === 1911 && box(".dash-hero").h === 108, box(".dash-hero"));
  ok("B: exactly five cells", document.querySelectorAll(".dash-hero > .strip-cell").length === 5,
     document.querySelectorAll(".dash-hero > .strip-cell").length);
  ok("B: cells fit the 84px content box (76)",
     [...document.querySelectorAll(".strip-cell")].every((c) => c.getBoundingClientRect().height <= 84),
     [...document.querySelectorAll(".strip-cell")].map((c) => +c.getBoundingClientRect().height.toFixed(1)));
  ok("B: dividers are borders, not gaps",
     getComputedStyle($(".dash-hero")).columnGap === "0px" &&
     getComputedStyle(document.querySelectorAll(".strip-cell")[1]).borderLeftWidth === "1px");
  ok("B1: net P&L, no gauge", !!$('.strip-cell [data-metric="totalPnl"]') &&
     !document.querySelectorAll(".strip-cell")[0].querySelector(".gauge"));
  ok("B1: balance clause stays 13px",
     getComputedStyle($('.dash-hero-equity [data-metric="accountBalance"]')).fontSize === "13px",
     getComputedStyle($('.dash-hero-equity [data-metric="accountBalance"]')).fontSize);
  ok("B2: win % + arc, SIBLINGS not nested",
     $("#gaugeWinRate")?.previousElementSibling?.dataset.metric === "winRate");
  ok("B3: profit factor + ring", !!$('.strip-cell [data-metric="profitFactor"]') && !!$("#gaugeProfitFactor"));
  ok("B4: day win + needle dial", $("#gaugeDayWin")?.classList.contains("is-dial"));
  ok("B4: percent and sublabel reconcile", (() => {
      const m = /^(\d+(?:\.\d+)?)%$/.exec($("#dayWinValue").textContent);
      const n = /^(\d+) of (\d+)$/.exec($("#dayWinSub").textContent);
      if (!m) return $("#dayWinValue").textContent === "0%";
      return n && Math.abs(Number(m[1]) - (Number(n[1]) / Number(n[2])) * 100) < 0.01;
    })(), [$("#dayWinValue").textContent, $("#dayWinSub").textContent]);
  ok("B5: ratio + split bar + money caption",
     /^\d+\.\d\d$|^∞$/.test($("#avgWinLossRatio").textContent) &&
     $("#avgWinLossSplit").children.length === 2 &&
     !!$('.strip-cell [data-metric="avgWinLoss"]'), $("#avgWinLossRatio").textContent);
  ok("B: every gauge got a --pct",
     [...document.querySelectorAll(".gauge")].every((g) => g.style.getPropertyValue("--pct") !== ""),
     [...document.querySelectorAll(".gauge")].map((g) => g.style.getPropertyValue("--pct")));
  ok("B: gauges are conic, not canvas and not svg",
     document.querySelectorAll(".dash-hero canvas:not(#dashSparkline), .dash-hero svg").length === 0 &&
     getComputedStyle($("#gaugeWinRate")).backgroundImage.includes("conic-gradient"));

  // ── BAND C: run facts, no surface ──────────────────────────────────────────
  ok("C: one 20px line, no surface", box(".dash-now").h === 20 &&
     getComputedStyle($(".dash-now")).borderTopWidth === "0px" &&
     getComputedStyle($(".dash-now")).backgroundColor === "rgba(0, 0, 0, 0)", box(".dash-now"));
  ok("C: nothing clips", $(".dash-now").scrollWidth === $(".dash-now").clientWidth,
     [$(".dash-now").scrollWidth, $(".dash-now").clientWidth]);
  ok("C: six live facts", $(".dash-now").children.length === 6, $(".dash-now").children.length);
  ok("C: is a grid item of #dashboard, not of the hero", $(".dash-now").closest(".dash-hero") === null);

  // ── BAND D: edge score / cumulative / spine / rail ─────────────────────────
  ok("D: edge score out of the drawer", $("#dashEdgeScore")?.closest("#dashDepth") === null);
  ok("D: edge score is cols 1-3", box("#dashEdgeScore").w === 468.8 && box("#dashEdgeScore").x === 72, box("#dashEdgeScore"));
  ok("D: radar has six axes", state.analytics.traderScore.metrics.length === 6,
     state.analytics.traderScore.metrics.map((m) => m.label));
  ok("D: radar clears its 46px floor", (() => {
      const c = $("#traderScoreChart");
      return Math.max(Math.min((c.clientWidth - 150) / 2, (c.clientHeight - 90) / 2), 46) > 100;
    })(), (() => { const c = $("#traderScoreChart");
      return Math.max(Math.min((c.clientWidth - 150) / 2, (c.clientHeight - 90) / 2), 46); })());
  ok("D: score numeral has no decimal", /^\d{1,3}$/.test($("#traderScoreValue").textContent), $("#traderScoreValue").textContent);
  ok("D: gradient rail carries the score",
     $("#edgeScoreRail").style.getPropertyValue("--score") === String(Math.round(state.analytics.traderScore.score)) &&
     getComputedStyle($("#edgeScoreRail")).backgroundImage.includes("linear-gradient"));
  ok("D: cumulative curve is cols 4-7", box(".panel-span-8").w === 629 && box(".panel-span-8").x === 553, box(".panel-span-8"));
  ok("D: day-bar spine is cols 8-10", box(".panel-span-4").w === 468.8 && box(".panel-span-4").x === 1194, box(".panel-span-4"));
  ok("D: spine has bars off a centreline", $("#dashDayBars").children.length > 0 &&
     [...$("#dashDayBars").children].every((b) => b.style.getPropertyValue("--mag") !== ""));
  ok("D: rail spans bands D and E", box("#dashEdgeMini").w === 308.5 && box("#dashEdgeMini").h === 861, box("#dashEdgeMini"));

  // ── BAND E: ledger + calendar ──────────────────────────────────────────────
  ok("E: ledger is cols 1-4", box("#dashLedger").w === 629 && box("#dashLedger").y === 726, box("#dashLedger"));
  ok("E: table did NOT inherit min-width 980", box(".dash-ledger").w <= 597, box(".dash-ledger"));
  ok("E: three columns, six rows", $(".dash-ledger thead tr").children.length === 3 &&
     $("#dashLedgerBody").children.length <= 6, [$(".dash-ledger thead tr").children.length, $("#dashLedgerBody").children.length]);
  ok("E: no cell chrome", (() => { const td = $(".dash-ledger td");
      const cs = getComputedStyle(td); return cs.borderBottomWidth === "0px" && cs.backgroundColor === "rgba(0, 0, 0, 0)"; })());
  ok("E: header is not sticky-uppercase", (() => { const cs = getComputedStyle($(".dash-ledger th"));
      return cs.position === "static" && cs.textTransform === "none"; })());
  ok("E: red and green figures only on P&L",
     [...document.querySelectorAll(".dash-ledger td:last-child")].every((t) => /is-(pos|neg)/.test(t.className)));
  ok("E: calendar is cols 5-10", box("#dashMiniCal").w === 949.5 && box("#dashMiniCal").x === 713, box("#dashMiniCal"));
  ok("E: eight columns, weekdays in lockstep", (() => {
      const g = getComputedStyle(document.getElementById("miniCalGrid")).gridTemplateColumns.split(" ").length;
      const w = getComputedStyle($(".mini-cal-weekdays")).gridTemplateColumns.split(" ").length;
      return g === 8 && w === 8; })());
  ok("E: one week total per row, at the row end",
     document.querySelectorAll("#miniCalGrid .mini-cal-week").length ===
       document.querySelectorAll("#miniCalGrid > *").length / 8,
     document.querySelectorAll("#miniCalGrid .mini-cal-week").length);
  ok("E: week totals are inert", [...document.querySelectorAll(".mini-cal-week")].every((w) => !w.closest("[data-date]")));
  ok("E: day cells carry money AND a count", (() => { const t = $(".mini-cal-day.is-trade");
      return !t || (t.querySelector(".mc-amt") && getComputedStyle(t.querySelector(".mc-n")).display !== "none"); })());
  ok("E: tiles above 44px", (() => { const r = getComputedStyle(document.getElementById("miniCalGrid")).gridTemplateRows.split(" ");
      return r.every((v) => parseFloat(v) >= 44); })(),
     getComputedStyle(document.getElementById("miniCalGrid")).gridTemplateRows);

  // ── THE LANGUAGE ───────────────────────────────────────────────────────────
  ok("labels are sentence case, not tracked",
     [...document.querySelectorAll("#dashboard .panel-grid-analytics .panel-head h3, #dashboard .strip-cell .metric-label")]
       .every((n) => { const cs = getComputedStyle(n); return cs.textTransform === "none" && cs.letterSpacing === "normal"; }));
  ok("four type steps, nothing else", (() => {
      const sizes = new Set([...document.querySelectorAll("#dashboard .strip-cell *, #dashboard .dash-now *, .dash-ledger td, .dash-ledger th")]
        .filter((n) => n.getBoundingClientRect().height)
        .map((n) => getComputedStyle(n).fontSize));
      return [...sizes].every((s) => ["28px", "20px", "13px", "11px", "12px"].includes(s)); })(),
     [...new Set([...document.querySelectorAll("#dashboard .strip-cell *")].map((n) => getComputedStyle(n).fontSize))]);
  ok("no nested chrome inside a panel",
     [...document.querySelectorAll("#dashEdgeScore *, #dashLedger *")]
       .every((n) => getComputedStyle(n).boxShadow === "none" || n.tagName === "CANVAS"));

  // ── THE TV: one state per size, iframe identity across all of them ─────────
  const host = document.getElementById("dashEdgeMini");
  const tile = $("#dashEdgeMiniTv .bb-mon");
  if (!tile.querySelector("iframe")) tile.querySelector(".bb-mon-screen")?.click();
  const ref = $("#dashEdgeMiniTv iframe");
  ok("TV: a stream is playing", !!ref);
  if (ref) ref.dataset.probe = "alive";
  const tv = () => { const b = $("#dashEdgeMiniTv").getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
             same: $("#dashEdgeMiniTv iframe") === ref, probe: $("#dashEdgeMiniTv iframe")?.dataset.probe,
             sh: d.scrollHeight }; };

  const docked = tv();
  ok("TV dock: 307x168 in the rail", docked.w === 307 && docked.h === 168, docked);
  host.classList.add("is-tv-out");
  const wide = tv();
  ok("TV out: 920x517 bottom-right", wide.w === 920 && wide.h === 517 && wide.x === 1059 && wide.y === 613, wide);
  ok("TV out: left 1059px of board stays clear", wide.x > box("#dashMiniCal").x + box("#dashMiniCal").w - 240, wide.x);
  ok("TV out: same iframe, still alive", wide.same && wide.probe === "alive", wide);
  ok("TV out: still no scroll", wide.sh === 1093, wide.sh);
  host.classList.add("is-min");
  const collapsed = tv();
  ok("TV out + rail collapsed: survives .dem-panel display:none",
     collapsed.w === 920 && collapsed.same && collapsed.probe === "alive", collapsed);
  ok("TV out + collapsed: the rest of the panel is gone",
     getComputedStyle($("#dashEdgeMiniPanel")).display === "block" &&
     getComputedStyle($(".dem-news")).display === "none");
  host.classList.remove("is-min", "is-tv-out");
  const back = tv();
  ok("TV dock again: same iframe, back in the rail",
     back.w === 307 && back.h === 168 && back.same && back.probe === "alive", back);
  ok("TV: the tile never moved in the DOM",
     $("#dashEdgeMiniTv").parentElement.id === "dashEdgeMiniPanel" &&
     $("#dashEdgeMiniTv iframe")?.closest("#dashEdgeMiniTv") !== null);
  ok("TV: no containing block on the ancestor chain", (() => {
      let el = $("#dashEdgeMiniTv").parentElement;
      while (el && el !== document.documentElement) {
        const cs = getComputedStyle(el);
        for (const p of ["transform", "filter", "backdropFilter", "perspective", "contain", "willChange", "translate", "rotate", "scale"])
          if (cs[p] && !["none", "auto", "normal"].includes(cs[p])) return false;
        el = el.parentElement;
      }
      return true; })());
  ok("TV: the control is discoverable and honest",
     $("#dashEdgeMiniOut").getAttribute("aria-pressed") === "false" &&
     $(".dem-tv-out-label").textContent === "watch");
  ok("TV: native fullscreen is untouched", !!$("#dashEdgeMiniTv .bb-mon-full"));

  // ── THE EMPTY STATE MUST NOT CLOSE THE RAIL ────────────────────────────────
  const es = document.getElementById("dashboardEmptyState");
  const wasHidden = es.hidden;
  es.hidden = false;
  ok("empty state: rail (and its iframe) survives", box("#dashEdgeMini").w === 309, box("#dashEdgeMini"));
  ok("empty state: no overlap with the panel", (() => {
      const a = es.getBoundingClientRect(), b = document.getElementById("dashEdgeMini").getBoundingClientRect();
      return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top; })());
  es.hidden = wasHidden;

  console.log(`PASS ${P.length}   FAIL ${F.length}`);
  if (F.length) console.error(F.join("\n"));
  return { pass: P.length, fail: F.length, failures: F };
})();
```

**Then repeat at 1440x900**, where only four numbers change and one is the one to watch:

| assertion | expected at 1440x900 |
|---|---|
| no scroll | `843 / 843` |
| rows | `32px 88px 18px 325px 300px` |
| strip cells | `63` (≤68) |
| **radar radius** | **56.5** — this is the tightest number in the design. Anything that grows `.trader-score-foot` (a second caption line, the `var(--space-4)` margin coming back, a taller numeral) pushes `#traderScoreChart.clientHeight` under **182** and reproduces the 92px-circle regression documented at `src/modules/charts.js:1515-1518`. Measure it before calling this done. |
| calendar rows | `33.33px`, `.mc-n` display `none` |
| TV out | `662 x 373` |

And **at 375x812**: calendar back to 7 columns, `.mini-cal-week` display `none`, 7 visible weekday headers, tiles 44px, TV out `359 x 202` at `(8, 56)` — clear of `#sidebar` (bottom 52), `#tabBar` (top 736) and `#tabBarNewTradeBtn` (top 700).

---

## 10. Known ceilings, stated rather than papered over

1. **Navigating off the dashboard kills the popout and the stream.** `.view { display: none }` (`styles.css:2644`), toggled by `switchView`. Dashboard-scoped by construction; a stream that survives navigation needs `#dashboard` to stop being `display: none`, which is a shell-wide layout change, not a TV change. The `// ponytail:` comment ships beside the CSS.
2. **The profit-factor ring is capped at PF 3.** Above 3 the difference between 3 and 52 is sample size, not edge, and the numeral still prints `∞` at the 999 sentinel (`app.js:8536`). If the owner rejects a capped ring, the substitute is a split bar of gross profit against gross loss — both are locals in `calculateAnalytics` and never returned, but recoverable with no analytics change as `avgWin * wins` and `avgLoss * losses`, all four of which **are** returned (`app.js:8589`, `8590`, `8585`, `8586`).
3. **Two delta chips die** with the moved `winRate` and `profitFactor` cards. The reference has no delta chrome and those cells carry gauges instead. If they are missed, they come back as a `.strip-sub` line, not as a chip on a card.
4. **Calendar tiles at 1440x900 go from 36.5px to 33.3px.** The trade count is dropped at that height to keep the money legible. The 44px floor is a *phone touch* floor (`clay-v3.css:3379`, enforced below 899 only) and is unaffected — verified at 375: 44px.
5. **Below 1240 every analytics panel is full width.** Deliberate: the grid is 12 columns at 1200 and 2 at 1100, and pinning is the only rule that is right at both. The page already scrolls there.

---

### Corrections applied silently to the brief's citations

`clay-v3.css`: rail rule **3923-3928** (not 3872) · empty-state cull **4003-4006** (not 3999) · grid-areas **3903-3905 / 3914-3916 / 3946-3947** (not 3912-3913) · `:has()` reflow **3953-3956**, comment 3949-3952 kept · SHORT SCREENS **4016-4033** (not 4014) · `--mag` **3326** (not 3263) · phone bleed **3375** inside `@media (max-width: 899px)`, so the column drop is at **899** not 640 · `#dashDepth` cull **4011** (not 3951) · grid rows **3652** · `.dash-hero` **3865** · `.eq-footnotes` **3755** · promotion list **3639-3641** · `#dashboard` overflow **3658** · pitch comment **3834** · flex:1 list **3731**.
`index.html`: hero article **1503-1550** (not 1502-1547) · footnote cards **1796-1800 / 1801-1805 / 1811-1814** (not 1798/1803/1812) · trader-score article **1996-2012** (not 1988-2003) · `.dem-cmd` insert before **1468** (not 1474) · month-card mark **1571** · accounts contract **1854** · `.mini-cal` **1552**.
`app.js`: `calculateAnalytics` **8404** (there is no `computeAnalytics`) · `computeTraderScore` **9385**, `avgWinLossRatio` **9386**, day counts **9389-9390**, PF axis **9396**, Recovery label **9398** · `normalizeToScore` **9420** · `setCountUpValue` **9545** · `renderMetricDeltas` **9623** · `renderDepthCaptions` **9673** · traderScoreValue block **9811-9816** (not 9803-9808) · `renderDashMiniCal` **12271** · `handleCalendarDayClick` **12598** · `getClosedTrades` **8354** · fullscreen branch **15262-15272** (not 15243 or 15258) · Escape **15289-15297** · `monitorTile` **16424**, its `.bb-mon-full` **16460** · `WALL_SIZE_KEY` replay **16475** (not 16314) · `applyWallSize` **16760** · `getWallChoice` **16808** · `dashDepth` toggle **2024** · account hide **12009** · zero rule **8672 / 11021**.
`src/modules/charts.js`: radius **1519**, regression comment **1515-1518**, `getPalette` **80-101** (and its `themechange` listener already nulls the cache, so no new plumbing).
Specificity: the popout rule is **(1,4,0)**, the is-min escape **(0,4,0)** vs `styles.css:9746` **(0,3,0)**, and the empty-state cull is **(3,3,0)** — all three of the brief's counts were wrong, and the third one was load-bearing.