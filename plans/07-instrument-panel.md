# BUILD SPEC — The Instrument Panel

One developer, one day, vanilla CSS/JS, no build step. Every line number below was read from the working tree on `renovation/v2` at commit `e999589`.

**Two contracts that outrank everything else in this document:**

1. **No new module-level `const`/`let` below the `init();` call in app.js.** `tests/bootOrder.check.mjs` already enforces this (it scans every line after `init();` against a four-name allowlist). All new module state in this spec lands at **app.js:1223**, next to `WALL_SIZE_KEY` at 1222. All new logic is a hoisted **function declaration**.
2. **No code path in this spec calls `renderAll()`, `renderWall()`, `setHtml()`, or writes `innerHTML` on any ancestor of `.dem-tv` or `#bbWallGrid`.** `renderAll()` at app.js:8185 calls `renderWall()` at 8197, and `renderWall` at 16240 does `grid.innerHTML = …`. The signature guard (`grid.dataset.sig === sig`) makes it *usually* a no-op, and "usually" is not a contract. Layout is CSS. The only JS redraw is `renderCharts(state.analytics)`, which is what the existing debounced resize at app.js:2024 already does.

---

## 1. DASHBOARD LAYOUT

### 1.1 The measured problem

`#dashboard` has **nine** direct children (parsed, not guessed):

| line | element |
|---|---|
| 1252 | `header.dash-head` |
| 1311 | `aside.dash-edge-mini#dashEdgeMini` |
| 1351 | `div.dash-stats#dashboardMetricGrid` |
| 1594 | `section#dashboardEmptyState` |
| 1606 | `section.panel-grid.panel-grid-analytics` |
| 1692 | `div.panel-grid.panel-grid-bottom` |
| 1747 | `details#deskSettings` |
| 1834 | `details#dashDepth` |
| 1904 | `div#adminPanelsMount` |

Column 1 spends ~2003px in a 1043px box. The fix is not to delete panels. It is to stop stacking them.

### 1.2 The shape: promote, do not re-parent

`display: contents` on three wrappers turns nine stacked children into fifteen placeable grid items **with zero DOM moves**. This retires the whole "`ui.metricNodes` is captured at module load" risk class: `>` and `querySelectorAll` operate on the DOM tree, and the DOM tree does not change.

```css
/* styles.css — inside the existing @media (min-width: 900px) block at 12127,
   REPLACING the #dashboard.is-active rule at 9936 and everything through 9979. */

/* THE PROMOTION. .dash-stats, .dash-month-card and .dash-boards are grouping
   divs with no visual identity of their own worth keeping. display:contents
   dissolves the box and promotes their children to grid items of #dashboard,
   so every card can be placed on the four-row instrument grid without one
   node moving in index.html. ui.metricNodes is captured at module load from
   querySelectorAll; a box that stops existing is invisible to that. */
#dashboard.is-active .dash-stats,
#dashboard.is-active .dash-month-card,
#dashboard.is-active .dash-boards { display: contents; }

/* LOAD BEARING. .dash-stats[hidden] at styles.css:4719 is (0,2,0); the rule
   above is (1,2,0) and beats it, which would leave the metric grid visible
   through the empty state. Restate it at winning specificity. */
#dashboard.is-active .dash-stats[hidden] { display: none; }

#dashboard.is-active {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-rows: 44px 92px minmax(0, 0.46fr) minmax(0, 0.54fr);
  gap: 12px;
  /* padding-inline is owned by .view.is-active:not(#terminal) at 12156, which
     is (1,2,0) and centres the content on --shell-w. Only the block axis is
     ours; a `padding` shorthand here would read as a fight it silently loses. */
  padding-block: 16px;
  overflow: hidden;               /* the promise, stated in CSS */
  align-content: stretch;         /* replaces align-content:start at 12160 */
}

/* overflow:hidden on a grid ITEM cancels its automatic minimum size, so a
   panel reports a smaller contribution than its content and CLIPS instead of
   shrinking. This is the exact trap #terminal documents at styles.css:12166.
   .dash-month-card carries overflow:hidden (clay-v3.css:3011) and .panel
   carries it for rounded corners. Every row-3 and row-4 number below assumes
   shrinking, so the guard is not optional. */
#dashboard.is-active > *,
#dashboard.is-active .dash-stats > *,
#dashboard.is-active .dash-month-card > *,
#dashboard.is-active .dash-boards > * { min-height: 0; min-width: 0; }
```

### 1.3 Placement, item by item

```css
/* ROW 1 — the command bar. */
#dashboard.is-active > .dash-head { grid-area: 1 / 1 / 2 / -1; align-items: center; }
#dashboard.is-active .dash-hello  { font-size: 15px; white-space: nowrap; }
#dashboard.is-active .dash-head .btn,
#dashboard.is-active .dash-head .nav-btn { min-height: 32px; padding-block: 0; }

/* ROW 2 — the tile strip. The balance keeps its own card; the pulse row keeps
   its own grid. Two items, not a new element. */
#dashboard.is-active .dash-hero { grid-area: 2 / 1 / 3 / 4; }
#dashboard.is-active .dash-quad { grid-area: 2 / 4 / 3 / -1; }

/* The hero is a 92px tile now, so its long tail goes. Each of these keeps
   rendering into a hidden node, which costs nothing and breaks nothing. */
#dashboard.is-active .dash-hero .dash-now,
#dashboard.is-active .dash-hero .dash-spark-wrap,
#dashboard.is-active .dash-hero .dash-ground-caps,
#dashboard.is-active .dash-hero #dashCardDate { display: none; }
/* #dashSparkline stays in the DOM so ui.dashSparkline never reads null. */

/* ROW 3 — the three charts. Discipline is the reference's edge radar slot,
   built from meters already computed rather than a new chart. */
#dashboard.is-active .dash-board-slot        { grid-area: 3 / 1 / 4 / 5; }
#dashboard.is-active .panel-grid-analytics   { grid-area: 3 / 5 / 4 / -1;
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
#dashboard.is-active #propTracker            { grid-area: 3 / 1 / 4 / 5; }
/* Prop rules on means the tracker IS the left panel. */
#dashboard.is-active:has(#propTracker:not([hidden])) .dash-board-slot { display: none; }

/* ROW 4 — the calendar, the playbook, the TV. */
#dashboard.is-active #dashMiniCal    { grid-area: 4 / 1 / 5 / 6; }
#dashboard.is-active #dashPlaybook   { grid-area: 4 / 6 / 5 / 10; }
#dashboard.is-active .dash-edge-mini { grid-area: 4 / 10 / 5 / -1;
  position: static; margin: 0; }   /* kills sticky, grid-row 1/30 and the bleed */

/* The one region that scrolls inside each panel. */
#dashboard.is-active .dash-playbook-grid,
#dashboard.is-active #riskViolations,
#dashboard.is-active .dem-panel { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }

/* ROW 4, the calendar's lost furniture. .dash-month-card carried the surface
   for both its children; display:contents takes the box and its shadow with it. */
#dashboard.is-active #dashMiniCal {
  display: flex; flex-direction: column; gap: 5px;
  padding: 11px; border-radius: var(--radius-xl);
  background: var(--surface-1); box-shadow: var(--clay-raised);
}

/* OUT OF FLOW ENTIRELY. An advisory that costs zero layout height. */
#dashboard.is-active #estimatedAnalyticsNotice {
  position: fixed; left: 24px; bottom: 12px; max-width: 320px; z-index: 25; margin: 0;
}

/* THE EMPTY STATE OWNS THE PANEL. JS keeps toggling [hidden] and nothing else. */
#dashboard.is-active:has(#dashboardEmptyState:not([hidden])) > *:not(.dash-head, #dashboardEmptyState),
#dashboard.is-active:has(#dashboardEmptyState:not([hidden])) .dash-stats > *,
#dashboard.is-active:has(#dashboardEmptyState:not([hidden])) .dash-month-card > *,
#dashboard.is-active:has(#dashboardEmptyState:not([hidden])) .dash-boards > * { display: none; }
#dashboard.is-active #dashboardEmptyState { grid-area: 2 / 1 / -1 / -1; place-self: center; }

/* The two <details> become a docked drawer, NOT an off-by-default row.
   openDeskSettings() at app.js:11045 sets .open = true and scrollIntoView()s
   #rulesPanel; both still work, and neither reintroduces page scroll. */
#dashboard.is-active > details.panel-collapsible {
  position: fixed; bottom: 0; z-index: 26; margin: 0;
  width: min(560px, 46vw);
  max-height: calc(100vh - var(--chrome-h, 86px) - 24px);
  overflow-y: auto; overscroll-behavior: contain;
}
#dashboard.is-active > #deskSettings { right: 24px; }
#dashboard.is-active > #dashDepth    { right: 232px; }
#dashboard.is-active > details.panel-collapsible:not([open]) { overflow: visible; max-height: none; }
#dashboard.is-active > details.panel-collapsible > summary { min-height: 32px; }

/* #adminPanelsMount and .panel-grid-bottom are default-off cards (see §2). */
#dashboard.is-active > #adminPanelsMount { grid-area: 4 / 1 / 5 / -1; }
#dashboard.is-active > .panel-grid-bottom { grid-area: 4 / 1 / 5 / -1; }
```

