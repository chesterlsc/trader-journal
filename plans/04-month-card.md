# BUILD SPEC: THE MONTH CARD

Trader Journal dashboard renovation. One developer, one day, vanilla CSS/JS. All work on branch `renovation/v2`. Every anchor below was verified against the working tree.

Invariants that govern every step:

- `#dashEdgeMini` (index.html:1312) is never moved, re-parented, or rebuilt. Every change below is column-1 sibling surgery. No new code may `innerHTML` any ancestor of it.
- All new JS is function declarations wired from `init()` (app.js:1233). Zero module-level `const` below `init()`.
- No em or en dashes, including entities, in any user-facing string. `tests/copyDashes.check.mjs` already scans app.js strings; step 1 widens its blind spot.
- Phone floors: text >= 11px, touch targets >= 44px, enforced by `tests/mobileFloors.check.mjs` across all three CSS files. No fixed pixel tile sizes at phone; tiles size from `minmax(0,1fr)` columns.
- All new CSS goes in clay-v3.css (loads last, wins ties). Dashboard rules are `#dashboard`-scoped at (1,1,0) to beat bare classes from styles.css/clay-v2.css.
- `prefers-reduced-motion`: nothing new animates. Keep it that way.

Decision locked (deviation from the concept sheet, on ground truth): Session intelligence stays its own view (`#session-intelligence`, index.html:1928). It is a full tabbed page whose `role=tablist` / `aria-controls` wiring, timezone controls, and drawer cannot move as a lone panel without breaking. The dashboard's reach is the existing `#dashSessionIntelligenceLink` button in `.dash-head`, which already exists and already works. Nothing else about the concept changes.

---

## 1. index.html surgery

### 1.1 Removals

| Element | Anchor | Fate |
|---|---|---|
| `section#riskStrip` (whole block: `.dash-risk-head`, `#riskDial` svg, `#riskDialArc`, `#riskDialValue`, `#riskState`, both `[data-risk-strip]` items, `#riskConsequence`, `#cooldownRulesBtn`) | index.html:1385 to 1425 | Deleted. Nothing replaces it in place; the mini calendar takes the deck's second cell. |
| `ul.cal-legend` (3 items) | index.html after `#calendarGrid` (the block ending "no trades") | Deleted. Replaced by `.cal-strip` (section 4). |
| `section.dash-rail` (7 metric cards) | index.html:1543 to 1589 | Section deleted as a layout concept. Best Day + Worst Day cards move into `.dash-quad`; the other five cards move into `.eq-footnotes` (1.3). |
| Avg R:R card in `.dash-quad` | index.html:1514 | Moved (not deleted) into `details#dashDepth`, keeping `data-metric="avgRR"` alive. Replaced in the quad by the Avg win / Avg loss card. |
| `data-tilt` attribute on the hero article | index.html:1354 | Removed. The share card does not tilt; a tilt transform would also become the containing block for the absolutely positioned sparkline. |

### 1.2 The month card (replaces `.dash-deck`)

`section.dash-deck` (index.html:1353) is renamed `section.dash-month-card` (drop `dash-deck` entirely; its old CSS goes inert). Children, in order:

1. The existing `article.metric-card.metric-card-balance.dash-hero.dash-reveal` **unchanged except**: `data-tilt` removed; one new chip inserted in `.dash-hero-top` after `#dashBalanceLabel`:
   ```html
   <span class="dash-est-chip" id="dashEstChip" hidden>EST</span>
   ```
   All ids stay: `dashBalanceLabel`, `balanceOverrideNote`, `[data-metric="accountBalance"]`, `dashFloatChip`, `dashHeroToday/Week/Range`, `.dash-range` buttons, `.dash-spark-wrap > #dashSparkline`. The canvas node is not touched; it repositions purely in CSS.
2. The mini calendar, full markup:
   ```html
   <div class="mini-cal" id="dashMiniCal">
     <button type="button" class="mini-cal-open" id="miniCalOpenBtn" aria-label="Opens the calendar">
       <span class="mini-cal-month" id="miniCalMonth">AUGUST</span>
       <span class="mini-cal-net" id="miniCalNet">$0.00</span>
     </button>
     <div class="mini-cal-weekdays" aria-hidden="true">
       <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
     </div>
     <div class="mini-cal-grid" id="miniCalGrid"></div>
     <button type="button" class="mini-cal-foot" id="miniCalFoot">AWAITING FIRST TRADE</button>
   </div>
   ```
   Day tiles are JS-rendered into `#miniCalGrid` (section 2.1). Nested-button illegality is avoided by design: the open button is the head, the foot is a second route, the grid sits between them and holds its own per-day buttons.
3. The brand mark, last child of the card:
   ```html
   <p class="metric-label month-card-mark" aria-hidden="true">TJ &middot; traderjournal.space</p>
   ```

### 1.3 Other dashboard moves (column 1 only, source order top to bottom after surgery)

1. `.dash-head` (1252): untouched. `#dashSessionIntelligenceLink` stays.
2. `aside#estimatedAnalyticsNotice` (1299): **moved** inside `.dash-stats`, directly after `section.dash-month-card`. Id, `role="note"`, and all attributes kept. Restyled to a one-liner (section 3).
3. `#propTracker`: stays where it is (after the notice, inside `.dash-stats`), hidden unless armed.
4. `.dash-quad` (1498): keeps its class (no rename; app.js:9093 depends on `.dash-quad-card`). Now six cards: Win rate, Profit factor, Expectancy (unchanged), then:
   ```html
   <article class="metric-card dash-quad-card dash-reveal" style="--i: 5">
     <p class="metric-label">Avg win / loss</p>
     <p class="metric-value" data-metric="avgWinLoss">$0.00 / $0.00</p>
   </article>
   ```
   then the Best Day and Worst Day articles moved from `.dash-rail`, with `dash-rail-item` swapped for `dash-quad-card dash-reveal` (they keep `data-metric`, `data-metric-sub`, `data-metric-delta`).
