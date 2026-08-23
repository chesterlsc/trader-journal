# BUILD SPEC — Trader Journal dashboard to reference

**Verdict on the existing grid: KEEP AND AMEND.** The `@media (min-width: 1240px)` block in `clay-v3.css:3552` already does the hard part — `display:contents` on `.dash-stats`, `.dash-month-card`, `.dash-boards` promotes every card to a direct grid item with zero DOM movement, and it already carries the `min-height:0` floors, the nested-grid floors, the `height:100%` binders and the `overflow:hidden` contract. This spec re-tracks it from 4 rows to 6 and re-places nine items. Nothing is rebuilt. Three static HTML moves, ~200 lines of JS, no new file, no dependency.

Ground truth verified in the repo before writing: `app.js` and `clay-v3.css` are at **repo root**, not `src/`. Line numbers below are real.

---

## 1. THE GRID

### 1.1 Measure before you commit

`--chrome-h` is published at runtime by `syncChromeHeight` (`app.js:16551`). It is the **bottom edge of whichever top bar is rendered**, and `app.js:16606` sets it explicitly to `0px` when only the left rail is on screen. `86px` is only the locked-session stylesheet fallback. `--rail-w` is `56px`, but `body.rail-pinned` makes it `84px` (`clay-v3.css:731`).

So the row budget is parametric, not a constant:

```
G  (grid content height) = viewportH - --chrome-h - 32          /* padding-block 16 x2 */
Wc (grid content width)  = (viewportW - --rail-w) - 2 * padding-inline
```

Read both with `getComputedStyle(document.documentElement).getPropertyValue("--chrome-h")` before you trust any number below. The `fr` rows absorb whatever it is; **the 190px of fixed rows do not**, which is why the breakpoint gets a height gate (§1.4).

### 1.2 The track set

Replaces the `grid-template-rows` line at `clay-v3.css:3564` and the ROW 1–4 placement rules at `3620–3665`.

```css
@media (min-width: 1240px) and (min-height: 760px) {
  #dashboard.is-active {
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-template-rows:
      44px                 /* A identity        */
      32px                 /* B controls        */
      84px                 /* C metric strip    */
      30px                 /* D streak line     */
      minmax(0, 0.452fr)   /* E chart row       */
      minmax(0, 0.548fr);  /* F table + calendar*/
    gap: 12px;
    padding-block: 16px;
    overflow: hidden;
    align-content: stretch;
  }

  #dashboard.is-active > .dash-head          { grid-area: 1 / 1 / 2 / -1; align-items: center; }
  #dashboard.is-active .dash-bar             { grid-area: 2 / 1 / 3 / -1;
                                               display: flex; align-items: center; gap: 10px; }
  #dashboard.is-active .dash-quad            { grid-area: 3 / 1 / 4 / -1;
                                               grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
  #dashboard.is-active .dash-plan            { grid-area: 4 / 1 / 5 / -1;
                                               display: flex; align-items: center;
                                               justify-content: space-between; gap: 12px; }
  #dashboard.is-active .panel-grid-analytics { grid-area: 5 / 1 / 6 / -1;
                                               display: grid;
                                               grid-template-columns: 1fr 1.4fr 1.4fr; gap: 12px; }
  #dashboard.is-active #dashRecent           { grid-area: 6 / 1 / 7 / 6; }
  #dashboard.is-active #dashMiniCal          { grid-area: 6 / 6 / 7 / -1; }

  /* The scrub readout costs zero layout height. Both halves must ship. */
  #dashboard.is-active .panel-grid-analytics > .panel { position: relative; }
  #dashboard.is-active #equityScrub { position: absolute; inset: auto 12px 12px auto; max-width: 240px; }
  #dashboard.is-active .eq-scrub-hint { display: none; }

  /* Panel heads lose their subtitle line on this grid: 30px -> 18px, and the
     12px is what puts the radar above its floor at 900px viewport height. */
  #dashboard.is-active .panel-grid-analytics .panel-head p { display: none; }

  /* Off grid, still rendered into. */
  #dashboard.is-active .dash-hero,
  #dashboard.is-active .dash-board-slot,
  #dashboard.is-active #dashPlaybook,
  #dashboard.is-active #propTracker,
  #dashboard.is-active #drawdownChart,
  #dashboard.is-active #traderScoreCaption { display: none; }

  /* The TV docks. NEVER display:none — that would put an ancestor of the
     iframe into display:none and kill the stream. */
  #dashboard.is-active .dash-edge-mini {
    position: fixed; right: 16px; bottom: 8px; width: 300px;
    z-index: 24; margin: 0; height: auto;
  }
}
```

**Specificity notes, both load bearing.** `#dashboard.is-active .dash-quad` is (1,2,0) and beats `#dashboard .dash-quad { grid-template-columns: repeat(6, …) }` at `clay-v3.css:3309`. The existing `#dashboard.is-active .dash-quad { grid-area: 2 / 4 / 3 / -1 }` at `3626` must be **rewritten in place**, not added beside. Leave `#dashboard.is-active .dash-stats[hidden] { display:none }` at `3560` exactly as it is — the file's own comment already flags it.

**Delete**, do not amend: `#dashboard.is-active:has(#propTracker:not([hidden])) .dash-board-slot { display: none }` at `3647`, and `.dash-board-slot`'s grid placement. Both panels are off grid now; two rules fighting over an invisible box is a 3am bug.

### 1.3 Arithmetic

Fixed rows 44+32+84+30 = **190**. Five gaps at 12 = **60**. Reserved **250**.

| viewport | `--chrome-h` | G | free (G−250) | row E | row F |
|---|---|---|---|---|---|
| 1999×1100 | 57 | 1011 | 761 | **344.0** | **417.0** |
| 1999×1100 | 0 | 1068 | 818 | 369.7 | 448.3 |
| 1440×900 | 57 | 811 | 561 | **253.6** | **307.4** |
| 1440×900 | 0 | 868 | 618 | 279.3 | 338.7 |