**Deleted outright** from styles.css: `#dashboard > *:not(.dash-edge-mini) { grid-column: 1 }` (9958), `#dashboard.is-active > *:not(:last-child) { margin-bottom }` (9962), the `.dash-edge-mini { grid-column: 2; grid-row: 1 / 30; position: sticky; top: 0 }` block (9963–9979) **and its 29-implicit-row / `row-gap: 0` workaround comment**, the `@media (max-width: 1239px)` order block (9990–10007), and `#dashboard.is-active { align-content: start }` (12160). From clay-v3.css: `#dashboard .dash-edge-mini { margin-right: -16px }` (1242) and the `@media (min-width: 1240px)` bleed correction (1259–1263).

### 1.4 The one markup edit in index.html

The reference's strip leads with net P&L. `#dashHeroToday` currently lives in `.dash-now`, which the strip deletes. Move **two spans only** (neither carries `[data-metric]`; both are looked up by id):

```html
<!-- index.html:1493, as the FIRST child of section.dash-quad, before
     the Win Rate card. aria-label moves off .dash-stats onto .dash-quad
     because display:contents drops the group from the a11y tree. -->
<section class="dash-quad" aria-label="Performance metrics">
  <article class="metric-card dash-quad-card" data-card="today" data-card-name="Net P&amp;L today">
    <p class="metric-label">Net P&amp;L today</p>
    <p class="metric-value" id="dashHeroToday">$0</p>
    <span class="dash-now-sub" id="dashNowTodaySub"></span>
  </article>
  <!-- the six existing dash-quad-card articles, untouched -->
```

`class="metric-card dash-quad-card"` is load bearing: app.js:9722 does `node.closest(".metric-card")` for the positive/negative tone class.

Strip goes to **seven** columns:

```css
/* clay-v3.css:3309, edited in place. */
#dashboard .dash-quad { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
#dashboard .dash-quad-card { padding: 11px; }
#dashboard .dash-quad-card .metric-value { font-size: clamp(18px, 1.2vw, 24px); line-height: 1.1; }
#dashboard .dash-quad-card .metric-label { font-size: 11px; line-height: 1.2; }
#dashboard .dash-quad-card [data-metric="avgWinLoss"] { font-size: 17px; white-space: nowrap; }
```

### 1.5 Height budget

`--chrome-h` measures **57** on the owner's window, so `.view.is-active { inset: var(--chrome-h) 0 0 0 }` gives `clientHeight` **1043**. `padding-block: 16px` leaves a **1011px** content box.

**At 1999 × 1100:**

```
padding-top                                16
row 1   .dash-head                         44
gap                                        12
row 2   strip                              92
gap                                        12
row 3   charts        0.46fr              386
gap                                        12
row 4   base          0.54fr              453
padding-bottom                             16
                                         ----
                                         1043   = clientHeight, exactly
```

Pool `= 1011 − (44 + 92) − 36 = 839`. `839 × 0.46 = 385.9`. `839 × 0.54 = 453.1`.

**Widths.** `--shell-w = min(1480px, 96vw)` (styles.css:3906) → content column **1480**. Twelve tracks with 12px gaps: `(1480 − 132) / 12 = 112.33`.

| span | px | who |
|---|---|---|
| 3 | 361 | balance tile · edge TV |
| 4 | 485 | discipline · playbook · each chart |
| 5 | 610 | calendar |
| 8 | 983 | `.panel-grid-analytics` |
| 9 | 1107 | `.dash-quad` |

Strip card: `(1107 − 6 × 8) / 7 = 151px`, **129px inside its 11px padding**. "Avg win / loss" at 11px mono is ~90px. Fits.

**Row 2 internals, 92px:**
```
label   11px / 1.2               13
gap                               3
value   clamp(18,1.2vw,24) / 1.1  26
gap                               3
sub     11px / 1.2               13
gap                               4
.dash-tile-meter                  4
padding 11 + 11                  22
border  1 + 1                     2
                                ---
                                 90    (2px slack)
```
Type floor: every string is 11px or larger.

**Row 3 internals, 386px.** `.panel-head` 30 + 1px rule + 12/12 body padding = 55 chrome → **331px canvas**. Today's authored `data-height` is 240 (equity) and 180 (drawdown). Both gain.

**Row 4 internals, 453px.**

*Calendar, 610 × 453:*
```
panel padding 11 + 11                     22
.mini-cal-open (11px month, 20px net)     24
flex gap                                   5
.mini-cal-weekdays 11px / 1               11
flex gap                                   5
.mini-cal-footrow                         20
flex gap                                   5
                                         ---
chrome                                    92
.mini-cal-grid                           361
  minus 5 row gaps at 4px                 20
  341 / 6 rows                        = 56px tall
  (610 − 22 − 6 × 4) / 7              = 80px wide
```
80 × 56 day tiles, against today's ~26px. `.mc-ix` at 10px in the corner, `.mc-amt` at `clamp(11px, 0.9vw, 14px)`. **This is the reference's month calendar with per-day money, larger than the hero card it replaces.**

*Edge TV, 361 × 453:* panel padding 22 → 339 × 431. `.dem-cmd` 26 → 405 left. `.dem-tv .bb-mon` carries `aspect-ratio: 16/9` → picture **339 × 191**. Remaining **214px** carries `.dem-news`, `.dem-screen` and the F1 key inside `.dem-panel`'s scrollport. 361px is *the width the rail already has today* (`clamp(300px, 23vw, 360px)`), so the TV is not smaller. It just stopped being 946px tall.

*Playbook, 485 × 453:* head 30 + padding 24 → `.dash-playbook-grid` gets 399px and scrolls past ~5 setups.