5. `.dash-boards-playbook` / `#dashPlaybook`: untouched (already self-hides with zero setups).
6. `.panel-grid-analytics` (1620): keeps Equity (`panel-span-8`) and Drawdown (`panel-span-4`) only. Inside the Equity article, after `#equityScrub`, add:
   ```html
   <div class="eq-footnotes">
     <!-- the five .dash-rail articles for totalTrades, currentDrawdown,
          maxDrawdown, winningStreak, losingStreak, moved here verbatim,
          class="metric-card" only (drop dash-rail-item, dash-reveal, style) -->
   </div>
   ```
   Renderers select these by `data-metric`, so relocation is free.
7. `.panel-grid-bottom` (1745): becomes three `panel-span-4` panels: Discipline Monitor (change `panel-span-5` to `panel-span-4`), then `#accountsPanel` moved into the grid (add `panel-span-4`), then `#dashLeonTape` moved into the grid (add `panel-span-4`; its `display:none` under 900 rule keys on the id and survives). Edge Detection (`panel-span-7`) leaves for `#playbook` (1.4).
8. New, after `.panel-grid-bottom`:
   ```html
   <details class="panel panel-collapsible" id="deskSettings">
     <summary class="panel-collapse-summary">
       <div><h3>Desk settings</h3><p>Risk budgets, cooldown, pre-trade checklist</p></div>
       <span class="panel-collapse-toggle"><span class="toggle-label-closed">Show</span><span class="toggle-label-open">Hide</span></span>
     </summary>
     <div class="panel-collapsible-body">
       <!-- the Risk Controls section (index.html:1837, #riskForm intact)
            and section#rulesPanel (1907), moved here verbatim -->
     </div>
   </details>
   ```
   The `.panel-collapsible` / `.panel-collapse-summary` / `.panel-collapse-toggle` pattern already exists (styles.css:3363).
9. New, after `#deskSettings`:
   ```html
   <details class="panel panel-collapsible" id="dashDepth">
     <summary class="panel-collapse-summary">
       <div><h3>Locked analytics</h3><p>These charts fill in as you journal.</p></div>
       <span class="panel-collapse-toggle"><span class="toggle-label-closed">Show</span><span class="toggle-label-open">Hide</span></span>
     </summary>
     <div class="panel-collapsible-body">
       <p class="depth-caption" id="depthCaptionScore"></p>
       <!-- Trader Score article (index.html:1698) moved verbatim -->
       <p class="depth-caption" id="depthCaptionPsych"></p>
       <!-- Psychology article (1715) moved verbatim -->
       <p class="depth-caption" id="depthCaptionR"></p>
       <!-- R-Multiple article (1729) moved verbatim -->
       <!-- Avg R:R metric card from the old .dash-quad, verbatim -->
     </div>
   </details>
   ```
   Canvas ids (`traderScoreChart`, `psychologyChart`, `rMultipleChart`) stay in the DOM at all times.
10. `#adminPanelsMount`: stays last.
11. `#dashEdgeMini`, `#dashboardEmptyState`, the "When your trading pays" panel: untouched, in place.

### 1.4 Playbook view additions

In `section#playbook` (index.html:2269), directly after `<div class="pb-stats" id="playbookStats">` (2288), insert a plain wrapper `<div class="pb-analytics">` containing, moved verbatim: the Strategy Performance article (index.html:1671, with its full `data-performance-dimension` / `data-performance-metric` toolbar and `#strategyPerformanceChart`), then the Edge Detection panel (1780, with `#edgeRows`). Strip their `panel-span-*` classes; they stack full width. Before moving, grep confirms the listeners are delegation-safe: `document`-level delegation covers `[data-playbook-setup]` (app.js:1833) and the performance toolbar handlers must be checked with `grep -n "data-performance" app.js`; if the toolbar listener is bound to the article rather than `document`, it moves with the node and nothing breaks; if bound to a dashboard ancestor, rebind it to the article in `init()`.

### 1.5 Calendar view head + shell

Replace the `.cal-head` block (index.html:2320 region) with:

```html
<header class="cal-head">
  <div class="cal-head-copy">
    <h2 id="calendarHeading">Calendar</h2>
    <p id="calendarMeta" class="cal-meta" aria-live="polite">No trades this month.</p>
  </div>
  <div class="cal-net">
    <p class="cal-net-label">Month net</p>
    <p class="cal-net-value" id="calendarNet">$0.00</p>
  </div>
  <div class="cal-nav">
    <button id="calPrevBtn" class="cal-nav-btn" type="button" aria-label="Previous month">&lsaquo;</button>
    <button id="calNextBtn" class="cal-nav-btn" type="button" aria-label="Next month">&rsaquo;</button>
    <label class="cal-jump"><span class="visually-hidden">Jump to month</span><input id="dashboardCalendarMonth" type="month" /></label>
  </div>
</header>

<div id="calendarGrid" class="calendar-grid" aria-label="Trading calendar"></div>
<p class="cal-strip" id="calendarStrip" hidden></p>
<div id="calendarAgenda" class="cal-agenda" aria-label="Trading days this month"></div>
```

All ids identical to today; the only structural change is `.cal-net` promoted out of `.cal-head-side` to a direct grid cell, plus the two new empty containers.

---

## 2. app.js

