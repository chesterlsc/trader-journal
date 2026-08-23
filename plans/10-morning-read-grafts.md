# Judge grafts and mandatory corrections

## 1
Ledger Sheet's calendar re-encode, as a CHEAPER ROUTE to Morning Read's daily-P&L chart. Morning Read specs a new ~35-line drawDayBars in charts.js because drawBarChart (charts.js:1065) is horizontal-only (padLeft 138, rowGap = plotH/entries.length) — verified. But renderDashMiniCal (app.js:12259) already loops every day, already has monthMaxAbsPnl, already computes a 0-1 intensity, and already emits per-tile inline style. Emitting only days where stats.trades > 0 with style="--mag:{|pnl|/monthMaxAbsPnl};--sign:{±1}" and CSS-bar tiles gets the distribution chart with ZERO canvas code and zero new canvas-sizing bug. Try that first; fall back to drawDayBars only if the CSS bars can't carry a zero baseline cleanly. Morning Read is still right to KEEP the month calendar as well — I said the calendar is ugly, not absent.

## 2
Ledger Sheet's chrome cull stated as ONE rule, not enumerated per element: `#dashboard.is-active .metric-card { background:none; box-shadow:none; border:0; border-radius:0; min-height:0 }`. Morning Read reaches the same five-raised-surfaces endpoint but writes it as several scoped rules. One rule that kills styles.css:7501's min-height AND the chrome AND the 15px clip together cannot drift, and it is the same edit that makes the 26-29% per-tile dead space structurally impossible.

## 3
THE BOARD's four-rung height ladder for drawLineChart, with its honest floors named: >=200px full treatment with 4 gridlines at >=30px spacing; 140-200px rows=2, keep readout and date labels; 100-140px no gridlines/no y-axis/no date labels, padTop 14 / padBottom 4 (the sparkline budget at app.js:9823); <100px draw the figure and a 2px trend rule, not a chart. Morning Read mentions the ladder but does not specify the rungs. Ship them, plus Board's `Math.min` guard so plotH is never allowed below plotW/6 — without it a short screen produces a crisp lie instead of a squashed one.

## 4
The nice-number y-tick step (Board and Ledger Sheet both carry it; Morning Read does not). The clientHeight fix alone does NOT fix five labels that all read '$50.4K' — that is an independent defect at charts.js:1001. Six lines before the loop at charts.js:983: raw = (max-min)/rows; mag = 10 ** floor(log10(raw)); step = mag * [1,2,2.5,5,10].find(m => m*mag >= raw); first = ceil(min/step)*step — then draw via yFor(first + i*step), and drop the 14% headroom at charts.js:665 since the nice-number ceiling supplies it. Add the fallback to formatCurrency when two adjacent labels format identically, which is the silent lie on a large account.

## 5
THE BOARD's pre-planned calendar retreat, adapted as a forward option rather than a fallback: if the 468x398 calendar in Morning Read's band D still reads thin, the swap is one grid-area — no new code. Keep that written down in the CSS comment so the next person does not rebuild it.

## 6
THE BOARD's explicit .dem-tv max-height cap with its reasoning intact: the 16:9 tile eats the news column, and capping it hands the feed its height back BEFORE any scrolling is needed. Morning Read has max-height:173px as a bare number; carry Board's argument into the comment so nobody removes it.

## 7
THE BOARD's hard rule restated as a load-bearing CSS comment: NEVER display:none on any ancestor of the Edge iframe, in any state, at any breakpoint. Morning Read honours it but does not name it. The file already carries this warning at clay-v3.css:3549-3552 — extend it over the new rail placement.

## 8
Ledger Sheet's framing of WHY the restraint works, as the acceptance test rather than as prose: the emptiness must be pooled in one place on purpose next to the thing you read first, never distributed as slack into every box. Morning Read achieves this structurally (flex:1 last child) but should state it, because the failure mode is that someone later 'fills' a deliberate gap.

