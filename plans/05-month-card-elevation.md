# MONTH CARD FIX SPEC

## 1. VERDICT

Yes, it is a reasonable improvement: one screenshot shaped card with a big signed balance, a tone ramp calendar, and a spark ground beats the old banner plus scattered tiles. It is not the drastic raise the owner asked for, because it fails exactly where a flex screenshot is judged: a 148px dead top left corner, three layers overprinting in the bottom 100px, a positive wash that renders as a six cell green slab, and machine strings ($0, one decimal money, raw ISO dates) on the surface built to be photographed. The remaining work is composition and finish, not features.

## 2. COMPOSITION FIXES

The card becomes a four corner composition: identity line top left, month net top right, spark ground bottom left, calendar foot plus mark closing bottom right. All deltas in `clay-v3.css` unless noted.

**Dead corner (top anchor plus identity line).** Two of three critics say pull the date inside the frame; do it, because a 1200/630 crop must be self contained. The page greeting and action buttons in `.dash-head` stay where they are; only a one line date/greeting enters the card.

- `index.html` (inside `.dash-hero`, first child, above `.dash-hero-top`): `<p class="dash-card-date" id="dashCardDate" aria-hidden="true"></p>`
- `#dashboard .dash-month-card .dash-hero`: change `justify-content: center` to `justify-content: flex-start`; change `gap: var(--space-3)` to `gap: 16px`
- New rule: `#dashboard .dash-card-date { font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-faint); }`
- JS (in `renderDashboardMetrics`, top): `ui.dashCardDate.textContent = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase().replace(",", " ·");` producing `FRI · AUG 22`. Register `dashCardDate` in the `ui` map (app.js ~384).

**Range toggle home (chassis in the top row).** Critic 2's absolute bottom dock conflicts with the sparkline only floor rule; the top row seat wins because the label row is already its parent in the HTML. New rules (none exist yet):

- `#dashboard .dash-range { margin-left: auto; display: inline-flex; gap: 2px; padding: 2px; border-radius: 6px; background: var(--surface-inset); }`
- `#dashboard .dash-range-btn { font: 600 11px/1 var(--font-mono); padding: 5px 8px; border: 0; border-radius: 4px; background: none; color: var(--text-faint); cursor: pointer; }`
- `#dashboard .dash-range-btn.is-active { background: var(--surface-1); color: var(--text); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }`
- In the `@media (max-width: 899px)` block: `#dashboard .dash-range-btn { min-height: 44px; padding-inline: 12px; }`

**Sparkline treatment (dies at the gutter).** The spark owns only the bottom left; nothing overprints it again.

- `#dashboard .dash-month-card .dash-spark-wrap`: change both `-webkit-mask-image` and `mask-image` to `linear-gradient(to right, black 40%, transparent 62%)`. Everything else (absolute, 96px, z-index -1) stays.

**Bottom band (one closing baseline, no overlap).** Critic 1 wants foot and mark on one shared line; the geometry refuses (foot text ~240px plus mark ~144px cannot share a 326px column), so they stack: foot line, then mark in the true corner beneath it.

- `#dashboard .mini-cal`: change `align-self: center` to `align-self: stretch`; add `max-width: 326px; width: 100%; margin-left: auto;` (right aligned, so the month net lands in the top right corner on the identity line's baseline)
- `#dashboard .mini-cal-foot`: add `margin-top: auto; margin-bottom: 24px;`
- `#dashboard .month-card-mark`: change to `right: var(--space-6); bottom: var(--space-6);`

**EST chip stops wearing the win color.**

- `#dashboard .dash-est-chip`: change `border: 1px solid var(--pnl-pos-line)` to `border: 1px solid var(--surface-inset)`

## 3. DATA FIXES

All three formatting defects route through `src/lib/format.js` and `renderDashboardMetrics` / `renderDashMiniCal` in `app.js`. `formatStatMoney` already exists in `src/lib/format.js` and the working tree already wires most of this; the spec below is the contract to verify against, not new plumbing to invent.

**Money tiers (`formatStatMoney`, the only aggregate money formatter on the card):** below $1,000 whole dollars (`$305`); $1,000 to $9,999 whole with comma (`$2,273`); $10,000 and up compact one decimal (`$12.4K`). Cents and one decimal dollars never appear on aggregates.

**Avg win / loss (`renderDashboardMetrics`, the `avgWinLoss` block ~app.js:9384):** normal case `formatStatMoney(avgWin) / formatStatMoney(avgLoss)` giving `$305 / $130`; when `avgLoss === 0 && avgWin > 0` print `` `${formatStatMoney(avgWin)} · no losses` ``; when `avgWin === 0 && avgLoss > 0` print `` `no wins · ${formatStatMoney(avgLoss)}` ``. Never `$0`, never a dash. Anti wrap CSS: `#dashboard .dash-quad-card .metric-value { white-space: nowrap; font-variant-numeric: tabular-nums; }`

**Dates (the `[data-metric-sub]` writer, ~app.js:9475):** `node.textContent = formatChartDateLabel(day).toUpperCase()` so `2026-08-18` renders `AUG 18`, 11px mono, matching the card's kicker grammar.

**Foot strip (`renderDashMiniCal`, ~app.js:11910):** best day uses `formatStatMoney`, so `BEST +$1,048` below $10K, never a silently rounded `+$1K`.

## 4. THE WASH RULE

Delete `clay-v3.css` lines 2828-2829 (`.dash-month-card.is-pos/.is-neg .mini-cal-grid { background: ... }`). Tone may attach only to `.mini-cal-day.is-trade` through the existing `color-mix` intensity ramp; it may never paint the grid container, `.is-blank` cells, or untraded days, because a tint on a non day asserts P&L that does not exist. The month's verdict is already carried three ways: the 1px `--pnl-pos-line` ring on the card, the signed month net, and the tile ramp. One replacement voice, one line: `#dashboard .dash-month-card.is-pos .mini-cal-foot { color: var(--pnl-pos); }` and the `--pnl-neg` mirror. (Critic 3's 6% tint on untraded days is rejected: it re-fabricates data one tile at a time.)