Add ui map entries (in the existing `ui` object near app.js:300-800, which is above `init()` and safe): `dashEstChip`, `miniCalMonth`, `miniCalNet`, `miniCalGrid`, `miniCalFoot`, `miniCalOpenBtn`, `dashMiniCal`, `deskSettings`, `dashDepth`, `depthCaptionScore`, `depthCaptionPsych`, `depthCaptionR`, `calendarAgenda`, `calendarStrip`. Delete entries: `riskStrip` (419), `riskDialArc` (385), `riskDialValue` (386), `riskDial`, `riskState`, `riskConsequence`, `cooldownRulesBtn` (388).

### 2.1 Functions added (all top-level `function` declarations)

**`function renderDashMiniCal()`** placed next to `renderCalendarView` (app.js:11642). Called from `renderAll()` immediately after the `renderCalendarView()` call at app.js:8117, and nowhere else (`renderAll` is the master path, already invoked from `init()` and every data change). Logic:

- `const monthValue = toDateInputValue(new Date()).slice(0, 7);` always the real current month, independent of `#dashboardCalendarMonth`.
- Reuse `buildCalendarDayStats(monthValue)` (app.js:11777). No duplicate aggregation.
- Month net = sum of `stats.pnl`; write `formatSignedCurrency` into `#miniCalNet`, tone with `toneBySign`.
- `#miniCalMonth` = `new Intl.DateTimeFormat("en-US", { month: "long" }).format(now).toUpperCase()`.
- Grid innerHTML (writes only into `#miniCalGrid`, never near `#dashEdgeMini`): leading `<span class="mini-cal-day is-blank" aria-hidden="true"></span>` per `startOffset`; then per day:
  - untraded past: `<span class="mini-cal-day">12</span>`
  - traded: `<button type="button" class="mini-cal-day is-trade pnl-positive|pnl-negative" data-date="YYYY-MM-DD" style="--day-intensity:0.75" title="+$412, 6 trades" aria-label="6 trades on August 12, up $412, review in the journal"></button>` with the day number as text. Intensity uses the same 4-step ramp math as `renderCalendarView` (Math.ceil(clamp(abs/max)*4)/4).
  - today: add `is-today`; future: `<span class="mini-cal-day is-future">27</span>`.
- Foot: `#miniCalFoot` = `` `${traded} TRADED · ${green} GREEN · BEST ${signedCompact(best)}` `` when `traded > 0`, else `AWAITING FIRST TRADE`.
- Open button aria-label: `` `${monthName}, ${net >= 0 ? "up" : "down"} ${formatCurrency(Math.abs(net))} net, ${traded} trading days, opens calendar` `` so color is never the only signal at component level.
- Month tone: on the card element (`ui.dashMiniCal.closest(".dash-month-card")`) toggle `is-pos` when net > 0, `is-neg` when net < 0, neither at 0. Reserved for this card alone.

**`function openJournalDay(date)`**: the extracted body of `handleCalendarDayClick` (app.js:11761): set `ui.filters.dateFrom/dateTo`, `handleFilterChange()`, open `.rev-more`, `switchView("journal")`. One contract, three entry surfaces.

**`function handleCalendarDayClick(event)`** rewritten to:
```js
const cell = event.target.closest("[data-date]");
if (!cell || !event.currentTarget.contains(cell)) return;
openJournalDay(cell.dataset.date);
```
so the same handler serves `#calendarGrid` (existing listener at app.js:1944), and two new listeners in `init()`: `ui.calendarAgenda` and `ui.miniCalGrid`.

**`function wireDashDisclosures()`** called from `init()`:
- `ui.miniCalOpenBtn` and `ui.miniCalFoot` click: `switchView("calendar")`.
- `ui.dashDepth` `"toggle"`: if open, `renderCharts(state.analytics, { force: true })`. The `force` option exists (src/modules/charts.js:137, app.js:2081) and defeats the chart-hash gate that would otherwise skip repainting the zero-size canvases laid out while `display:none`.
- `ui.deskSettings`: no listener needed (forms, not canvases).

**`function openDeskSettings(target)`** called by nav handlers: `ui.deskSettings.open = true;` then `scrollDashboardTo(target || ui.riskForm)`. The deep-link guard, generalized: edit the existing handlers at app.js:1752 (`riskRulesBtn` -> `openDeskSettings(ui.rulesPanel)`) and app.js:1757 (`cooldownSettingsBtn` -> `openDeskSettings(ui.cooldownFieldset || ui.riskForm)`; drop `ui.cooldownRulesBtn` from that array, its DOM died with the risk card). Any future path targeting a panel inside a `details` routes through this function.

**`function renderDepthCaptions()`** called from `renderAll()` after `renderDashboardMetrics`. From `getClosedTrades()`: `total`, `mood` = trades whose psychology field is set and not "Not recorded", `withR` = trades with a non-null R, `qualify` = trades with both a named setup and a stop. Writes:
- `#depthCaptionPsych`: `` `${mood} of ${total} trades carry a mood tag. Tag one from the journal.` ``
- `#depthCaptionR`: `` `${withR} of ${total} trades carry an R multiple. R needs a stop price, add one in Full trade detail.` ``
- `#depthCaptionScore`: `` `The score builds from setups and stops. ${qualify} of ${total} trades qualify.` ``

### 2.2 Functions edited