## 9
CORRECTION to graft into the winner from the code, not from any direction: keep [data-metric="accountBalance"] alive and unrenamed. app.js:14447 renderLiveEquity queries it by that exact attribute on every price poll, app.js:1030 METRIC_DELTA_SPECS keys off it, and app.js:9753 special-cases it for the card hairline. Morning Read's plan (new node data-metric="totalPnl", balance demoted to a 13px clause) is the only one of the three that does not break the live equity ticker. Do not adopt Board's rename.

## 10
MANDATORY, from The Ledger Sheet — fix the band B structure. `.dash-now` (index.html:1516) is nested inside `.dash-hero` (index.html:1490), so `display:contents` on `.dash-stats` promotes the hero and nothing below it. The Morning Read's `.dash-now > *:nth-child(1) { grid-area: 2 / 4 / 3 / 6 }` placements are inert while `.dash-hero` is itself placed at `2 / 1 / 3 / 4`. Two ways out, both cheap: (a) The Ledger Sheet's way — keep `.dash-now` nested and lay the six figures out inside the hero's own column, which needs zero HTML edits; or (b) move the `.dash-now` div in index.html out of `.dash-hero` to be a sibling under `.dash-month-card`, then add it to the display:contents list. Take (b) only if the seven-cell 1911px strip is worth an HTML move — but then the 'ONE raised surface with border-left dividers' trick dies, because a display:contents box paints nothing. Pick one and delete the contradiction; do not ship the spec as written.

## 11
MANDATORY, from The Ledger Sheet — the hero node. Do NOT relabel `[data-metric="accountBalance"]`. app.js:9703 feeds it `formatCurrency(analytics.accountBalance)` and app.js:8587 sets that to `currentBalance`; only the delta spec at app.js:1030 reads `totalPnl`. The Morning Read is already correct here (new `data-metric="totalPnl"` node in the initial HTML, picked up free by the `querySelectorAll` at app.js:377, plus three lines at app.js:9702/9720/9737). Keep that and make sure nobody 'simplifies' it back to a relabel.

## 12
From The Ledger Sheet — the calendar re-encode, and this is the laziest good idea in the whole set. The Morning Read writes a new ~35-line `drawDayBars` for the net-daily spine. The Ledger Sheet gets the same chart with zero new canvas code: filter `renderDashMiniCal`'s existing tile loop (app.js:12259) to days where `stats.trades > 0`, emit `style="--mag:…; --sign:…"`, and let CSS draw the bar off a centreline. `buildCalendarDayStats` already shapes the data. No new drawing routine, no new canvas-sizing bug, and it cannot regress the charts.js fix. Try this before writing drawDayBars.

## 13
From The Ledger Sheet — the `:has()` fallback for the hidden rail. `.dash-edge-mini` is `hidden` by default (index.html:1448). The Morning Read spans it `3 / 11 / 5 / -1` with no handling for that state, which leaves a 308px hole across bands C and D on a fresh account. Graft `#dashboard.is-active:has(.dash-edge-mini[hidden]) .panel-grid-analytics > .panel-span-8 { grid-column-end: -1 }` (and the same for the D-band boxes) so the board closes when the desk is off.

## 14
From THE BOARD — keep the drawdown as a shared-x underwater subplot instead of deleting it. The Morning Read gives the equity panel 353px and kills the drawdown chart entirely; THE BOARD splits 346px into 294 equity + 106 drawdown on the same x-axis. charts.js already has `options.underwater` (charts.js:655) that plots below a zero line, so this is a placement change, not new code. A drawdown you can see the SHAPE of beats two figures restating its endpoints — and it costs the equity curve only ~60px, leaving plot area near 3:1 either way.

## 15
From THE BOARD and The Ledger Sheet — the six-line nice-number y-tick step before the loop at charts.js:983, plus dropping the 14% headroom at charts.js:665. The Morning Read fixes the anamorphic squash but not the axis, and a crisp axis reading '$50.5K / $50.4K / $50.2K' five times in a 48px gutter is still mush. Both losers specify it identically; take it verbatim.

## 16
From THE BOARD — the four-rung height ladder in `drawLineChart`, with the numbers stated: >=200px full treatment; 140-200px two gridlines; 100-140px no axis, padTop 14 / padBottom 4, curve plus one inline last-value label; <100px draw the figure and a 2px trend rule, not a chart. The Morning Read mentions the ladder without rungs. Without the floor, the `max-height: 960px` degradation branch can still produce a crisp lie.