## 5. SIX-ROW RULE

The 326px cap gives 44px tiles (7 × 44 + 6 × 3 = 326), so a six row month stacks to roughly 360px against roughly 580px of column height: over 100px of guaranteed clearance instead of 3px. The foot is pinned with `margin-top: auto`, so five and six row months close on the identical baseline; the five row remainder becomes structured air between grid and foot, not a hole. `aspect-ratio: 1` on tiles stays, `min-height: 300px` on the card stays as the floor guard, no per row count special cases. (Critic 3's `grid-auto-rows: 1fr` with dropped aspect ratio is rejected: the cap achieves the same guarantee without making tiles non square.)

## 6. COPY SHEET

| Where | Was | Becomes |
|---|---|---|
| Card identity line (new) | (absent) | `FRI · AUG 22` |
| Avg win / loss tile | `$304.8 / $129.9` | `$305 / $130` |
| Avg win / loss, no losing trades | `$87.4 / $0` | `$87 · no losses` |
| Avg win / loss, no winning trades | `$0 / $129.9` | `no wins · $130` |
| Best Day / Worst Day sub | `2026-08-18` | `AUG 18` |
| Foot strip best figure | `BEST +$1K` | `BEST +$1,048` |

No em or en dashes in any string; separators are the middle dot and the slash.

## 7. BUILD ORDER

1. **Wash:** delete `clay-v3.css:2828-2829`; add the `.is-pos/.is-neg .mini-cal-foot` color lines. Verify: pos month DOM shows no background on `.mini-cal-grid`, blanks transparent, ring intact.
2. **Calendar column:** apply the `.mini-cal` stretch/cap/right align, `.mini-cal-foot` pin, `.month-card-mark` corner. Verify: foot bottom and mark position identical for a 5 row and a 6 row test month.
3. **Hero band:** flip `.dash-hero` to `flex-start`, add `.dash-card-date` markup, CSS, and the `renderDashboardMetrics` writer. Verify: identity line baseline within 2px of the `MONTH` label baseline across the gutter.
4. **Toggle chassis:** add the three `.dash-range` rules plus the phone block. Verify: pill sits flush right in the label row at 1440, buttons at least 44px tall at 375.
5. **Spark mask plus EST chip:** shorten the mask to `40%/62%`, swap the chip border to `var(--surface-inset)`. Verify: canvas pixels fully transparent right of the column gutter.
6. **Data formats:** confirm `formatStatMoney` tiers, the `avgWinLoss` three branch block, the `[data-metric-sub]` `formatChartDateLabel(...).toUpperCase()` call, and the foot's `formatStatMoney` best figure (most already in tree); add the `.dash-quad-card .metric-value` nowrap rule. Run `node tests/charts.smoke.mjs` and the check suite.

## 8. VERIFY

**At 1440 x 900, Aug 2026 data (Saturday start, six rows, +$2,273 on $52,273, wins Aug 17-21):**
- `.dash-card-date` top edge within 30px of card top; gap above `ACCOUNT BALANCE` label under 40px (was 148px of void)
- No element's box intersects the sparkline band right of 62% of card width; `.mini-cal-foot` bottom edge at least 40px above `.dash-spark-wrap` never applies (foot sits above the mark, mark bottom at 24px, foot bottom at 48px, no rect intersection between foot, mark, and painted spark pixels)
- `getComputedStyle(miniCalGrid).backgroundColor` is transparent in a positive month; the six leading blank cells have no visible fill
- Six row month: `.mini-cal` bottom at least 100px above card content bottom (was 3px); five row month: foot bottom Y equals the six row month's foot bottom Y
- `.dash-range` right edge within 2px of the hero column's content edge; active segment has `var(--surface-1)` background
- Avg win / loss tile renders one line (`scrollWidth <= clientWidth`), text `$305 / $130`; zero loss fixture renders `$87 · no losses`; Best Day sub reads `AUG 18`; foot reads `5 TRADED · 5 GREEN · BEST +$1,048`

**At 375 (mobile preset):**
- Card `aspect-ratio: auto` (the 1239px release holds); no horizontal page scroll
- Every `.dash-range-btn` and `.mini-cal-day` hit target at least 44px in its tallest dimension; `.mini-cal-foot` keeps `min-height: 44px`
- No text on the card below 11px computed font size
- Tiles remain real `<button>` elements with `data-date`, day click still routes to the journal (contract untouched)