- **`renderCalendarView()` (app.js:11642)**: full tile/meta rewrite per section 4. Specifically kills the literal em dash placeholder (`: "—"` in `cellBody`, ~app.js:11745) and the em dash inside the traded-cell aria-label (`— review in the journal`, ~app.js:11752), and every `"no trades"` visible string. Adds week-net cells, `#calendarStrip`, and `#calendarAgenda` rows (all detailed in section 4). Suppresses the `· most traded X` clause in `#calendarMeta` when the month holds exactly one distinct asset.
- **`renderDashboardMetrics(analytics)` (app.js:9119)**: add one write:
  ```js
  const awl = document.querySelector('[data-metric="avgWinLoss"]');
  if (awl) awl.textContent = `${formatCompactCurrency(analytics.avgWin)} / ${formatCompactCurrency(Math.abs(analytics.avgLoss))}`;
  ```
  `avgWin` / `avgLoss` are computed at app.js:8377-8378; verify they are on the returned analytics object near app.js:8460 and add them if absent.
- **`renderEstimatedAnalyticsBoundary()`**: after it sets the notice, mirror state to the chip: `if (ui.dashEstChip) ui.dashEstChip.hidden = ui.estimatedAnalyticsNotice?.hidden ?? true;` and set the chip `title` to the notice's full sentence.
- **`renderAccountSwitcher()`**: where it resolves the active account, set `ui.dashBalanceLabel.textContent = name ? "Account balance / " + name : "Account balance"`.
- **`openPlaybook()` / the playbook view-switch seam (app.js:8113 `isViewActive("playbook")` gate)**: after `renderPlaybookPage()`, call `renderCharts(state.analytics, { force: true })` so `#strategyPerformanceChart` repaints at real size on first view entry.

### 2.3 Excisions

- Delete `function renderRiskStrip` (app.js:9507 through its closing brace, past the dial writes at 9563-9570) and its call at app.js:8099. Grep `riskDial|riskState|riskConsequence|riskStrip` before deleting; any helper referenced only by this function (the consequence copy near app.js:9603) dies with it. `renderNavRisk` (app.js:2213, the `#navRiskGroove` "Room" readout), `renderCooldown` (the `#dashLogCooldownFlag` at app.js:10807 and the interlock dialog), and the whole risk engine are untouched.
- No sparkline seam code is needed: the existing debounced `resize` listener (app.js:1401-1409) calls `drawDashSparkline` on every viewport resize, and crossing the 899 seam is a resize. Verified, not assumed.

### 2.4 Test widening (Rack graft)

`tests/copyDashes.check.mjs:31`: the leading character class misses a template interpolation boundary, which is exactly how `` `${x} — review` `` shipped. Change:

```js
const PROSE_DASH = /[\w%)\]}][ \t]*(?:&mdash;|&ndash;|[—–])[ \t]*[\w(\[$]/;
```

and add one self-check: `assert.ok(PROSE_DASH.test("${net} — review"), "the scanner must catch a dash after an interpolation");`

---

## 3. CSS (all appended to clay-v3.css)

Specificity notes: dashboard blocks are `#dashboard`-scoped, (1,1,0), beating styles.css/clay-v2.css bare classes; clay-v3 also loads last so equal-specificity ties are won. The >=1025 density pass (clay-v3.css:502, panel padding 12px at line 524) applies to the two chart panels automatically and must not be touched. Tokens used are all pre-existing: `--surface-0/1/2`, `--surface-inset`, `--text`, `--text-faint`, `--accent`, `--pnl-pos`, `--pnl-neg`, `--pnl-pos-soft/line`, `--pnl-neg-soft/line`, `--clay-raised`, `--radius-xl`, `--font-mono`, `--fs-micro`, `--space-*`. No new hex families.