## 17
From The Ledger Sheet — state the rhythm as a hard cap, not a list of edits: three spacing values and two radii on the whole view, enforced by rule so it cannot drift. The Morning Read lists the literals to route through tokens; the Ledger Sheet frames it as a ceiling that makes the 31-padding/13-gap/10-radius state structurally unreachable. Same edits, better enforcement.

## 18
From THE BOARD — the reversibility test as a working rule. Its calendar decision ships with a pre-planned fallback that is 'one grid-area swap, no new code'. Apply that to every judgement call in The Morning Read (the `.eq-footnotes` DOM move, the deleted `.panel-head p`, the dropped 'This week' cell): if the user rejects it, the revert must be a grid-area or a display swap, never a rewrite. This user has rejected four attempts; the cost of attempt six being wrong should be minutes.

## 19
From The Ledger Sheet — the hero-size argument. The Morning Read sets 44px; the Ledger Sheet argues 64px and, more usefully, argues the DIRECTION of the fix: if the band around the lead figure reads as another hole, the answer is never to fill the gap, it is that the figure has not earned it. Keep 44px as the ship value, and keep 64px as the first lever if the first read still does not land.

## 20
From THE BOARD — the drawdown survives as a chart, not as three scattered figures. Morning Read deletes #drawdownChart's panel outright; BOARD's 918x294 equity over a 918x106 underwater subplot sharing one x-axis is a better instrument than maxDrawdown at 20px in band B plus currentDrawdown in a footnote row. Graft it as the equity panel's internal `grid-template-rows: minmax(0,1fr) 106px`, and keep the drawdown figures too — they are cheap.

## 21
From THE BOARD — the four-rung height ladder in drawLineChart, with its actual rungs: >=200px full treatment (4 gridlines, >=30px spacing); 140-200px rows=2; 100-140px no gridlines/no y-axis/no date labels, padTop 14 padBottom 4; <100px draw the figure and a 2px trend rule, not a chart. charts.js:632-634 currently reserves a flat 72px (padTop 42 + padBottom 30) regardless of height, so fixing charts.js:1625 alone converts an anamorphic lie into a crisp one. Ship the `Math.min` guard with it: plotH never below plotW/6.

## 22
From THE BOARD and THE LEDGER SHEET — the six-line nice-number y-tick step before the loop at charts.js:983, plus dropping the 14% headroom at charts.js:665. Morning Read omits this. drawPlotFrame draws at `valueAt(i / rows)` on raw data fractions, so five labels render '$50.5K/$50.4K/$50.2K/$50.1K/$49.9K' — a second, independent cause of the mush that the clientHeight fix does not touch, and a silent lie on large accounts where all five compact to '$500K'.

## 23
From THE LEDGER SHEET — build the net-daily-P&L bars as DOM, not a new canvas routine. Morning Read's only genuinely new drawing code is a 35-line drawDayBars plus a new canvas that needs its own sizing/dpr/hidden-view handling. The Ledger's approach — filter the existing renderDashMiniCal tile loop to `stats.trades > 0`, last 30, each carrying `style="--mag:...;--sign:..."`, absolutely positioned off a 50% centreline — reuses a shipped loop, inherits the theme tokens for free, and cannot regress getCanvasContext. Put it in Morning Read's cols 8-11 panel where #dailyPnlChart was going.

## 24
From THE BOARD — #dashRecent, the 11-row closed-trades ledger. ~12 lines over getClosedTrades().slice(-11).reverse(). Morning Read drops it entirely and gives band D's middle 629px to four playbook tiles. If any band has slack after the first build, the ledger is the read the trader actually performs and it currently lives one navigation away; it beats the playbook's 3rd and 4th tiles.

## 25
From THE BOARD — the pre-planned calendar escape hatch as a one-line `grid-area` swap. Morning Read keeps #dashMiniCal (correctly), but if the owner wants it larger or gone, having the swap already written means the response to the next verdict is one declaration, not a re-plan.