Every row closes at exactly G. `overflow:hidden` states the promise in CSS.

Widths at 1999 (`--rail-w` 56, measured padding-inline 259.5): content **1424**, column `(1424−132)/12 = 107.667`.
Widths at 1440 (padding-inline 28.797): content **1326.4**, column `99.533`.

- Row E: `(1424−24)/3.8` = **368.42 | 515.79 | 515.79** — the reference's 1 : 1.4 : 1.4 exactly. At 1440: 342.7 | 479.8 | 479.8.
- Row F: 5 cols = `5(107.667)+48` = **586.33**; 7 cols = `7(107.667)+72` = **825.67**; `586.33+12+825.67 = 1424.00`. At 1440: 545.66 | 768.72.
- Row C tiles: `(1424−32)/5` = **278.4**. At 1440: **258.88**.

### 1.4 The 900–1000px band

The `min-height: 760px` gate stops the clip. A compact row set keeps the band **usable** instead of dumping it to the flowing layout:

```css
@media (min-width: 1240px) and (min-height: 760px) and (max-height: 960px) {
  #dashboard.is-active { grid-template-rows: 40px 28px 76px 26px minmax(0,.452fr) minmax(0,.548fr); }
  #dashboard.is-active .dash-quad-card .metric-value { font-size: 19px; }
}
```
Reserved becomes 230; at G=811 row E = 262.6, row F = 318.4.

Below 1240 **nothing above applies**. `.dash-bar`, `.dash-plan`, `#dashRecent` flow as ordinary blocks; every control gets `min-height: 44px`; `.mq-gauge` and `.mc-n` get `display: none` (phone floors met, §3.6).

### 1.5 Internal budgets

| box | height | breakdown |
|---|---|---|
| Row C tile | 84 | pad 10×2 → 64; label 11 + gap 4 + `.mq-fig` 32 + gap 3 + sub 11 = **61** |
| Row E panel 1 (Edge) | 344 / 253.6 | pad 28 + head 18 + foot 47 → canvas **251 / 160.6** |
| Row E panel 2 (equity) | 344 / 253.6 | pad 28 + head 18 + footnotes 36 (2 lines, 6 figures) → canvas **262 / 171.6** |
| Row E panel 3 (bars) | 344 / 253.6 | pad 28 + head 18 → canvas **298 / 207.6** |
| Row F calendar | 417 / 307.4 | pad 22 + head 20 + weekdays 11 + foot 15 + 3 gaps 15 → grid 334 / 224; minus 5 row gaps → 314 / 204; six rows at **52.3 / 34.0**, width 117.9 |
| Row F recent | 417 / 307.4 | pad 28 + head 26 + thead 20 + footer 24 → rows 319 / 209 at 34px = **9 / 6 rows** |

Recent trades renders 10 rows and scrolls the overflow. Add `.dash-recent-scroll` to the rule that **already exists** at `clay-v3.css:3672` (`.dash-playbook-grid, #riskViolations, .dem-panel`) — one selector on an existing rule, not a new one.

---

## 2. THE METRIC STRIP

Five tiles replacing six in `.dash-quad` (`index.html:1493`). Tile 1 is new markup, tiles 2/3/5 are existing cards edited in place, tile 4 is new markup, tiles for Expectancy / Best Day / Worst Day are deleted from this section and rehomed (§6).

```html
<section class="dash-quad" aria-label="Edge quality">

  <article class="metric-card dash-quad-card dash-reveal" data-tilt style="--i: 2">
    <p class="metric-label">Net P&amp;L</p>
    <div class="mq-fig"><p class="metric-value" data-metric="totalPnl">$0.00</p></div>
  </article>

  <article class="metric-card dash-quad-card dash-reveal" data-tilt style="--i: 3">
    <p class="metric-label">Trade win %</p>
    <div class="mq-fig">
      <p class="metric-value" data-metric="winRate">0.0%</p>
      <span class="mq-gauge" data-gauge="winRate" aria-hidden="true"></span>
    </div>
  </article>

  <article class="metric-card dash-quad-card dash-reveal" data-tilt style="--i: 4">
    <p class="metric-label">Profit factor</p>
    <div class="mq-fig">
      <p class="metric-value" data-metric="profitFactor">0.00</p>
      <span class="mq-gauge" data-gauge="profitFactor" aria-hidden="true"></span>
    </div>
    <span class="metric-delta" data-metric-delta="profitFactor" hidden></span>
  </article>

  <article class="metric-card dash-quad-card dash-reveal" data-tilt style="--i: 5">
    <p class="metric-label">Day win %</p>
    <div class="mq-fig">
      <p class="metric-value" data-metric="dayWinRate">0.0%</p>
      <span class="mq-gauge" data-gauge="dayWinRate" aria-hidden="true"></span>
    </div>
  </article>

  <article class="metric-card dash-quad-card dash-reveal" data-tilt style="--i: 6">
    <p class="metric-label">Avg win/loss trade</p>
    <div class="mq-fig">
      <p class="metric-value" data-metric="avgWinLoss">0.00</p>
      <span class="mq-gauge" data-gauge="avgWinLoss" aria-hidden="true"></span>
    </div>
    <span class="metric-sub" data-metric-sub="avgWinLoss"></span>
  </article>
</section>
```

```css
#dashboard .mq-fig { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
#dashboard .dash-quad-card { padding: 10px; }
#dashboard .dash-quad-card [data-metric="avgWinLoss"] { font-size: 22px; white-space: nowrap; }
#dashboard .metric-sub[data-metric-sub="avgWinLoss"] { font: 600 11px/1 var(--font-mono); display: flex; gap: 8px; }
```