```css
/* THE MONTH CARD ------------------------------------------------- */
#dashboard .dash-month-card {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: var(--space-5);
  aspect-ratio: 1200 / 630;
  min-height: 300px;
  overflow: hidden;
  padding: var(--space-6);
  border-radius: var(--radius-xl);
  background: var(--surface-1);
  box-shadow: var(--clay-raised);
}
#dashboard .dash-month-card.is-pos { box-shadow: var(--clay-raised), 0 0 0 1px var(--pnl-pos-line); }
#dashboard .dash-month-card.is-neg { box-shadow: var(--clay-raised), 0 0 0 1px var(--pnl-neg-line); }
#dashboard .dash-month-card.is-pos .mini-cal-grid { background: var(--pnl-pos-soft); border-radius: 8px; }
#dashboard .dash-month-card.is-neg .mini-cal-grid { background: var(--pnl-neg-soft); border-radius: 8px; }

#dashboard .dash-month-card .dash-hero {
  position: static;            /* absolute spark resolves to the card */
  background: none; box-shadow: none; padding: 0;
  display: flex; flex-direction: column; min-width: 0;
}
#dashboard .dash-month-card .dash-hero-value {
  font-size: clamp(44px, 4.5vw, 64px);
  letter-spacing: -0.025em;
}
#dashboard .dash-month-card .dash-spark-wrap {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: 96px; z-index: -1; pointer-events: none;
  -webkit-mask-image: linear-gradient(to right, black 55%, transparent 92%);
  mask-image: linear-gradient(to right, black 55%, transparent 92%);
}
#dashboard .dash-month-card .dash-spark-wrap canvas { width: 100%; height: 100%; }
#dashboard .month-card-mark {
  position: absolute; right: var(--space-5); bottom: var(--space-4);
  opacity: 0.7; margin: 0;
}
#dashboard .dash-est-chip {
  font: 600 11px/1 var(--font-mono); text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--text-faint);
  border: 1px solid var(--pnl-pos-line); border-radius: 4px; padding: 2px 5px;
}

/* MINI CALENDAR --------------------------------------------------- */
#dashboard .mini-cal { display: flex; flex-direction: column; gap: 6px; min-width: 0; align-self: center; }
#dashboard .mini-cal-open {
  display: flex; justify-content: space-between; align-items: baseline;
  background: none; border: 0; padding: 0; cursor: pointer; color: inherit;
}
#dashboard .mini-cal-month {
  font: 600 11px/1 var(--font-mono); text-transform: uppercase;
  letter-spacing: 0.12em; color: var(--text-faint);
}
#dashboard .mini-cal-net { font: 700 20px/1 var(--font-mono); }
#dashboard .mini-cal-weekdays, #dashboard .mini-cal-grid {
  display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px;
}
#dashboard .mini-cal-weekdays span {
  font: 600 11px/1 var(--font-mono); color: var(--text-faint); text-align: center;
}
#dashboard .mini-cal-day {
  aspect-ratio: 1; border-radius: 6px; border: 0; padding: 0;
  display: grid; place-items: center;
  font: 400 11px/1 var(--font-mono); color: var(--text-faint);
  background: var(--surface-inset);
}
#dashboard .mini-cal-day.is-blank { background: none; }
#dashboard .mini-cal-day.is-trade { font-weight: 600; color: var(--text); cursor: pointer; }
#dashboard .mini-cal-day.is-trade.pnl-positive {
  background: color-mix(in srgb, var(--pnl-pos) calc(var(--day-intensity, 0) * 22% + 10%), var(--surface-1));
}
#dashboard .mini-cal-day.is-trade.pnl-negative {
  background: color-mix(in srgb, var(--pnl-neg) calc(var(--day-intensity, 0) * 22% + 10%), var(--surface-1));
}
#dashboard .mini-cal-day.is-today { box-shadow: inset 0 0 0 1px var(--accent); }
#dashboard .mini-cal-day.is-future { opacity: 0.45; }
#dashboard .mini-cal-foot {
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left;
  font: 600 11px/1.4 var(--font-mono); text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--text-faint);
}

/* PULSE ROW (existing .dash-quad restyled, 6 tiles) ---------------- */
#dashboard .dash-quad { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
#dashboard .dash-quad-card { padding: 12px; }
#dashboard .dash-quad-card .metric-value { font-size: 22px; }
#dashboard .dash-quad-card .metric-label { font-size: 11px; }

/* EQUITY FOOTNOTES ------------------------------------------------- */
#dashboard .eq-footnotes { display: flex; flex-wrap: wrap; gap: 4px 20px; margin-top: var(--space-3); }
#dashboard .eq-footnotes .metric-card {
  display: flex; gap: 8px; align-items: baseline;
  background: none; box-shadow: none; border: 0; padding: 0;
}
#dashboard .eq-footnotes .metric-label { font: 600 11px/1 var(--font-mono); text-transform: uppercase; margin: 0; }
#dashboard .eq-footnotes .metric-value { font: 600 13px/1 var(--font-mono); margin: 0; }

/* BOTTOM GRID ------------------------------------------------------ */
#dashboard .panel-grid-bottom { grid-template-columns: repeat(12, minmax(0, 1fr)); }
#dashboard .panel-grid-bottom > .panel-span-4 { grid-column: span 4; }

/* ESTIMATE ONE-LINER ----------------------------------------------- */
#dashboard .estimated-analytics-notice {
  font-size: 12px; padding: 4px 2px; background: none; border: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* DEPTH CAPTIONS --------------------------------------------------- */
#dashboard .depth-caption { font: 400 12px/1.5 inherit; color: var(--text-faint); margin: var(--space-3) 0 var(--space-2); }
```

Seam releases (the ratio guard is load-bearing; release below 1240, not 900):

```css
@media (max-width: 1239px) {
  #dashboard .dash-month-card { aspect-ratio: auto; }
}
@media (max-width: 899px) {
  #dashboard .dash-month-card { display: flex; flex-direction: column; gap: var(--space-4); padding: 16px; }
  #dashboard .dash-month-card .dash-hero-value { font-size: 36px; }
  #dashboard .dash-month-card .dash-spark-wrap {
    position: static; height: 72px; z-index: auto;
    -webkit-mask-image: none; mask-image: none;
  }
  #dashboard .mini-cal-weekdays, #dashboard .mini-cal-grid { gap: 4px; }
  #dashboard .mini-cal-day { border-radius: 8px; }
  #dashboard .mini-cal-foot { min-height: 44px; }
  #dashboard .dash-quad { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  #dashboard .dash-quad-card .metric-value { font-size: 18px; }
  #dashboard .panel-grid-bottom { grid-template-columns: minmax(0, 1fr); }
  #dashboard .panel-grid-bottom > .panel-span-4 { grid-column: auto; }
}
```

Phone tile arithmetic at 375: 375 - 2x16 card padding = 343; minus 6 gaps x 4px = 319; 319 / 7 = 45.57px per tile, clearing the 44px floor with the tiles as real per-day buttons. This depends on padding 16px and gap 4px exactly; if either is ever retuned below the floor, apply the fallback shape instead: the grid becomes inert spans and the whole `.mini-cal` routes through `#miniCalOpenBtn`. Desktop tiles compute to roughly 30 to 42px across the 1240 to 1600 window; they are mouse targets, defined only via `minmax(0,1fr)` columns (no fixed px), so the floor test has nothing to flag.

The old `.dash-deck`, `.dash-risk*`, `.dash-dial*`, and `.dash-rail*` rules in all three sheets: delete the dial CSS (`.dash-dial`, `.dash-dial-track`, `.dash-dial-fill`, `.dash-dial-copy`, `.dash-dial-value`, `.dash-dial-label`, `.dash-risk-*`, `.risk-strip*`) and the `.dash-rail` layout rules; grep each selector across the three files before deleting, keep anything shared (`.risk-strip-item` is only used by the dead card; confirm with grep).