**At 1440 × 900:** `clientHeight` 843, content box 811, pool `811 − 136 − 36 = 639`. Row 3 `= 294`, row 4 `= 345`.
```
16 + 44 + 12 + 92 + 12 + 294 + 12 + 345 + 16 = 843
```
Row-3 canvas `294 − 55 = 239` (parity with today's 240). Row-4 calendar grid `345 − 92 − 20 = 233 / 6 = 38px` tiles, which still carries an 11px amount. `--shell-w = min(1480, 96vw) = 1382` → 12 tracks of 104.2; calendar 578, TV 341, charts 452.

### 1.6 Degradation, stated not discovered

```css
/* THE FLOOR. Below a 837px viewport the calendar tiles fall under 30px and
   the charts under 240. It degrades to exactly its 900px proportions and
   ADMITS it scrolls, rather than crushing. The customize dialog says so too. */
@media (min-width: 900px) and (max-height: 836px) {
  #dashboard.is-active { grid-template-rows: 44px 92px 294px 345px; overflow-y: auto; }
}

/* WIDTH, BY NAME NOT BY COUNTING. Below 1240 the strip drops to four cards
   and the second chart and the TV give their columns away. */
@media (min-width: 900px) and (max-width: 1239px) {
  #dashboard.is-active .dash-hero { grid-area: 2 / 1 / 3 / 5; }
  #dashboard.is-active .dash-quad { grid-area: 2 / 5 / 3 / -1;
    grid-template-columns: repeat(4, minmax(0, 1fr)); }
  #dashboard.is-active .dash-quad-card:nth-child(n + 6) { display: none; }  /* best / worst day */
  #dashboard.is-active .dash-quad-card:nth-child(4) { display: none; }      /* expectancy */
  #dashboard.is-active .dash-board-slot,
  #dashboard.is-active #propTracker { grid-area: 3 / 1 / 4 / 6; }
  #dashboard.is-active .panel-grid-analytics { grid-area: 3 / 6 / 4 / -1;
    grid-template-columns: minmax(0, 1fr); }
  #dashboard.is-active .panel-grid-analytics > .panel-span-4 { display: none; }
  #dashboard.is-active #dashMiniCal  { grid-area: 4 / 1 / 5 / 7; }
  #dashboard.is-active #dashPlaybook { grid-area: 4 / 7 / 5 / -1; }
  #dashboard.is-active .dash-edge-mini { display: none; }
}
```

**Below 900px: nothing above applies.** Every rule in §1 lives inside the existing `@media (min-width: 900px)` block. The phone keeps today's document flow, today's dock, today's scroll. No scroll is a desktop promise, and the repo already exempts the phone (styles.css:12125).

**Net:** 946px of sticky rail, 613px of hero tail and quad and footnotes, two 184px collapsed details, the 29-implicit-row hack and the 1239px order block all leave the column. 2003px becomes 1011px.

### 1.7 The one JS line in charts.js

```js
// src/modules/charts.js:1625 — was:
//   const height = Number(heightOverride || canvas.dataset.height || 280);
const height = Number(heightOverride) || canvas.clientHeight || Number(canvas.dataset.height) || 280;
```

`clientWidth` was already read this way. `data-height` stays as the fallback for a canvas measured while its view is `display: none`, where `clientHeight` is 0. **This touches every chart in the app**, so it lands alone as build step 1 with `tests/charts.smoke.mjs` green before anything else.

---

## 2. CUSTOMIZATION

### 2.1 The control

One button in `.dash-head`, one native `<dialog>` beside the eight already at the end of index.html.

```html
<!-- index.html:1287, after #dashSessionIntelligenceLink -->
<button id="dashCustomizeBtn" class="nav-btn dash-cust-btn" type="button" aria-haspopup="dialog">
  Customize<span id="dashPrivFlag" hidden>Balance hidden</span>
</button>
```

```html
<!-- index.html, with the other dialogs -->
<dialog id="dashCustomize" class="dash-cust" aria-labelledby="dashCustTitle">
  <form method="dialog" class="dash-cust-form">
    <h3 id="dashCustTitle">Customize the dashboard</h3>
    <p class="dash-cust-note">Uncheck what you do not want on screen. The dashboard does not scroll, so what you hide gives its room to what stays.</p>
    <p class="dash-cust-fit" id="dashFitNote">Fits this window.</p>

    <div class="dash-cust-presets" role="group" aria-label="Presets">
      <button class="btn dash-cust-preset" type="button" data-dash-preset="desk">Desk</button>
      <button class="btn dash-cust-preset" type="button" data-dash-preset="numbers">Numbers</button>
      <button class="btn dash-cust-preset" type="button" data-dash-preset="tape">Tape</button>
    </div>

    <div class="dash-cust-list" id="dashCustList"></div>
    <p class="dash-cust-split">These do not fit on one screen. Turning one on brings scrolling back.</p>
    <div class="dash-cust-list" id="dashCustExtra"></div>

    <label class="dash-cust-priv">
      <input type="checkbox" id="dashHideBalance" />
      <span>Hide the account balance</span>
    </label>

    <div class="dash-cust-actions">
      <button class="btn" type="submit" value="close">Close</button>
      <button class="btn primary" type="button" id="dashCustReset">Reset to default</button>
    </div>
  </form>
</dialog>
```

The Escape collision is **already neutralized**: the max-wall handler at app.js:15207 guards with `!document.querySelector("dialog[open]")`, and `showModal()` sets `[open]`.

### 2.2 The card registry: attributes only

Every customizable element gains two attributes in index.html. Nothing else. `data-card-fit="1"` puts it above the split line.

| element | `data-card` | `data-card-name` | fit? | default |
|---|---|---|---|---|
| `.dash-hero` (1353) | `balance-tile` | `Account balance` | yes | on |
| `.dash-quad` (1493) | `pulse` | `Pulse row` | yes | on |
| `.dash-board-slot` (1546) | `discipline` | `Discipline monitor` | yes | on |
| `.panel-grid-analytics > .panel-span-8` (1607) | `equity` | `Equity curve` | yes | on |
| `.panel-grid-analytics > .panel-span-4` (1673) | `drawdown` | `Drawdown curve` | yes | on |
| `#dashMiniCal` (1402) | `calendar` | `Month calendar` | yes | on |
| `#dashPlaybook` (1532) | `playbook` | `Playbook` | yes | on |
| `#dashEdgeMini` (1311) | `edge-tv` | `Live monitor` | yes | **on** |
| `.eq-footnotes` (1645) | `depth-strip` | `Trade counters` | yes | off |
| `#accountsPanel` (1694) | `accounts` | `Accounts` | no | off |
| `#dashLeonTape` (1715) | `leon` | `Leon tape` | no | off |
| `#adminPanelsMount` (1904) | `admin` | `Admin panels` | no | off |

`edge-tv` is **on by default**. It is the owner's TV, it is 361 × 453 in row 4 which is the width it already has today, and "it is on the Edge tab" is not the same as "it is on my dashboard". `depth-strip` is off but costs canvas height rather than page scroll when turned on, because it sits inside the fixed-height equity panel.

### 2.3 Off is an attribute on `<body>`, not `hidden`

`hidden` has two owners: `#propTracker` and `#dashLeonTape` set their own from data conditions (`renderPropTracker`, `renderDashLeonTape`). A boolean attribute fought over by two writers always loses, and the bug reads as "a prop tracker appeared on an account with no prop rules" with nothing pointing at layout code.

One space-separated attribute, native `~=` matching, zero per-element writes:

```css
/* styles.css, one block. Adding a card later is one line here plus two
   attributes in index.html. */
body[data-dash-off~="balance-tile"] #dashboard .dash-hero,
body[data-dash-off~="pulse"]        #dashboard .dash-quad,
body[data-dash-off~="discipline"]   #dashboard .dash-board-slot,
body[data-dash-off~="equity"]       #dashboard .panel-grid-analytics > .panel-span-8,
body[data-dash-off~="drawdown"]     #dashboard .panel-grid-analytics > .panel-span-4,
body[data-dash-off~="calendar"]     #dashboard #dashMiniCal,
body[data-dash-off~="playbook"]     #dashboard #dashPlaybook,
body[data-dash-off~="edge-tv"]      #dashboard .dash-edge-mini,
body[data-dash-off~="depth-strip"]  #dashboard .eq-footnotes,
body[data-dash-off~="accounts"]     #dashboard #accountsPanel,
body[data-dash-off~="leon"]         #dashboard #dashLeonTape,
body[data-dash-off~="admin"]        #dashboard #adminPanelsMount { display: none; }

/* Turning on a card that does not fit brings scrolling back, exactly as the
   dialog says it will. Nothing is clipped and nothing lies. */
@media (min-width: 900px) {
  #dashboard.is-active:has(> .panel-grid-bottom > *:not([hidden])),
  #dashboard.is-active:has(> #adminPanelsMount > *) {
    grid-template-rows: 44px 92px minmax(0, 0.46fr) minmax(0, 0.54fr) auto;
    overflow-y: auto;
  }
}
```

`:has()` support is unchanged: styles.css already ships `#terminal:has(.bb-wall[data-size="max"])`.

### 2.4 Storage schema

Single key, versioned, unknown keys ignored by construction.

```
key:   axiom_journal_dash_v1
value: {"v":1,"off":"depth-strip accounts leon admin","balance":"on"}
```

Three failure modes, all landing on "the dashboard the owner can see and fix from the dialog":

- **Corrupt / non-object / array JSON** → `{}` → the default off-set.
- **Unknown card id inside `off`** → matches no selector, hides nothing. Free.
- **Known card absent from `off`** → shown.

### 2.5 The JS

```js
/* app.js:1223, beside WALL_SIZE_KEY at 1222 and ABOVE the init() call.
   A new module-level const below init() is the TDZ boot trap that has shipped
   four crashes; tests/bootOrder.check.mjs fails the build if this drifts. */
const DASH_PREFS_KEY = "axiom_journal_dash_v1";
const DASH_OFF_DEFAULT = "depth-strip accounts leon admin";
const DASH_PRESETS = {
  desk: DASH_OFF_DEFAULT,
  numbers: "depth-strip accounts leon admin edge-tv playbook",
  tape: "depth-strip accounts leon admin playbook calendar"
};
```

Everything else is a hoisted function declaration, placed next to `applyWallSize`:

```js
function dashPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(DASH_PREFS_KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (error) {
    return {};
  }
}

/* Layout is CSS. This writes one attribute and redraws two canvases.
   It deliberately does NOT call renderAll(): renderAll -> renderWall ->
   grid.innerHTML, and rebuilding that DOM restarts every stream. */
function applyDashPrefs() {
  const prefs = dashPrefs();
  document.body.dataset.dashOff = typeof prefs.off === "string" ? prefs.off : DASH_OFF_DEFAULT;
  document.body.classList.toggle("balance-off", prefs.balance === "off");
  document.querySelectorAll("#dashboard [data-private]").forEach((node) => {
    node.dataset.countHash = "";        // force the next write past the hash guard
  });
  if (state.analytics) {
    renderDashboardMetrics(state.analytics);
    renderCharts(state.analytics);
  }
  syncDashFitNote();
}

function setDashPrefs(patch) {
  const next = { ...dashPrefs(), v: 1, ...patch };
  try { localStorage.setItem(DASH_PREFS_KEY, JSON.stringify(next)); }
  catch (error) { /* private mode: the choice still holds for this session */ }
  applyDashPrefs();
}

function setDashCard(card, on) {
  const off = new Set((document.body.dataset.dashOff || "").split(" ").filter(Boolean));
  if (on) { off.delete(card); } else { off.add(card); }
  setDashPrefs({ off: [...off].join(" ") });
}

/* THE CALIBRATION KNOB. The height budget is arithmetic on one screen size.
   This is the number on the screen actually in front of him. */
function syncDashFitNote() {
  const view = document.querySelector(".view.is-active");
  const node = document.getElementById("dashFitNote");
  if (!view || !node) { return; }
  const over = view.scrollHeight - view.clientHeight;
  node.textContent = over > 1 ? `Scrolls by ${over}px on this window.` : "Fits this window.";
}

function renderDashCustomize() {
  const off = new Set((document.body.dataset.dashOff || "").split(" ").filter(Boolean));
  const row = (el) =>
    `<label class="dash-cust-row"><input type="checkbox" data-card-toggle="${escapeHtml(el.dataset.card)}"${
      off.has(el.dataset.card) ? "" : " checked"
    } /><span>${escapeHtml(el.dataset.cardName || el.dataset.card)}</span></label>`;
  const all = Array.from(document.querySelectorAll("#dashboard [data-card]"));
  setHtml(document.getElementById("dashCustList"), all.filter((el) => el.dataset.cardFit).map(row).join(""));
  setHtml(document.getElementById("dashCustExtra"), all.filter((el) => !el.dataset.cardFit).map(row).join(""));
  const box = document.getElementById("dashHideBalance");
  if (box) { box.checked = document.body.classList.contains("balance-off"); }
  syncDashFitNote();
}
```

`setHtml` here writes into `#dashCustList` / `#dashCustExtra`, which are inside the dialog and are not ancestors of `.dem-tv` or `#bbWallGrid`.

### 2.6 Wiring

```js
// app.js:16251, beside the existing applyWallSize(getWallSize()):
applyDashPrefs();

document.getElementById("dashCustomizeBtn")?.addEventListener("click", () => {
  renderDashCustomize();
  document.getElementById("dashCustomize")?.showModal();
});
document.getElementById("dashCustomize")?.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "dashHideBalance") { setDashPrefs({ balance: target.checked ? "off" : "on" }); }
  else if (target.dataset.cardToggle) { setDashCard(target.dataset.cardToggle, target.checked); }
  renderDashCustomize();
});
document.getElementById("dashCustomize")?.addEventListener("click", (event) => {
  const preset = event.target.closest("[data-dash-preset]");
  if (preset && DASH_PRESETS[preset.dataset.dashPreset] !== undefined) {
    setDashPrefs({ off: DASH_PRESETS[preset.dataset.dashPreset] });
    renderDashCustomize();
  }
});
document.getElementById("dashCustReset")?.addEventListener("click", () => {
  try { localStorage.removeItem(DASH_PREFS_KEY); } catch (error) { /* nothing to clear */ }
  applyDashPrefs();
  renderDashCustomize();
});
```

One line added to the existing debounced resize at app.js:2033, next to `syncChromeHeight()`:

```js
syncDashFitNote();
```

### 2.7 Hiding the account balance

One guard, at the one place every money figure routes through, **above** the `countHash` early return so a toggle repaints in both directions:

```js
/* app.js:9503 */
function setCountUpValue(node, text, tween) {
  // The balance is off. A word, not a blank and not a row of dots: this file's
  // own NOW grid comment already settled that argument, a hole reads as a bug
  // and a word reads as a fact. It is real text, so a screen reader says it
  // and a copy-paste yields it, which a transparent overlay could not.
  if (node.dataset.private !== undefined && document.body.classList.contains("balance-off")) {
    node.dataset.countHash = "";
    node.textContent = "Hidden";
    return;
  }
  if (node.dataset.countHash === text) {
    return;
  }
  …
```

`data-private` goes on **eight** nodes in index.html, not one, or the balance is still on screen three panels over:

| line | node |
|---|---|
| 1370 | `[data-metric="accountBalance"]` |
| 1372 | `#dashHeroRange` |
| 1405 | `#miniCalNet` |
| 1443 | `#propEquity` |
| 1450 | `#propMll` |
| 1453 | `#propRoom` |
| 1366 | `#balanceOverrideNote` |
| — | `.account-row-meta`, written by app.js:11991 |

Both writers reach the metric node: the metrics loop at app.js:9716 and the balance-override path at 14463. Nodes that are not written through `setCountUpValue` (`#dashHeroRange`, `#miniCalNet`, `#balanceOverrideNote`, `.account-row-meta`) get the CSS half instead, which is the lazy half:

```css
body.balance-off [data-private]:not(.metric-value) { visibility: hidden; }
body.balance-off #dashboard #dashBalanceLabel::after { content: " (hidden)"; }
body.balance-off #dashPrivFlag { display: inline; }
#dashPrivFlag { margin-left: 6px; font: 600 11px/1 var(--font-mono); opacity: 0.7; }
```

`#startingBalance` and `#balanceOverride` are form `<input>`s inside `#deskSettings`, which is a closed drawer. They stay editable and are not hidden: hiding the field you type your balance into is a bug, not privacy.

---

## 3. WALL MODES

### 3.1 Five names, one attribute, one key

```js
// app.js:1225
const WALL_SIZES = ["band", "half", "solo", "stack", "max"];
```

No second axis, no second key, no rebuild path. **Migration is already written**: `getWallSize()` at 16391 and `applyWallSize()` at 16644 both gate on `WALL_SIZES.includes(...)`, so a stored value that is not on the list falls through to the fallback. Adding names cannot break a stored one; removing a name later degrades to the fallback, silently and correctly.

### 3.2 Default is `half`

"I want the only format to be half format" is an instruction about the resting state. Three literals change from `"band"` to `"half"`: app.js:16394, app.js:16645, and app.js:15213 (Escape out of max). In index.html:3129–3131 the `aria-pressed="true"` moves from `band` to `half`.

### 3.3 The switch

index.html:3129, same lowercase mono skin, two new tokens plus aria-labels on all five:

```html
<button class="bb-wall-tok" type="button" data-wall-size="band"  aria-pressed="false" aria-label="Strip across the desk">band</button>
<button class="bb-wall-tok" type="button" data-wall-size="half"  aria-pressed="true"  aria-label="Four monitors beside the desk">half</button>
<button class="bb-wall-tok" type="button" data-wall-size="solo"  aria-pressed="false" aria-label="One monitor beside the desk">solo</button>
<button class="bb-wall-tok" type="button" data-wall-size="stack" aria-pressed="false" aria-label="One large monitor above three small">stack</button>
<button class="bb-wall-tok" type="button" data-wall-size="max"   aria-pressed="false" aria-label="Every monitor, full screen">max</button>
```

The delegated click at app.js:15198 and the `aria-pressed` loop at 16671 already cover new tokens with **no change**.

### 3.4 The three column modes share the desk rules

Every `#terminal:has(.bb-wall[data-size="half"])` selector in styles.css (12016, 12053, 12073) and `.bb-wall[data-size="half"]`'s fixed column box (12028) becomes:

```css
#terminal:has(.bb-wall:is([data-size="half"], [data-size="solo"], [data-size="stack"]))
.bb-wall:is([data-size="half"], [data-size="solo"], [data-size="stack"])
```

Solo and stack inherit the reserved padding, the measured `--wall-w`, the `@media (max-width: 899px)` band fallback and the desk's single-column collapse for free.

One shared number, declared on the wall:

```css
.bb-wall { --wall-avail: calc(100vh - var(--chrome-h, 86px) - var(--wall-head-h, 57px)); }
```

### 3.5 SOLO — one 16:9 picture and its name row, centred

```css
.bb-wall[data-size="solo"] .bb-wall-grid {
  --pic-w: min(100%, calc((var(--wall-avail) - var(--mon-head-h, 26px)) * 16 / 9));
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  aspect-ratio: auto;
  width: var(--pic-w);
  height: calc(var(--pic-w) * 9 / 16 + var(--mon-head-h, 26px));
  margin-inline: auto;
  align-self: center;
  border: 0;
  gap: 1px;
}
/* ponytail: display:none, not a DOM move. The iframe document is not
   re-created, which is the contract; the browser may still drop the media
   pipeline, so a stream can resume at the live edge when it comes back.
   For a news channel that is correct. Upgrade if it ever matters: park the
   hidden three off screen instead of hiding them. */
.bb-wall[data-size="solo"] .bb-mon:nth-child(n + 2) { display: none; }
```

**1999 × 1100:** `--wall-avail` 986; `--wall-w = min(62vw, 986 × 16/9) = min(1239, 1753) = 1239`; the ratio arm gives `(986 − 26) × 16/9 = 1707`, so `--pic-w = 1239` and the block is `1239 × 9/16 + 26 = 723` inside 986. Picture **1239 × 697**, exactly 16:9, zero letterbox.
**1440 × 900:** avail 786; `--wall-w = min(892, 1397) = 892`; arm 1351; `--pic-w = 892`, block `502 + 26 = 528` inside 786. Still exact.

### 3.6 STACK — one big above three thirds

The pictures are `9W/16 + 3W/16`, so the picture block is 4:3 and the two name rows are added on top.

```css
.bb-wall[data-size="stack"] .bb-wall-grid {
  --pic-w: min(100%, calc((var(--wall-avail) - 2 * var(--mon-head-h, 26px)) * 4 / 3));
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: calc(var(--mon-head-h, 26px) + var(--pic-w) * 9 / 16) minmax(0, 1fr);
  aspect-ratio: auto;
  width: var(--pic-w);
  height: calc(var(--pic-w) * 3 / 4 + 2 * var(--mon-head-h, 26px));
  margin-inline: auto;
  align-self: center;
  border: 0;
  gap: 1px;
}
.bb-wall[data-size="stack"] .bb-mon:first-child { grid-column: 1 / -1; }
```

**1999 × 1100:** arm `(986 − 52) × 4/3 = 1245`, column 1239, so `--pic-w = 1239` and height `929 + 52 = 981` inside 986. Row 1 = `26 + 697`. Row 2 = 258, each small tile `412 × 232` → **1.775** against 1.778.
**1440 × 900:** arm `(786 − 52) × 4/3 = 979`, column 892, so `--pic-w = 892` and height `669 + 52 = 721` inside 786. It **narrows** rather than letterboxing, which is the rule half already follows and states at styles.css:12046.

### 3.7 The head is measured, not guessed

Both formulas read `--mon-head-h`, and under `(pointer: coarse)` the head is 48px, not 26. `applyWallSize` gains three lines beside the two measurements it already publishes, for the same reason its comment at 16660 gives about 34 versus 57:

```js
const monHead = document.querySelector("#bbWallGrid .bb-mon-h");
if (monHead) {
  const h = Math.round(monHead.getBoundingClientRect().height);
  if (h > 0) { document.documentElement.style.setProperty("--mon-head-h", `${h}px`); }
}
```

**BAND and MAX are untouched.** Below 1100px the column collapses to the bottom band half already defines, and solo and stack keep their grids inside it because both are expressed against `--wall-avail` and `100%`, never against a breakpoint.

Nothing in §3 calls `renderWall`, touches `#bbWallGrid.innerHTML`, or reorders a node.

---

## 4. THE MUTE FIX

### 4.1 Root cause

`wallEmbedUrl` (src/lib/wallLink.js:145) builds every src with `autoplay=1&mute=1&enablejsapi=1`, so YouTube paints its unmute affordance, title and watch-later chrome in the **top band** of the player. `.bb-mon-h` is `position: absolute; top: 0; left: 0; right: 0; z-index: 2` in **three** separate places — styles.css:9643 (`.dem-tv`), 11892 (max), 11980 (half) — and its children are `pointer-events: auto` at 11399–11402. Under `(pointer: coarse)` `.bb-mon-pick` and `.bb-mon-link` are forced to 44px, so our controls form a 44–52px band sitting **exactly on YouTube's unmute**. The tap lands on the channel select or the link button.

This is not a z-index accident. The overlay is doing what it was told, in the one place the player needs. Patching it per mode is how it got here: the comment at 11393 already records that the link button shipped invisible to the pointer in two of three sizes because hit testing was written per size. A fourth and fifth mode would inherit the same bug.

### 4.2 The fix: the masthead stops being an overlay

A row cannot overlap a picture it sits above. Delete the three absolute blocks and write one:

```css
/* ONE STATEMENT for every mode that is not the band. The masthead was an
   absolute scrim across the top of the picture in three places, which is
   exactly where YouTube paints its unmute under autoplay=1&mute=1. A row
   cannot overlap the picture below it, in any mode, present or future. */
.dem-tv .bb-mon-h,
.bb-wall:not([data-size="band"]) .bb-mon-h {
  position: static;
  z-index: auto;
  min-height: 26px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--term-line);
  background: var(--term-rail);
  font-size: 11px;
  letter-spacing: 0.04em;
  opacity: 1;
  transition: none;
}
.dem-tv .bb-mon-h em,
.bb-wall:not([data-size="band"]) .bb-mon-h em { display: none; }
.dem-tv .bb-mon,
.bb-wall:not([data-size="band"]) .bb-mon { grid-template-rows: auto minmax(0, 1fr); }
@media (pointer: coarse) {
  .dem-tv .bb-mon-h,
  .bb-wall:not([data-size="band"]) .bb-mon-h { min-height: 48px; }
}
```

**Deleted:** `.dem-tv .bb-mon-h` (9643–9656), its hover pair (9658–9659) and its reduced-motion rule (9679); `.bb-wall[data-size="max"] .bb-mon-h` (11892–11906), hover pair (11907–11908), reduced-motion rule (11913); `.bb-wall[data-size="half"] .bb-mon-h` (11980–11992) and hover pair (11993–11994). Three hover reveals go with them, and good: hover reveal was always a trap on the touch device this bug was reported from.

**Kept:** `.bb-mon-h { pointer-events: none }` and the `pointer-events: auto` children at 11399–11402. A name row that swallows a click into the picture is still wrong. **`.bb-mon-sound` is added to that list**, so the next control cannot be born pointer-dead the way `.bb-mon-link` was.

**The band mode already had a real row and never had this bug**, which is the evidence the fix is the right one.

**Cost, measured.** In half at 1999 × 1100 the grid is 1239 wide with `aspect-ratio: 16/9` giving 697 tall; each cell is `619 × 348`, each picture `619 × 322` → 1.92 against 1.778, about **7px of black on each side**. That is removed in the same pass rather than left as a follow-up nobody schedules:

```css
/* Half gets the same --pic-w treatment solo and stack use. Two name rows
   this time, so the ratio arm subtracts two heads. */
@media (min-width: 1100px) {
  .bb-wall[data-size="half"] .bb-wall-grid {
    --pic-w: min(100%, calc((var(--wall-avail) - 2 * var(--mon-head-h, 26px)) * 16 / 9));
    width: var(--pic-w);
    height: calc(var(--pic-w) * 9 / 16 + 2 * var(--mon-head-h, 26px));
    aspect-ratio: auto;
  }
}
```
At 1999 × 1100: arm `(986 − 52) × 16/9 = 1661`, column 1239, so `--pic-w = 1239`, height `697 + 52 = 749`. Cell `619 × 374`, picture `619 × 348` → **1.779**. Zero letterbox.

On the dashboard's `.dem-tv` at 339 wide the head is 26 of a 217px tile, which is 12 percent. It is the price of a control the owner can actually reach, and it is stated here rather than discovered.

### 4.3 And give him a mute we own

Clearing YouTube's control is the root-cause fix. The order was "I cant touch the mute." Do both. The command channel already exists and costs nothing: `enablejsapi=1` is on every src at wallLink.js:145.

**Markup**, in `monitorTile()` at app.js:16372, inside `<p class="bb-mon-h">`, before `.bb-mon-link`:

```js
`<button class="bb-mon-sound" type="button" data-on="0"
   aria-label="Sound on for monitor ${index + 1}">SOUND</button>`
```

**One branch** in the existing delegated document click at app.js:15176, **before** the `.bb-mon-screen` test (same reason `.bb-mon-full` goes first):

```js
const sound = event.target.closest(".bb-mon-sound");
if (sound) {
  const tile = sound.closest(".bb-mon");
  const on = sound.dataset.on !== "1";
  // ONE MONITOR CARRIES THE AUDIO. Four unmuted news desks is not a wall,
  // it is a riot, and the trader would have to mute three of them by hand.
  document.querySelectorAll(".bb-mon").forEach((other) => {
    if (other !== tile) { setMonitorSound(other, false); }
  });
  setMonitorSound(tile, on);
  return;
}
```

**One function declaration**, beside `playMonitor` at app.js:16709:

```js
/* The player's own command channel, opened by enablejsapi=1 in wallEmbedUrl.
   Targeted origin, never "*": this window posts into somebody else's frame. */
function setMonitorSound(tile, on) {
  const button = tile?.querySelector(".bb-mon-sound");
  const frame = tile?.querySelector("iframe");
  if (!button) { return; }
  if (frame) {
    frame.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func: on ? "unMute" : "mute", args: [] }),
      "https://www.youtube.com"
    );
  }
  button.dataset.on = on ? "1" : "0";
  // The VERB, not the state: the label says what pressing it does.
  button.textContent = on ? "MUTE" : "SOUND";
  const slot = Number(tile.dataset.slot || 0) + 1;
  button.setAttribute("aria-label", on ? `Mute monitor ${slot}` : `Sound on for monitor ${slot}`);
}
```

```css
/* 5ch and 4ch, so the row never reflows between the two words. */
.bb-mon-sound {
  min-width: 5ch; min-height: 0; padding: 2px 7px;
  border: 1px solid var(--term-line); border-radius: var(--radius-sm);
  background: transparent; color: var(--term-ink);
  font: 600 11px/1.2 var(--font-mono); letter-spacing: 0.06em; text-align: center;
}
.bb-mon-sound[data-on="1"] { color: var(--accent); border-color: var(--accent); }
/* No stream, no control. Pure CSS, no state to keep in sync. */
.bb-mon:not(:has(iframe)) .bb-mon-sound { visibility: hidden; }
@media (pointer: coarse) { .bb-mon-sound { min-width: 44px; min-height: 44px; } }
```

Add `.bb-mon-sound` to the `pointer-events: auto` group at styles.css:11400.

### 4.4 Why it cannot steal taps again

`tests/dashFit.check.mjs`, check 1: **no rule matching `.bb-mon-h` in styles.css, clay-v2.css or clay-v3.css declares `position: absolute`.** That is the assertion that stops mode six reintroducing this. Check 2: every string in `WALL_SIZES` has both a `[data-size="X"] .bb-wall-grid` rule and a `[data-wall-size="X"]` button, so a mode cannot ship half wired the way the link button once shipped pointer-dead.

---

## 5. TABS

**The honest rule: the page frame never scrolls, and at most one region inside it does.** A tab whose content is unbounded gets a fixed head and a scrolling list. That is what "no scroll" can mean for a table of every trade you have ever taken. Pretending otherwise means clipping rows, which is worse than scrolling them.

One attribute per view, not a new wrapper div in nine places:

```css
@media (min-width: 900px) {
  .view.is-active { display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; }
  /* min-height:0 is the load bearing half. Without it a grid item's automatic
     minimum size refuses to shrink and the FRAME overflows instead of the
     list, which is the interaction #terminal already documents at 12166. */
  [data-scrollport] { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
}
```

| view | verdict | how |
|---|---|---|
| `#dashboard` | **fits** | §1. Four rows, `overflow: hidden`, budget closes at 1043. |
| `#calendar` | **fits** | A month is at most 6 rows. `grid-template-rows: auto minmax(0,1fr) auto minmax(0,0.32fr)`; `#calendarGrid` gets `grid-auto-rows: minmax(0,1fr)`, the same construction `#dashMiniCal` already uses. `data-scrollport` on `#calendarAgenda`. Changing month changes tile size, never height. |
| `#terminal` | **fits** | Already its own instrument, already fixed, already owns the wall. |
| `#journal` | **one list** | `data-scrollport` on `.table-wrap` (index.html:2815). `.rev-head`, `.rev-chips` and `.rev-more` pin. `<thead>` gets `position: sticky; top: 0`. **Four hundred trades cannot fit on 1043px and must not pretend to.** The count is printed in `.rev-head`, so it is the answer and not a discovery: **"412 trades. 18 on screen."** |
| `#reflections` | **one list** | `data-scrollport` on `.panel-grid-two` (2844). `.view-head` pins. |
| `#monthly` | **one list** | `data-scrollport` on `.panel-grid-two` (2935). |
| `#trade-entry` | **one list** | `data-scrollport` on `.panel` (2434). Its fieldsets scroll under a pinned head, which is better than today: the submit button stops walking off the bottom. |
| `#playbook` | **sticky head** | Eight direct children and no wrapper, so the view scrolls and the head pins: `#playbook.is-active { display: block; overflow-y: auto } #playbook.is-active > .pb-head { position: sticky; top: 0; z-index: 3; background: var(--surface-1) }`. One line beats nine new divs. |
| `#session-intelligence` | **unchanged** | It already has its own scroll contract with a test behind it (`tests/sessionIntelligenceScroll.check.mjs`). Leave it alone. Add nothing. |

**Below 900px none of this applies.** Every rule lives in `@media (min-width: 900px)`. The views are in document flow, the dock owns the bottom, and pinning them fights the browser's own address bar, which styles.css:12125 already settled.

---

## 6. COPY SHEET

Every string below was written without an em dash, an en dash, or a dash entity. The guard (`tests/copyDashes.check.mjs`) has had an entity blind spot before, so these get re-read at review, entities included.

**Dashboard head**
- Button: `Customize`
- Privacy flag: `Balance hidden`

**Customize dialog**
- Title: `Customize the dashboard`
- Note: `Uncheck what you do not want on screen. The dashboard does not scroll, so what you hide gives its room to what stays.`
- Fit readout, fits: `Fits this window.`
- Fit readout, does not: `Scrolls by 118px on this window.` (number is live)
- Split line: `These do not fit on one screen. Turning one on brings scrolling back.`
- Short window, appended to the note under `@media (max-height: 836px)`: `This window is shorter than one screen needs, so the dashboard scrolls here.`
- Presets: `Desk` · `Numbers` · `Tape`
- Privacy row: `Hide the account balance`
- Actions: `Close` · `Reset to default`

**Card names** (`data-card-name`)
`Account balance` · `Pulse row` · `Discipline monitor` · `Equity curve` · `Drawdown curve` · `Month calendar` · `Playbook` · `Live monitor` · `Trade counters` · `Accounts` · `Leon tape` · `Admin panels`

**Strip tile label** (new)
`Net P&amp;L today`

**Hidden balance**
- Figure text: `Hidden`
- Label suffix: ` (hidden)`

**Wall tokens** (visible text stays lowercase mono; aria-label is the sentence)
| token | aria-label |
|---|---|
| `band` | `Strip across the desk` |
| `half` | `Four monitors beside the desk` |
| `solo` | `One monitor beside the desk` |
| `stack` | `One large monitor above three small` |
| `max` | `Every monitor, full screen` |

**Sound control**
- Muted: text `SOUND`, aria-label `Sound on for monitor 1`
- Unmuted: text `MUTE`, aria-label `Mute monitor 1`

**Journal head**
- `412 trades. 18 on screen.` (both numbers live)

---

## 7. BUILD ORDER

Eight steps. Each ends green before the next begins.

**1. The charts line, alone.**
`src/modules/charts.js:1625` → prefer `canvas.clientHeight`. Nothing else in the same commit. Run `node tests/charts.smoke.mjs`. Then open the app and look at performance bars, session charts and monthly views: the failure mode is silent and visual, not thrown.
*Verifiable:* smoke passes; every existing canvas renders at its `data-height` because none of them has a CSS height yet.

**2. The mute fix.**
Delete the three absolute `.bb-mon-h` blocks and their hover pairs and reduced-motion rules. Add the one static block. Add half's `--pic-w`.
*Verifiable:* at `data-size="half"`, `document.querySelector(".bb-mon-h").getBoundingClientRect().bottom <= document.querySelector(".bb-mon iframe").getBoundingClientRect().top`. YouTube's unmute pill is reachable.

**3. The sound button.**
`monitorTile()` markup, `setMonitorSound()`, the delegated branch, the CSS, `.bb-mon-sound` into the `pointer-events: auto` group.
*Verifiable:* play two monitors, press SOUND on the second, the first goes silent and its label reads `SOUND` again. `#bbWallGrid.dataset.sig` is unchanged across the whole interaction.

**4. Wall modes.**
`WALL_SIZES`, the three `"band"` → `"half"` literals, the five tokens, the `:is()` widening of the four desk selectors, `--wall-avail`, the solo and stack grids, the `--mon-head-h` measurement in `applyWallSize`.
*Verifiable:* each of the five tokens sets `#bbWall.dataset.size`, survives reload, and leaves `#bbWallGrid.dataset.sig` untouched. Solo and stack letterbox by 0px at 1999 × 1100.

**5. The dashboard grid.**
The `display: contents` promotion, the `[hidden]` restatement, the min-height guard, the four rows, every `grid-area`, the deletions listed in §1.3, the two degrade media blocks. Plus the single index.html move (`#dashHeroToday` into a new `.dash-quad-card`) and `repeat(7, …)`.
*Verifiable:* §8.

**6. The drawers.**
`#deskSettings` and `#dashDepth` as fixed bottom-right panels.
*Verifiable:* click the top bar's `#riskRulesBtn`. The desk settings open over the dashboard, `#rulesPanel` scrolls into view inside the drawer, and `#dashboard.scrollHeight === #dashboard.clientHeight` throughout.

**7. Customization and the balance.**
`DASH_PREFS_KEY` / `DASH_OFF_DEFAULT` / `DASH_PRESETS` at app.js:1223. The five function declarations. The dialog markup. The `body[data-dash-off~=]` block. The `setCountUpValue` guard and the eight `data-private` attributes.
*Verifiable:* `node tests/bootOrder.check.mjs` passes. Every checkbox toggles without `#bbWallGrid.dataset.sig` changing. `localStorage.setItem("axiom_journal_dash_v1", "not json")` then reload: the default dashboard appears.

**8. Tabs and the checks.**
`[data-scrollport]` on five nodes, the `.view.is-active` skeleton, the playbook sticky head, the journal count string. Write `tests/dashFit.check.mjs`. Run `node tests/mobileFloors.check.mjs`, `node tests/cssSanity.check.mjs`, `node tests/copyDashes.check.mjs`, `node tests/sessionIntelligenceScroll.check.mjs`.

**`tests/dashFit.check.mjs`** — one file, text scanning, no framework, in the style of `tests/mobileFloors.check.mjs`:

1. No rule matching `.bb-mon-h` in styles.css, clay-v2.css or clay-v3.css declares `position: absolute`.
2. Every string in `WALL_SIZES` has both a `[data-size="X"]` grid rule in styles.css and a `[data-wall-size="X"]` button in index.html.
3. The fixed px in `#dashboard.is-active { grid-template-rows }` plus its gaps plus its block padding sum to `136 + 36 + 32 = 204`, and `204 + 839 = 1043`. The arithmetic in this document is the assertion.
4. Every `#dashboard [data-card]` in index.html also carries `data-card-name`, so no card can appear in the dialog as a raw id.
5. Every id named in the `body[data-dash-off~=]` block appears as a `data-card` value in index.html, and vice versa.

TDZ needs no new check: `tests/bootOrder.check.mjs` already scans every `const`/`let`/`var` below `init();` against a four-name allowlist.

---

## 8. VERIFY

Run in the console with the dashboard active. Every number is an equality, not an eyeball.

### 8.1 At 1999 × 1100

```js
const d = document.getElementById("dashboard");
d.scrollHeight === d.clientHeight            // true. 1043 === 1043.
getComputedStyle(d).gridTemplateRows         // "44px 92px 386px 453px"
getComputedStyle(d).overflow                 // "hidden"
d.getBoundingClientRect().height             // 1043
```
- `.dash-quad` width **1107**; each `.dash-quad-card` **151**; seven of them.
- `.dash-hero` width **361**, height **92**.
- `#dashMiniCal` **610 × 453**; `.mini-cal-grid` day tile **80 × 56**.
- `#dashPlaybook` **485 × 453**.
- `.dash-edge-mini` **361 × 453**, `position: static`, `.dem-tv .bb-mon` **339 × 191**.
- `#equityChart.clientHeight === 331`, `#drawdownChart.clientHeight === 331`.
- `getComputedStyle(document.querySelector(".dash-stats")).display === "contents"`.
- Every `.metric-value` computes `font-size >= 11px`; every `.metric-label` computes exactly `11px`.
- `document.getElementById("dashFitNote").textContent === "Fits this window."`
- Wall at `half`: `.bb-wall-grid` **1239 × 749**; each `.bb-mon iframe` **619 × 348**; ratio **1.779**.
- Wall at `solo`: grid **1239 × 723**; the one visible iframe **1239 × 697**; ratio **1.7776**; three `.bb-mon` compute `display: none` and each still has a live `iframe` child in the DOM.
- Wall at `stack`: grid **1239 × 981**; row 1 iframe **1239 × 697**; each row 2 iframe **412 × 232**.
- Every `.bb-mon-h` bottom edge is `<=` its sibling iframe's top edge, in `half`, `solo`, `stack`, `max` and `.dem-tv`.
- Toggle every checkbox in the dialog once: `#bbWallGrid.dataset.sig` is byte-identical before and after, and no `.bb-mon iframe` was replaced (hold a reference and compare identity).

### 8.2 At 1440 × 900

```js
getComputedStyle(d).gridTemplateRows         // "44px 92px 294px 345px"
d.scrollHeight === d.clientHeight            // true. 843 === 843.
```
- `#equityChart.clientHeight === 239`.
- Calendar day tile height **38**; `.mc-amt` computed `font-size >= 11px`.
- Content column **1382**; `.dash-quad` **1017**, cards **139** each.
- Wall at `solo`: grid **892 × 528** inside 786 available.
- Wall at `stack`: grid **892 × 721**; it narrowed, it did not letterbox.
- Turn on `Accounts`: `#dashboard.scrollHeight > clientHeight` **and** the fit readout reads `Scrolls by Npx on this window.` The promise and the measurement agree.
- Resize to 1440 × 800: `grid-template-rows` becomes `"44px 92px 294px 345px"` from the `max-height: 836px` block and `overflow-y` is `auto`. It admits it.

### 8.3 At 375 × 812

- `getComputedStyle(d).display === "block"` and `position === "static"`. **Nothing in this spec applied.** The phone is byte-identical to `e999589`.
- `node tests/mobileFloors.check.mjs` passes across all three CSS files: no rule under 11px, no touch target under 44px. New surfaces audited: `.bb-mon-sound` (44 × 44 under `pointer: coarse`), `.bb-mon-h` (48px min-height under `pointer: coarse`), `.dash-cust-row input`, `.dash-cust-preset`, `.dash-cust-btn`.
- Wall at `half` on the phone: the `@media (max-width: 899px)` band rules still bind, the grid is 100% wide, and the static masthead is a real 48px row above each picture. Tap the YouTube unmute directly: it responds. Tap `SOUND`: it responds.

### 8.4 Storage

```js
localStorage.setItem("axiom_journal_dash_v1", "{{{");            // reload -> defaults
localStorage.setItem("axiom_journal_dash_v1", '["a","b"]');      // reload -> defaults
localStorage.setItem("axiom_journal_dash_v1", '{"v":1,"off":"nosuchcard playbook"}');
// reload -> playbook hidden, "nosuchcard" matches nothing, dashboard fits.
localStorage.setItem("axiom_journal_wall_size_v1", "quadrant");  // reload -> half
```

### 8.5 Regression tripwires

```
node tests/bootOrder.check.mjs
node tests/charts.smoke.mjs
node tests/mobileFloors.check.mjs
node tests/cssSanity.check.mjs
node tests/copyDashes.check.mjs
node tests/sessionIntelligenceScroll.check.mjs
node tests/dashFit.check.mjs
```

---

**Files touched:** `index.html`, `styles.css`, `clay-v3.css`, `app.js`, `src/modules/charts.js`, `tests/dashFit.check.mjs` (new).
**DOM nodes moved:** two (`#dashHeroToday`, `#dashNowTodaySub`).
**New module-level bindings:** three, all at app.js:1223, all above `init()`.
**Calls to `renderAll()` added:** zero.