Delete the now-wrong `#dashboard .dash-quad-card [data-metric="avgWinLoss"] { font-size: 17px }` at `clay-v3.css:3313` — the tile prints a ratio now, not a phrase.

### 2.1 `renderDashboardMetrics` changes (`app.js:9652`)

1. **Delete** the `avgWinLossNode` block at `9656–9668`. Its money string moves to the sub line.
2. `values` gains three keys:
```js
totalPnl: formatCurrency(analytics.totalPnl),
dayWinRate: `${dayWinPct(analytics).toFixed(1)}%`,
avgWinLoss: avgWinLossRatio(analytics).toFixed(2),
```
3. `tweens` gains `totalPnl` (`format: formatCurrency`), `dayWinRate`, `avgWinLoss`.
4. `toneValues` gains `totalPnl: analytics.totalPnl` — the reference's Net P&L is coloured, and the existing loop already applies `toneBySign` plus the card hairline.
5. Sub line, beside the existing `subs` block at `9748`:
```js
const sub = document.querySelector('[data-metric-sub="avgWinLoss"]');
if (sub) {
  const w = analytics.avgWin || 0, l = Math.abs(analytics.avgLoss || 0);
  sub.innerHTML = l === 0 && w > 0 ? `<b class="pnl-positive">${formatStatMoney(w)}</b> · no losses`
    : w === 0 && l > 0 ? `no wins · <b class="pnl-negative">-${formatStatMoney(l)}</b>`
    : `<b class="pnl-positive">${formatStatMoney(w)}</b> <b class="pnl-negative">-${formatStatMoney(l)}</b>`;
}
```
6. Last line of the function: `renderMetricGauges(analytics);`

Two helpers, **function declarations**:
```js
function avgWinLossRatio(a) {
  const l = Math.abs(a.avgLoss || 0);
  return l > 0 ? (a.avgWin || 0) / l : (a.avgWin || 0) > 0 ? 2.5 : 0;
}
function dayOutcomeCounts(dailyPnl) {
  let up = 0, flat = 0, down = 0;
  dailyPnl.forEach((v) => { if (v > 0) up += 1; else if (v < 0) down += 1; else flat += 1; });
  return { up, flat, down, days: up + flat + down };
}
function dayWinPct(a) {
  const c = dayOutcomeCounts(a.dailyPnl);
  return c.days ? (c.up / c.days) * 100 : 0;
}
```
`analytics.totalPnl`, `analytics.avgWin`, `analytics.avgLoss`, `analytics.wins`, `analytics.losses`, `analytics.dailyPnl` are all already on the return object (`app.js:8545–8560`). **`calculateAnalytics` is not touched for the strip.**

---

## 3. THE GAUGES

All four are **inline SVG strings**, not canvas. Three reasons, in order: `setCountUpValue` tweens `textContent` on the `[data-metric]` node so a gauge cannot live inside it; inline SVG resolves `var(--pnl-pos)` at paint time so the light/dark toggle is free where canvas needs `getPalette()` plus a `themechange` repaint; and no `clientWidth` dependency means a resized tile needs no repaint pass. The one genuinely new **chart** (§4.3) is canvas, because it has axes and belongs to the existing engine.

### 3.0 The renderer

`renderMetricGauges(analytics)` in `app.js`, a function declaration, called on the last line of `renderDashboardMetrics`. One module-level constant, and it goes **beside `WALL_SIZE_KEY` at `app.js:1222`**, above `init()`:

```js
const GAUGE_ARC = "M 8 26 A 20 20 0 0 1 48 26";   // r 20, centre (28,26), length 62.832
```

Repaint path: `renderDashboardMetrics` runs on every render **including the 5s live poll**, so every write is guarded:

```js
function writeGauge(key, markup) {
  const el = document.querySelector(`[data-gauge="${key}"]`);
  if (!el || el.dataset.v === markup) return;
  el.dataset.v = markup;
  el.innerHTML = markup;
}
```
No hash, no animation frame, no theme listener. The SVG is `aria-hidden`; the enclosing `.dash-quad-card` carries the sentence in `aria-label`, written in the same pass.

### 3.1 Semicircular needle gauge — Trade win %, Day win %

`viewBox="0 0 56 32"`, CSS `width:56px; height:32px`. Centre (28,26), radius 20. Arc length **62.832**.