---

## 4. Calendar view redesign

### Head (desktop)

```css
#calendar .cal-head { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: var(--space-4); }
#calendar #calendarHeading { font-size: 24px; font-weight: 700; }
#calendar .cal-meta { font-size: 12px; color: var(--text-faint); }
#calendar .cal-net-label { font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: 0.1em; }
#calendar .cal-net-value { font: 700 32px/1 var(--font-mono); }
```

`renderCalendarView` writes `#calendarHeading` as "August 2026" (already does), `#calendarMeta` as `12 trading days · 41 trades` plus ` · most traded MGC` only when the month holds two or more distinct assets. `#calendarNet` toned by `toneBySign` (already does). Nav arrows already 44px (`.cal-nav-btn`); month input unchanged.

### Grid (desktop): 8 columns

```css
#calendar .calendar-grid { grid-template-columns: repeat(7, minmax(0, 1fr)) minmax(88px, 0.6fr); }
#calendar .calendar-week-net {
  background: var(--surface-inset); border-radius: 8px; padding: 8px;
  display: flex; flex-direction: column; gap: 4px; justify-content: center;
}
#calendar .calendar-week-net span { font: 600 11px/1 var(--font-mono); text-transform: uppercase; color: var(--text-faint); }
#calendar .calendar-week-net b { font: 700 13px/1 var(--font-mono); }
```

`renderCalendarView` emits an 8th weekday header cell `<div class="calendar-weekday">Net</div>`, then relies on auto-flow: each Sunday-to-Saturday run fills columns 1 to 7 and the appended `<div class="calendar-week-net"><span>WK 1</span><b class="pnl-positive">+$412</b></div>` lands in column 8. Week net accumulates per row; at month end, pad trailing `calendar-cell-empty` cells through column 7, then append the final week net. A quiet month gets a spine of real weekly figures.

### Traded tile (desktop, min-height stays 108px)

Anatomy top to bottom: day number 11px mono top-left (`.calendar-cell-day`, unchanged), signed pnl 15px/700 mono (`.calendar-cell-pnl`, full form; the existing `.calendar-cell-pnl-compact` sibling remains for narrow widths, both signed, money never truncated), meta line `.calendar-cell-meta` reduced to `6 trades` at 11px; the asset name is appended (` · MGC`) only when `stats.topAsset` differs from the month's dominant asset, so a one-instrument book prints nothing. Intensity ramp (`--day-intensity`, 4 steps) and the clay raise/sink shadows from clay-v2 are kept; they are the brag. New aria-label, dash-free: `` `6 trades on August 12, up $412, review in the journal` ``.

### Empty day (desktop)

```html
<div class="calendar-cell calendar-cell-flat"><span class="calendar-cell-day">12</span><span class="visually-hidden">no trades</span></div>
```

Day number only, 11px mono `var(--text-faint)`, on `var(--surface-inset)`. The visible dash and the visible "no trades" are deleted; the state lives in the visually hidden span (screen readers hear "12, no trades"). Both confirmed em dash emissions in `renderCalendarView` (the `"—"` cell placeholder at ~app.js:11745 and the aria-label dash at ~11752) die here.

### What replaces the legend

`#calendarStrip`, rendered by `renderCalendarView`, shown whenever the month has one traded day or more:

```
GREEN 12 · RED 4 · BEST +$980 · WIN DAYS 75%
```

11px mono uppercase, `letter-spacing: 0.08em`, `color: var(--text-faint)`, centered. Sign already lives in the signed money on every traded tile, so WCAG 1.4.1 held without the legend; the strip spends the reclaimed pixels on real figures.

### Phone (<=899) at 375

The grid becomes pure tone, mini-cal grammar; the agenda rows below it are the touch path (Rack graft wins over the week strip, which would duplicate it: the week strip does not ship):

```css
@media (max-width: 899px) {
  #calendar .calendar-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; }
  #calendar .calendar-weekday:nth-child(8), #calendar .calendar-week-net { display: none; }
  #calendar .calendar-cell { min-height: 44px; padding: 6px; }
  #calendar .calendar-cell-pnl, #calendar .calendar-cell-pnl-compact, #calendar .calendar-cell-meta { display: none; }
  #calendar .cal-net-value { font-size: 24px; }
  #calendar .cal-agenda-row {
    display: grid; grid-template-columns: 64px minmax(0, 1fr) auto;
    align-items: center; gap: 12px; width: 100%; min-height: 52px;
    background: var(--surface-inset); border: 0; border-radius: 10px;
    padding: 8px 12px; margin-top: 6px; cursor: pointer; color: inherit;
    font-size: 13px;
  }
}
@media (min-width: 900px) { #calendar .cal-agenda { display: none; } }
```

Arithmetic: 375 minus the view's existing side padding (2x16 = 32) = 343; minus 6 gaps x 3px = 325; 325 / 7 = 46.4px cells, above both floors, and traded cells remain real buttons. `renderCalendarView` fills `#calendarAgenda` with one row per traded day, newest last:

```html
<button type="button" class="cal-agenda-row" data-date="2026-08-12">
  <span class="cal-agenda-date">Aug 12</span>
  <span class="cal-agenda-trades">6 trades</span>
  <b class="cal-agenda-net pnl-positive">+$412</b>
</button>
```

Rows route through the shared `handleCalendarDayClick` listener on `#calendarAgenda`. The old <=760 agenda-in-grid CSS (the mode that hid untraded days inside the grid) is deleted; `calendar-agenda-note` copy moves to `#calendarAgenda` when the month has zero traded days. Screenshot test: month name, big toned net, seven columns of toned clay, a weekly spine of signed figures, one stat strip, no legend, no repeated nothing.

---

## 5. The mini calendar (summary of the contract)

- **Home**: right cell of `.dash-month-card`; mount `#dashMiniCal`; renderer `renderDashMiniCal()` (section 2.1), reusing `buildCalendarDayStats` and the calendar's exact 4-step intensity ramp.
- **Geometry desktop**: 7 equal `minmax(0,1fr)` columns, 3px gap, tiles `aspect-ratio: 1`, radius 6px, roughly 30 to 42px in the 1240 to 1600 window. Head: month name 11px mono uppercase left, `#miniCalNet` 20px/700 mono signed right. Foot: one 11px mono line, `14 TRADED · 9 GREEN · BEST +$610`.
- **Geometry phone**: card padding 16px, gap 4px, tiles compute to 45.57px at 375, still per-day buttons; foot gets `min-height: 44px`.
- **Tile states**: blank leading offsets; untraded past = inset well, faint 11px day number; traded = intensity-ramped pos/neg wash, 11px/600 day number, `title="+$412, 6 trades"`; today = 1px inset accent ring; future = opacity 0.45. No money text on tiles; the tone ramp is the density.
- **Month net home**: the mini-cal head, `#miniCalNet`, toned by sign. The green month glow (`is-pos` line + soft wash behind the grid) belongs to this card alone.
- **Interactions**: tap head or foot = `switchView("calendar")`; tap a lit day = `openJournalDay(date)` (filter journal to that date, open More filters, switch to journal), the exact `handleCalendarDayClick` contract. Signed aria-label on the open button carries the month state in words.

---

## 6. Demotions ledger

| Panel | New home | Reached by |
|---|---|---|
| Risk left today (card, dial) | Dead. Engine survives as `#navRiskGroove` "Room" in the rail (app.js:2213), `#dashLogCooldownFlag` on Log a trade (app.js:10807), and the cooldown interlock dialog | Ambient; dialog's `#cooldownSettingsBtn` deep-links into `#deskSettings` |
| Risk Controls (`#riskForm`) + Pre-trade checklist (`#rulesPanel`) | `details#deskSettings`, dashboard bottom, closed by default | Scroll; RULES top-bar (`riskRulesBtn`); cooldown dialog. All routes call `openDeskSettings()` which sets `open` before scrolling |
| Strategy Performance (`#strategyPerformanceChart` + toolbar) | `#playbook` view, under `#playbookStats` | `#allSetupsBtn` ("All setups") on the playbook board; Playbook nav entry. `force: true` repaint on view entry |
| Edge Detection (`#edgeRows`) | `#playbook` view, under Strategy Performance | Same |
| Trader Score radar, Psychology, R-Multiple, Avg R:R tile | `details#dashDepth` ("Locked analytics"), dashboard very bottom, closed | Scroll; each headed by a live unlock caption so the drawer reads as a to-do list, not a graveyard. `force: true` repaint on toggle |
| Total trades, Current/Max drawdown, both streaks | `.eq-footnotes` under `#equityChart` | Always visible, selected by existing `data-metric` attributes |
| Best day, Worst day | `.dash-quad` pulse row | Always visible |
| Estimate banner | One-line 12px note under the month card + `#dashEstChip` in the card head; id and attributes kept | Always visible when live |
| Leon tape (`#dashLeonTape`) | `.panel-grid-bottom`, span 4, clamped | Visible >=900 as today |
| Session intelligence | Stays its own view | `#dashSessionIntelligenceLink` in `.dash-head` |
| Dies outright | Risk dial SVG + CSS, `.cal-legend`, every visible "no trades", the em dash placeholder and aria-label dash, `.dash-rail` as a layout concept, the Avg R:R pulse position (tile survives only inside `#dashDepth`) | |

---

## 7. Copy sheet (every new or changed user-facing string; zero dashes)