- **track** — `<path d="${GAUGE_ARC}" fill="none" stroke="var(--surface-inset)" stroke-width="5" stroke-linecap="round"/>`
- **value arc** — same path, `stroke-width="5" stroke-linecap="round" stroke-dasharray="62.832" stroke-dashoffset="${62.832 * (1 - p)}"`, `p = clamp(pct/100, 0, 1)`
- **arc colour** — `p < 0.40` → `var(--pnl-neg)`; `0.40 ≤ p ≤ 0.55` → `var(--accent)`; `p > 0.55` → `var(--pnl-pos)`. The reference's arc is red/orange at 52.38%; oxide `#f0763d` **is** our orange, so the accent band is a one-to-one translation, not an invention.
- **needle** — `a = Math.PI * (1 - p)`; `<line x1="28" y1="26" x2="${28 + 15*Math.cos(a)}" y2="${26 - 15*Math.sin(a)}" stroke="var(--text)" stroke-width="1.5" stroke-linecap="round"/>`. Sanity: p=0 → (13,26); p=0.5 → (28,11); p=1 → (43,26).
- **hub** — `<circle cx="28" cy="26" r="2.5" fill="var(--text)"/>`
- **end labels** (the reference's `11` and `7`) — `<text x="3" y="32" font-size="10" fill="var(--text-faint)" font-family="var(--font-mono)" font-weight="600">${analytics.wins}</text>` and the same at `x="53" text-anchor="end"` for `analytics.losses`.
- **Day win %** shows three (the reference's `1 0 2`): `x=3`, `x=28 text-anchor="middle"`, `x=53 text-anchor="end"`, fed by `dayOutcomeCounts(analytics.dailyPnl)` → `up / flat / down`.

### 3.2 Circular ring — Profit factor

`viewBox="0 0 32 32"`, `32×32`. Circumference `2π·13 = 81.681`.

```
<circle cx="16" cy="16" r="13" fill="none" stroke="var(--surface-inset)" stroke-width="4"/>
<circle cx="16" cy="16" r="13" fill="none" stroke-width="4" stroke-linecap="round"
        transform="rotate(-90 16 16)" stroke="${c}"
        stroke-dasharray="81.681" stroke-dashoffset="${81.681 * (1 - f)}"/>
```

`f = normalizeToScore(analytics.profitFactor, 0, 3) / 100` — the **exact** normalisation `computeTraderScore` already uses for the radar's Profit factor spoke (`app.js:9358`). One definition of "good profit factor", shared by the ring and the radar, so the two can never disagree on the same screen. `profitFactor >= 999` (the case the value node already prints as `∞`) → `f = 1`.

Colour: `pf >= 1` → `--pnl-pos`; `0.8 ≤ pf < 1` → `--accent`; below → `--pnl-neg`.

The reference draws an unbroken outline; ours fills proportionally — same shape, carrying information instead of decoration.

### 3.3 Horizontal split bar — Avg win/loss trade

`viewBox="0 0 56 8"`, `56×8`. `W = clamp(56 * avgWin / (avgWin + |avgLoss|), 4, 52)`; both zero → `W = 28`.

```
<rect x="0"       y="1" width="${W}"      height="6" rx="3" fill="var(--pnl-pos)"/>
<rect x="${W}"    y="1" width="${56 - W}" height="6" rx="3" fill="var(--pnl-neg)"/>
<rect x="${W-0.5}" y="0" width="1" height="8" fill="var(--surface-1)"/>   <!-- seam -->
```
`avgLoss === 0` → full green; `avgWin === 0` → full red. The sub line (§2.1 item 5) carries the reference's `A$362.84 / -A$8.53` pair.

### 3.4 Net P&L — no chart, per the reference.

### 3.5 Edge score gradient bar — CSS, not a drawing

Under `#traderScoreValue` in `.trader-score-value-wrap`:

```html
<div class="edge-bar"><i class="edge-mark"></i></div>
```
```css
.edge-bar { position: relative; height: 6px; border-radius: 3px; margin-top: 6px;
  background: linear-gradient(90deg, var(--pnl-neg) 0%, var(--accent) 50%, var(--pnl-pos) 100%); }
.edge-mark { position: absolute; top: -3px; left: calc(var(--edge-mark, 0) * 1%);
  width: 2px; height: 12px; border-radius: 1px; background: var(--text); transform: translateX(-1px); }
```
One JS line beside the existing `setCountUpValue(ui.traderScoreValue, …)`:
```js
bar.style.setProperty("--edge-mark", String(clamp(analytics.traderScore.score, 0, 100)));
```

### 3.6 The 10px labels

The gauge end labels are 10px, under the stated 11px floor. Precedent is `.mc-ix` at `clay-v3.css:3193` (10px, `display:none` below 900). Same treatment: `#dashboard .mq-gauge { display: none }` below 1240, and the counts ride the tile's `aria-label` (`"Trade win rate 52.4 percent, 11 wins, 7 losses"`). The floor is a **phone** floor and it is met on phones. If the owner reads 10px as a violation anywhere, drop the two numerals and keep the arc — nothing else changes.

---

## 4. THE CHART ROW

`.panel-grid-analytics` (`index.html:1606`) keeps its three children in this order.

### 4.1 Slot 1 — Edge score (existing radar, moved out of the drawer)

**Static HTML move**: cut `<article class="panel panel-chart panel-trader-score">` (`index.html:1841–1858`) and the `<p class="depth-caption" id="depthCaptionScore">` above it out of `<details id="dashDepth">`, paste as the **first child** of `.panel-grid-analytics`. Every lookup involved is `getElementById` — `ui.traderScoreChart` (`app.js:542`), `ui.traderScoreValue` (`543`), `ui.depthCaptionScore` (`441`) — so the move is inert to JS. This also sidesteps `#dashboard.is-active > #dashDepth { display: none }` at `clay-v3.css:3691`, which any `display:contents` promotion would tie on specificity and lose to on source order.

`drawRadarChart` (`charts.js:1441`) already draws six spokes labelled **Win %, Profit factor, Avg win/loss, Recovery, Max drawdown, Consistency** (`app.js:9356–9362`) — the reference's six, in the reference's order. No chart change.

Panel head `<h3>` → `Edge score`. Foot: `Your Edge Score` label, `#traderScoreValue`, the `.edge-bar` from §3.5. `#traderScoreCaption` is `display:none` on this grid (§6).

**Two charts.js fixes ship with it, and they are root-cause fixes, not patches:**

`charts.js:1625` — `getCanvasContext` sizes the bitmap from `data-height` while `#dashboard.is-active .panel-chart canvas { height: 100% }` stretches it. Every dashboard chart is currently drawn at its authored height and CSS-squashed. One line:
```js
const height = Number(heightOverride) || canvas.clientHeight || Number(canvas.dataset.height) || 280;
```
`heightOverride` is read first, so `drawBarChart`'s `fitHeight` (`charts.js:1073`) still wins. Hidden canvases report `clientHeight` 0 and fall through to `data-height` exactly as today. Blast radius is all seven charts — that is the point.

`charts.js:1463` — with a real height the radar's 90px label reserve is now measured against a 160.6px box at 1440×900, which lands on the documented 46px floor. Make the reserve scale:
```js
const reserve = height < 220 ? 52 : 90;
const radius = Math.max(Math.min((width - 150) / 2, (height - reserve) / 2), 46);
```
Check: 1999×1100 → canvas 251, reserve 90, radius `min(109.2, 80.5)` = **80.5**. 1440×900 → canvas 160.6, reserve 52, radius `min(96.4, 54.3)` = **54.3**. Both clear the floor. `data-height` stays `240` as the fallback for hidden/mobile.

### 4.2 Slot 2 — Daily net cumulative P&L (existing equity chart)

`#equityChart` unchanged. `drawLineChart` with `key:"line"` already draws the soft area fill under the curve — this **is** the reference's chart. Retitle `<h3>Equity Curve</h3>` → `<h3>Daily net cumulative P&L</h3>`. `.eq-footnotes` gains a sixth figure (Expectancy, §6). `#equityScrub` goes absolute (§1.2) — both halves of that rule must ship or the readout escapes to the viewport on drag.

### 4.3 Slot 3 — Net daily P&L (new canvas, existing panel shell)

**Keep the drawdown panel shell**, swap only its body. `#drawdownChart` stays in the DOM, hidden — `charts.js` keeps painting into it, `ui.drawdownChart` never reads null, and no grid child is added or removed.

```html
<article class="panel panel-chart panel-span-4">
  <div class="panel-head"><h3>Net daily P&amp;L</h3><p>Per trading day</p></div>
  <canvas id="drawdownChart" width="900" height="280" data-height="180" aria-label="Drawdown curve chart"></canvas>
  <canvas id="dailyPnlChart" width="900" height="280" data-height="200" aria-label="Net profit and loss by trading day"></canvas>
</article>
```

`ui.dailyPnlChart: document.getElementById("dailyPnlChart")` goes in the `ui` object literal (`app.js` ~377–800), which sits above `createChartsModule({ ui, … })` at `app.js:853` — same object, no wiring.

**Data.** One line on the `calculateAnalytics` return object (`app.js:8545`):
```js
dailyPnlSeries: Array.from(dailyPnl.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-30),
```
ISO date strings sort chronologically as strings — no `Date` parsing.

**Hash.** Append `analytics.dailyPnlSeries` to `computeChartHash` (`charts.js:140`). Append the **array**, never the raw Map — `JSON.stringify(new Map())` is `{}` and the draw-in would never replay.

**`drawDailyBarChart(canvas, series, options, progress)`** — new, in `charts.js`, in the existing style: `getCanvasContext(canvas)` for DPR, `clearCanvas`, `getPalette()` for every colour, `drawCenteredText` for the empty state, and the **same** `BAR_STAGGER_MS` / `barProgress(index)` stagger `drawBarChart` uses at `1096` so the draw-in matches every other chart. Vertical, unlike `drawBarChart` which is horizontal rows.

Geometry, CSS px: `padLeft 44, padRight 10, padTop 12, padBottom 20`. `plotW = width - 54`, `plotH = height - 32`. `maxAbs = Math.max(1, ...series.map(([, v]) => Math.abs(v)))`. Series straddles zero → `zeroY = top + plotH / 2` and each bar's half-scale is `plotH / 2 / maxAbs`; all one sign → zero rule sits on the corresponding edge and scale is `plotH / maxAbs`. `slot = plotW / n`, `barW = clamp(slot - 3, 3, 14)`, centred in its slot.

Bars: `fillRoundedRect(ctx, x, y, barW, h * barProgress(i), 2, v >= 0 ? colors.pos : colors.neg)` — `fillRoundedRect` already exists at `charts.js:1375`. Zero rule plus two gridlines at `colors.grid`; three y labels (max / 0 / min) at `colors.textFaint`, `colors.font(600, 10)`; three x labels (first, middle, last) through the existing `drawDateLabels(ctx, points, labels, bottom)` at `charts.js:949`.

Registered in `drawAllCharts` (`charts.js:518`) beside the others:
```js
paint(ui.dailyPnlChart, (p) => drawDailyBarChart(ui.dailyPnlChart, analytics.dailyPnlSeries || [],
  { emptyLabel: "No daily P&L yet" }, p), progress);
```

---

## 5. THE BOTTOM ROW

### 5.1 Recent trades — new panel `#dashRecent`

```html
<section class="panel dash-recent" id="dashRecent" aria-labelledby="dashRecentHead">
  <div class="panel-head"><h3 id="dashRecentHead">Recent trades</h3></div>
  <div class="dash-recent-scroll">
    <table class="dash-recent-table">
      <thead><tr><th>Close Date</th><th>Symbol</th><th>Net P&amp;L</th></tr></thead>
      <tbody id="dashRecentRows"></tbody>
    </table>
  </div>
  <button class="dash-recent-more" id="dashRecentMore" type="button" data-target="journal">All trades</button>
</section>
```

`renderDashRecentTrades()`, a function declaration, called beside the existing `renderDashMiniCal()` at `app.js:8226`:

```js
function renderDashRecentTrades() {
  const body = document.getElementById("dashRecentRows");
  if (!body) return;
  body.innerHTML = getClosedTrades().slice(-10).reverse().map((t) => {
    const tone = t.netPnl > 0 ? "pnl-positive" : t.netPnl < 0 ? "pnl-negative" : "";
    return `<tr><td>${escapeHtml(formatChartDateLabel(t.date))}</td>` +
           `<td>${escapeHtml(t.asset || "—")}</td>` +
           `<td class="${tone}">${escapeHtml(formatSignedCurrency(t.netPnl))}</td></tr>`;
  }).join("") || `<tr><td colspan="3" class="dash-recent-empty">No closed trades yet</td></tr>`;
}
```

**Not** `renderRecentTrades` from `src/modules/recentTradesView.js` — that renders the public whitelisted landing-tape feed, which is a **different user's trades**. Wrong data, deliberately not reused.

`#dashRecentMore` carries `data-target="journal"` and is routed by the existing nav delegation. The `.dash-recent-scroll` overflow rule is one selector added to the existing scroll-region rule at `clay-v3.css:3672`.

### 5.2 Calendar — existing `#dashMiniCal`, verbatim, plus two lines

Already renders every reference element: `#miniCalMonth` (month name), `.mini-cal-weekdays` (S M T W T F S), filled traded-day tiles with big signed money via `.mc-amt` and the 4-step `--day-intensity` tone ramp (`app.js:12297`), faint numbers on untraded days (`.mini-cal-day` + `.is-future` at 0.45), and the month total top-right in `#miniCalNet` via `formatSignedCurrency` + `toneBySign`.

**Add 1 — the "6 trades" subline.** `renderDashMiniCal` already holds `stats.trades`. Append to the tile template at `app.js:12297`:
```html
<u class="mc-n">${stats.trades} trades</u>
```
```css
#dashboard .mc-n { font: 600 10px/1 var(--font-mono); font-style: normal;
                   text-decoration: none; color: var(--text-faint); }
@media (max-width: 1239px) { #dashboard .mc-n { display: none; } }
```
Unconditional on the desktop grid — **no height gate**. At 1440×900 the tile is 34.0px and carries 11px money + 10px subline = 21px of ink. It fits, and gating it would silently delete a named reference element at the second target resolution.

**Add 2 — the `‹ ›` month arrows.** One module-level `let` **beside `WALL_SIZE_KEY` above `init()`**:
```js
let dashMonthOffset = 0;
```
Two lines changed inside `renderDashMiniCal` (`app.js:12234`):
```js
const now = new Date();
const view = new Date(now.getFullYear(), now.getMonth() + dashMonthOffset, 1);
const monthValue = toDateInputValue(view).slice(0, 7);
```
`firstDay` becomes `view`; `todayIso` stays `toDateInputValue(now)` so `.is-today` and `.is-future` keep telling the truth. Two `<button data-cal-step="-1|1">` in `.mini-cal-open`'s row, one delegated handler: `dashMonthOffset += step; renderDashMiniCal();`. About 10 lines total, and it is the reference's calendar arrows exactly.

The comment at `app.js:12232` ("Always the real current month") is now wrong — replace it, do not leave it lying.

---

## 6. DROPPED, AND THE SUBSTITUTION

| Reference element | Verdict | Why, and what stands in |
|---|---|---|
| Row A `‹ ›` on the date pill | **Dropped** | `BALANCE_RANGE_DAYS` is a duration (1m/3m/all), not a window with a cursor. Stepping it needs new state, a new persisted key, a new renderer path. The pill states the resolved span; a second month cursor at the top of a screen that already has one on the calendar is a drift bug waiting to happen. |
| "Gross \| Nets" toggle | **Substituted, literally labelled** | The product stores one money field per trade, `netPnl`. `calculatedGrossPnl` exists (`app.js:4012`) but only on Topstep Orders imports, so it is not a book-wide truth. Ship the reference's exact control with the reference's exact labels: `Gross` renders `disabled` with `title="This journal stores net P&L only. Gross needs a broker export with commissions listed separately."`, `Net` is the active state. The **range group `1M / 3M / ALL` moves into row B beside it** — real, already wired, and this layout would otherwise strand it. |
| "group 1" chip | **Substituted** | No account groups exist. `#dashBookChip` renders the active account's `.account-tag` (`Static limit` / `Trailing limit`) when `prop.enabled`, else the account label. Written inside `renderAccountSwitches` (`app.js:11955`), 4 lines. "group 1" answers *which book am I looking at*; so does this, in the product's own noun. |
| "2 weekdays accounted for" | **Substituted** | `analytics.dailyPnl.size` → `"12 trading days on record"`. The product's day set is days with closed trades, not days in a calendar week. |
| "64 plan-followed streak" | **Built, but warn the owner first** | Real, from `preTradeRulesAsked` / `preTradeRules`. **It will read empty on the owner's own book**: every import path writes `preTradeRulesAsked: []` (`app.js:4368`, `4466`), and the rule skips those trades. A 64-trade imported book prints no flame. Correct behaviour, and the reference's most eye-catching row D number is the one least likely to appear. Say so before he sees a blank line. |
| "100% plan adherence" | **Built** | Answer-weighted: ticked answers ÷ asked answers over closed trades with a non-empty `preTradeRulesAsked`. **Not** `analytics.disciplineScore` — that is a weighted composite of violations, moods and execution grades, and calling it "plan adherence" would be a lie. |
| "Share card" | **Substituted, smallest version** | Text share, not an image. One string from figures already on screen + `navigator.share({ title, text })`, falling back to `navigator.clipboard.writeText` + the existing toast. ~12 lines. The month card already carries `#dashCardDate` and `.month-card-mark` precisely because people screenshot it. Marked in code: `// ponytail: text share. navigator.share({files}) + an offscreen 1080x1350 canvas is the upgrade when the owner asks.` |
| "Recovery factor" spoke | **Kept as "Recovery"** | At a 368px panel the two-word label eats a spoke's clearance. The only string in the six that differs from the photo. |
| Drawdown chart | **Body swapped, panel kept** | The reference's row E has no drawdown chart. `#drawdownChart` stays in the DOM hidden and `charts.js` keeps painting it — no grid child added, no null guard needed. The **figures survive**: `Current Drawdown` and `Max Drawdown` are already two of the `.eq-footnotes`, and Max drawdown is a radar spoke. |
| Expectancy tile | **Rehomed** | Joins `.eq-footnotes` under the equity panel — already a flex line of five such figures, becomes six. Its `[data-metric]` node moves with it, so `ui.metricNodes` and `renderMetricDeltas` are untouched. |
| Best Day / Worst Day tiles | **Rehomed** | Into `#miniCalFoot`, which today prints `3 GREEN · 2 RED · AVG +$412` and becomes `… · BEST +$1,036 · WORST -$820`. `renderDashMiniCal` already holds both in `dayStats` (`app.js:12313`). |
| Balance hero tile | **Off grid, restated as a clause** | The reference's first metric is Net P&L, not a balance. `.dash-hero` goes `display:none`; `renderBalanceCard` keeps running into it. The figure returns as a third clause on row A's grey line. **This is the one addition to the reference in the whole spec** — a trading journal that shows net P&L and hides the account balance is a downgrade nobody asked for, and it costs one clause on a line that already exists. |
| `#traderScoreCaption` | **Hidden on this grid** | A sentence in a panel whose foot budget is 47px. The number and the gradient bar say it. |
| Discipline monitor, playbook row | **Off grid at ≥1240** | Neither has a slot in the reference's six rows. The playbook has its own full `#playbook` view; the monitor's headline read is restated by row D's adherence figure. Both render normally below 1240. |
| `#propTracker` | **Off grid, and the graft is taken** | Do **not** add a `:has()` override that hides `#dashRecent`. The photo's row F is two panels and an owner who has sent it three times will read a vanished table as a miss. The max-loss read already lives on the rail (`#navRiskGroove` / `#navRiskValue`, `index.html:1061`) and stays there on every dashboard state — verify that before the panel leaves. |

---

## 7. COPY SHEET

No em or en dashes anywhere. `·` is the separator. Hyphen-minus in date ranges is fine.

| Node | String |
|---|---|
| `#dashboardHeading` | `Welcome, {name}.` — `getTraderName()` (`app.js:10096`); no name configured drops the address entirely, never invents one |
| `#dashClock` | `{Weekday} {D} {Month} · {n} trades on record · {balance}` |
| `#dashRangePill` | `23 JUL - 23 AUG` (`ALL` prints `{first equity date} - TODAY`) |
| Row B labels | `All accounts` · `{Static limit\|Trailing limit\|account name}` · `Gross` `Net` · `1M` `3M` `ALL` |
| Tile labels | `Net P&L` · `Trade win %` · `Profit factor` · `Day win %` · `Avg win/loss trade` |
| `#dashPlanStreak` | `{n} plan-followed streak` |
| `#dashPlanDays` | `{n} trading days on record` |
| `#dashPlanRate` | `{n}% plan adherence` |
| Row D, no checklist data | flame and both plan clauses do not render; one clause instead: `NO CHECKLIST YET` (routes to `#rulesPanel`). Never a fabricated 0, never a fabricated 100% |
| `#dashShareCardBtn` | `Share card` |
| Panel heads | `Edge score` · `Daily net cumulative P&L` · `Net daily P&L` · `Recent trades` |
| Edge foot | `Your Edge Score` |
| Recent trades columns | `Close Date` · `Symbol` · `Net P&L`; footer button `All trades`; empty `No closed trades yet` |
| Calendar | `{MONTH} {YEAR}` · `#miniCalFoot`: `{g} GREEN · {r} RED · AVG {±$x} · BEST {±$x} · WORST {±$x}` · empty `AWAITING FIRST TRADE` |
| Tile subline | `{n} trades` |
| Chart empty states | `No trader score data yet` (existing) · `No equity data yet` (existing) · `No daily P&L yet` (new) |

---

## 8. BUILD ORDER

Eight steps. Each ends at a working screen; each is verifiable on its own.

**1 — charts.js first, before anything depends on it.**
`getCanvasContext` height line (`charts.js:1625`); `drawRadarChart` scaled reserve (`1463`). Load the app, look at all seven charts on every view. This is the widest-blast-radius change in the spec and it is cheapest to judge while nothing else has moved.

**2 — Static HTML moves, no CSS, no JS.**
`.panel-trader-score` + `#depthCaptionScore` out of `#dashDepth` into `.panel-grid-analytics`; `.dash-range` out of `.dash-hero-top`; new `#dashBar` with a `[data-account-switch-wrap]`-wrapped `<select id="accountSwitchDash" data-account-switch>`, the `#dashBookChip` span, and the `Gross`(disabled)/`Net` pair. Dashboard now looks wrong and works fine. Confirm the third account select populates and switches with zero new JS.

**3 — The grid.** Rewrite the `@media (min-width: 1240px)` block per §1.2, add the `min-height: 760px` gate and the `max-height: 960px` compact set, delete the two dead `:has()`/`.dash-board-slot` rules. Measure §9 assertions 1 and 2 now — before any new component can be blamed for a scroll.

**4 — The metric strip.** New `.dash-quad` markup (§2), the `renderDashboardMetrics` edits, `avgWinLossRatio` / `dayOutcomeCounts` / `dayWinPct`, and the Expectancy / Best Day / Worst Day rehoming. No gauges yet — five tiles, five figures, correct numbers.

**5 — The gauges.** `GAUGE_ARC` beside `WALL_SIZE_KEY`, `renderMetricGauges`, `writeGauge`, `.mq-fig` and `.mq-gauge` CSS, `.edge-bar` / `.edge-mark` and the one `setProperty` line. Toggle light/dark and confirm every gauge follows without a repaint call.

**6 — Row F.** `#dashRecent` markup + `renderDashRecentTrades()`; the calendar's `.mc-n` subline; `dashMonthOffset` and the `‹ ›` handler.

**7 — Row D and row A.** `#dashPlan` markup, `computePlanStreak()`, `computePlanAdherence()`, `#dashPlanDays`, `#dashShareCardBtn`; `#dashRangePill` written inside `syncBalanceRangeButtons`; the `renderGreeting` clock string rewrite (`app.js:10113`).

**8 — Row E slot 3.** `#dailyPnlChart` canvas in the drawdown panel shell, `ui.dailyPnlChart`, `dailyPnlSeries` on `calculateAnalytics`, `drawDailyBarChart`, the `drawAllCharts` `paint()` line, the `computeChartHash` append. Then write `tests/dashboardMetrics.check.mjs` (§9.3) and run `npm test`.

---

## 9. VERIFY

### 9.1 Measurable, at 1999×1100 and 1440×900

Run in the console with the dashboard active and at least one closed trade:

```js
const d = document.getElementById("dashboard");
const cs = getComputedStyle(d);
console.table({
  chromeH: getComputedStyle(document.documentElement).getPropertyValue("--chrome-h"),
  scrollH: d.scrollHeight, clientH: d.clientHeight,
  bodyScroll: document.body.scrollHeight - window.innerHeight,
  rows: cs.gridTemplateRows, cols: cs.gridTemplateColumns.split(" ")[0]
});
```

1. `d.scrollHeight === d.clientHeight` and `document.body.scrollHeight <= window.innerHeight`. **Both resolutions.** Zero scroll is the brief.
2. `gridTemplateRows` resolves to six tracks; the first four read `44px 32px 84px 30px` (or the compact `40 28 76 26` under 960px height), and rows 5+6 sum to `clientHeight - 250` (or `-230`).
3. `document.querySelectorAll("#dashboard .dash-quad-card").length === 5`, and each `getBoundingClientRect().width` is **278.4 ± 1** at 1999, **258.9 ± 1** at 1440.
4. The three `.panel-grid-analytics > .panel` widths are **368.4 / 515.8 / 515.8** at 1999 and **342.7 / 479.8 / 479.8** at 1440 (± 1).
5. `#dashRecent` and `#dashMiniCal` are **586.3 / 825.7** at 1999, **545.7 / 768.7** at 1440 (± 1), and their tops are equal.
6. `document.getElementById("traderScoreChart").clientHeight >= 150` at 1440×900. With the §4.1 fixes the drawn radius is 54.3, above the 46px floor. If it reads 46, the panel foot grew — trim the foot, do not touch `getCanvasContext`.
7. `document.querySelectorAll("#miniCalGrid .mc-n").length === document.querySelectorAll("#miniCalGrid .is-trade").length`, and every `.mini-cal-day` height ≥ 34px.
8. `document.querySelectorAll("[data-gauge] svg").length === 4`.

### 9.2 Behavioural, not measurable

- **The TV.** Start the standby stream in `.dash-edge-mini`, switch to Journal, come back. The iframe must still be playing. Nothing in this spec calls `renderAll` or `renderWall`; `#dashEdgeMini` is docked `position:fixed`, never `display:none`, so no ancestor of the iframe enters `display:none`. Test before **and** after.
- **Boot.** Hard reload with an empty journal and with a full one. `GAUGE_ARC` and `dashMonthOffset` must be above `init()` (`app.js:1222`); `renderMetricGauges`, `computePlanStreak`, `computePlanAdherence`, `renderDashRecentTrades`, `avgWinLossRatio`, `dayOutcomeCounts`, `dayWinPct` must all be `function` declarations. **This TDZ trap has shipped four times.**
- **375px.** The radar is now visible on a phone where the closed `#dashDepth` drawer used to hide it. Static move, so every lookup is inert — but it is a visible mobile change nobody asked for. Look at it before shipping.
- **Single account.** `#accountSwitchDash` must be inside a `[data-account-switch-wrap]` or the under-two-accounts auto-hide at `app.js:11968` silently does nothing and ships an empty select.
- **The rail's risk groove.** `#navRiskGroove` must still read the prop max-loss distance on every dashboard state now that `#propTracker` is off grid.
- **The 5s poll.** Watch `[data-gauge]` in DevTools for 30s with no new trades. Zero `innerHTML` writes — the `dataset.v` guard is what makes that true.

### 9.3 The one runnable check — `tests/dashboardMetrics.check.mjs`

Pure functions, no DOM, four asserts, runs under the existing `npm test` loop:

```js
// dayOutcomeCounts over a hand-built Map
const m = new Map([["2026-08-11", 120], ["2026-08-12", 0], ["2026-08-13", -40], ["2026-08-14", -5]]);
assert.deepEqual(dayOutcomeCounts(m), { up: 1, flat: 1, down: 2, days: 4 });
assert.equal(dayWinPct({ dailyPnl: m }).toFixed(1), "25.0");

// avgWinLossRatio degenerates
assert.equal(avgWinLossRatio({ avgWin: 0,   avgLoss: 0 }),  0);      // both zero
assert.equal(avgWinLossRatio({ avgWin: 300, avgLoss: 0 }),  2.5);    // no losses
assert.equal(avgWinLossRatio({ avgWin: 362.84, avgLoss: -8.53 }).toFixed(2), "42.54");

// normalizeToScore, the shared definition the ring and the radar both read
assert.equal(normalizeToScore(0,   0, 3), 0);
assert.equal(normalizeToScore(1.5, 0, 3), 50);
assert.equal(normalizeToScore(9,   0, 3), 100);   // clamped

// split-bar width never collapses either side
assert.equal(splitBarWidth(0, 0), 28);
assert.ok(splitBarWidth(1000, 1) <= 52 && splitBarWidth(1, 1000) >= 4);
```

Extract `avgWinLossRatio`, `dayOutcomeCounts`, `dayWinPct` and `splitBarWidth` so the test can import them, or mirror the four expressions in the test file the way `tests/calendarParse.check.mjs` already does. The four asserts are the smallest thing that fails if any of the strip's arithmetic breaks.

---

**Skipped deliberately:** the image share card (text share ships, upgrade when asked), a real Gross money source (the field is Topstep-Orders-only, the tab ships disabled and says why), row A pill arrows (needs windowed-period state the product has never had). Each is one clause in §6 with the trigger for adding it.