| Where | String |
|---|---|
| Balance label with account | `Account balance / MGC Topstep 50K` |
| EST chip | `EST` (title = the notice's full sentence) |
| Pulse tile label | `Avg win / loss` |
| Pulse tile value | `$182 / $96` |
| Mini cal foot | `14 TRADED · 9 GREEN · BEST +$610` |
| Mini cal foot, empty month | `AWAITING FIRST TRADE` |
| Mini cal day title | `+$412, 6 trades` |
| Mini cal day aria-label | `6 trades on August 12, up $412, review in the journal` |
| Mini cal open button aria-label | `August, up $1,240 net, 12 trading days, opens calendar` |
| deskSettings summary | `Desk settings` / `Risk budgets, cooldown, pre-trade checklist` / `Show` / `Hide` |
| dashDepth summary | `Locked analytics` / `These charts fill in as you journal.` / `Show` / `Hide` |
| Depth caption, psychology | `0 of 128 trades carry a mood tag. Tag one from the journal.` |
| Depth caption, R | `0 of 128 trades carry an R multiple. R needs a stop price, add one in Full trade detail.` |
| Depth caption, score | `The score builds from setups and stops. 0 of 128 trades qualify.` |
| Calendar meta, single asset | `12 trading days · 41 trades` |
| Calendar meta, multi asset | `12 trading days · 41 trades · most traded MGC` |
| Week net label | `WK 1` (through `WK 6`) |
| Cal strip | `GREEN 12 · RED 4 · BEST +$980 · WIN DAYS 75%` |
| Traded cell meta | `6 trades` (append ` · NQ` only when the day's asset differs from the month's dominant one) |
| Traded cell aria-label | `6 trades on August 12, up $412, review in the journal` |
| Empty cell hidden text | `no trades` (visually hidden only) |
| Agenda row | `Aug 12` / `6 trades` / `+$412` |
| Brand mark | `TJ · traderjournal.space` |

---

## 8. Build order (each step leaves the app working and tests green)

1. **Test first**: widen `PROSE_DASH` in tests/copyDashes.check.mjs (2.4). It must now FAIL on the current `renderCalendarView`. This is the red that step 2 turns green.
2. **Calendar view**: rewrite `renderCalendarView` (tiles, aria, meta clause, week nets, `#calendarStrip`, `#calendarAgenda`), swap the `.cal-head` markup, delete `.cal-legend`, add `openJournalDay` + the `handleCalendarDayClick` rewrite + the agenda listener, and the section-4 CSS. Verify: copyDashes, calendarParse, mobileFloors green; click a traded tile and an agenda row, both land in the journal filtered to that day.
3. **Risk card death + deskSettings**: delete `#riskStrip` markup, `renderRiskStrip` + call site + ui entries + dial CSS; wrap Risk Controls + `#rulesPanel` in `details#deskSettings`; add `openDeskSettings` and rewire the app.js:1752/1757 handlers. Verify: boots clean (bootOrder check), RULES and the cooldown dialog open the details and scroll, `#navRiskGroove` and the cooldown flag still update.
4. **Month card**: rename `.dash-deck`, strip hero `data-tilt`, add `#dashEstChip`, mini-cal shell markup, brand mark, month-card CSS with ratio guard and seam releases, move the estimate notice, edit `renderEstimatedAnalyticsBoundary` and `renderAccountSwitcher`. Verify at 1440 and 1240: card holds 1200/630, no overflow, sparkline fades under the tiles.
5. **Mini calendar renderer**: `renderDashMiniCal` + call in `renderAll` after app.js:8117, `wireDashDisclosures` mini-cal routes. Verify: tiles match the big calendar's tones for the same month; head tap opens calendar; lit day tap opens journal.
6. **Pulse + footnotes**: quad to six tiles (avgWinLoss renderer line, Best/Worst moved), rail deleted, `.eq-footnotes` populated and styled. Verify: all six pulse values and five footnotes render live; no `0.00` R anywhere on the plane of real data.
7. **Demotions**: Strategy + Edge into `#playbook` (grep listeners first per 1.4, `force: true` on view entry), the three locked panels + Avg R:R tile into `details#dashDepth`, captions renderer, toggle repaint. Verify: open playbook, strategy chart paints at size; open Locked analytics, all three charts paint on first toggle.
8. **Bottom grid + full pass**: `panel-span-4` x3 bottom grid, phone sweep at 375 (order, floors, ellipsis on the notice), then `node tests/*.check.mjs` all green plus the two smoke tests.

---

## 9. Verification checklist

**At 1440 x 900 (desktop, rail pinned or not):**
- [ ] `#dashboard.is-active` grid untouched: column 2 = `#dashEdgeMini`, sticky, stream playing before AND after a full data refresh (import a CSV while the TV plays; the stream must not restart).
- [ ] `.dash-month-card` measures exactly 1200/630 aspect (width/height within 1px), `min-height >= 300px`, no scrollbars inside, no content clipped at 1240 with the 84px pinned rail.
- [ ] Balance value renders between 44 and 64px; sparkline visibly fades under the mini-cal tiles (right-edge mask); TJ mark bottom-right at 70% opacity.
- [ ] A green month shows the 1px `--pnl-pos-line` ring on the month card and on no other card.
- [ ] Mini-cal: month net signed and toned; today ringed in accent; a lit day click lands in the journal filtered to that exact date with More filters open; head click lands on the calendar view.
- [ ] Pulse row: 6 tiles, no tile reads a permanent zero (Avg R:R is gone from the row).
- [ ] Equity panel shows 5 footnotes with live values; Strategy Performance and Edge Detection are absent from the dashboard and present and painting in Playbook.
- [ ] `#dashDepth` closed by default; opening it paints all three charts at non-zero size on the first toggle; each chart is headed by a caption with real counts.
- [ ] RULES button and cooldown dialog both open `#deskSettings` (details gains `open`) and scroll to the form.
- [ ] Calendar view: 8-column grid with week nets, no legend, no visible "no trades", no dash placeholders; `#calendarStrip` shows the four figures; meta omits "most traded" for a one-asset month.

**At 375 x 812 (phone):**
- [ ] Month card stacks: label row, balance 36px, chips wrapped, sparkline strip 72px un-masked, mini calendar full width, mark bottom-right; card ratio released.
- [ ] Mini-cal tiles measure >= 44px wide (assert `#miniCalGrid button` `getBoundingClientRect().width >= 44`); foot row >= 44px tall.
- [ ] Pulse = 3 x 2 grid, values 18px, labels 11px; estimate note is one ellipsized line.
- [ ] Calendar view: 7 tone-only columns, cells >= 44px tall, no money text in cells, week-net column hidden; agenda rows >= 52px tall, one per traded day, each landing in the journal day filter; nav arrows >= 44px.
- [ ] `#dashLeonTape` still `display: none`; bottom tab dock untouched.
- [ ] Resize desktop to phone and back: sparkline redraws at each size (existing resize listener), no ghost at stale dimensions.

**Automated:** `for t in tests/*.check.mjs; do node "$t"; done` all green, including the widened copyDashes (now catching JS interpolation-boundary dashes), mobileFloors across all three CSS files, bootOrder (no TDZ), calendarParse, and the charts/sessions smoke tests.