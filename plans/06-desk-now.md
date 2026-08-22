# BUILD SPEC — THE DESK, NOW (dash-month-card renovation, 379 -> 333)

Two horizons, one instrument. The card answers RIGHT NOW; the pulse row below keeps THIS MONTH's quality stats. No new files, no new deps. Everything lands in `index.html`, `clay-v3.css`, `app.js`.

Grafts taken: corner day index, full-dollar tile grammar (no `$`, K only at $10K+), hover wash deepen + verbatim tooltip, spark at 0.45 under captions, delta line drops the range-name prefix, budgets published as CSS comments. Graft dropped: the two hand-tuned month-length valves — replaced by a single `1fr`-row calendar grid inside a fixed 293px column (see §4), which closes every month length with zero JS.

---

## 1 LAYOUT (exact CSS deltas, `clay-v3.css`)

All under the existing `#dashboard .dash-month-card` block (line ~2822).

```css
#dashboard .dash-month-card {
  /* BUDGET, do not reopen the blank:
     card = 20 pad + 293 content + 20 pad = 333px at 1440.
     LEFT  573px: Zone A 98 + 14 + Zone B 84 + 14 + Zone C 83 = 293.
     RIGHT 330px: head 18 + 6 + weekdays 11 + 6 + grid 231(flex) + 6 + foot 15 = 293.
     Short months: the grid's 1fr rows stretch taller tiles into the same 231. */
  grid-template-columns: minmax(0, 1fr) 330px;   /* was 236px */
}

#dashboard .dash-month-card .dash-hero {
  min-height: 293px;
  padding: 0 0 83px;        /* was 76px: Zone C = 11 air + 72 spark */
  gap: 0;                    /* zones own their gaps explicitly */
}

#dashboard .dash-month-card .dash-hero-value {
  font-size: clamp(30px, 2.4vw, 34px);   /* was clamp(32px, 2.6vw, 40px) */
  margin-top: 4px;
}

/* Zone A delta line: the one survivor of .dash-hero-meta */
#dashboard .dash-hero-range {
  display: block;
  margin-top: 6px;
  font: 600 13px/14px var(--font-mono);
}
#dashboard .dash-hero-range.is-pos { color: var(--pnl-pos); }
#dashboard .dash-hero-range.is-neg { color: var(--pnl-neg); }

/* Zone B: THE NOW GRID */
#dashboard .dash-now {
  margin-top: 14px;
  padding-top: 7px;
  border-top: 1px solid color-mix(in srgb, var(--text) 8%, transparent);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));  /* fr, never fixed px */
  column-gap: 20px;
  row-gap: 18px;
}
#dashboard .dash-now-label {
  display: block;
  font: 600 11px/11px var(--font-mono);
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-faint);
  margin-bottom: 5px;
}
#dashboard .dash-now-fig { font: 700 17px/17px var(--font-mono); color: var(--text); }
#dashboard .dash-now-fig.is-pos { color: var(--pnl-pos); }
#dashboard .dash-now-fig.is-neg { color: var(--pnl-neg); }
#dashboard .dash-now-fig.is-idle { color: var(--text-faint); font-weight: 600; }
#dashboard .dash-now-fig.is-hot { color: var(--accent); }
#dashboard .dash-now-sub { font: 600 11px/1 var(--font-mono); color: var(--text-faint); }

/* Zone C: spark becomes ground, captions become figure */
#dashboard .dash-month-card .dash-spark-wrap {
  width: 59%;               /* was 56% */
  opacity: 0.45;            /* ground, not wallpaper */
}
#dashboard .dash-ground-caps {
  position: absolute; left: 0; bottom: 58px;
  width: 55%;
  display: flex; justify-content: space-between;
  font: 600 10px/1 var(--font-mono); color: var(--text-faint);
  letter-spacing: 0.06em; pointer-events: none;
}
```

Calendar column (replacing tile square-ness, same selectors):

```css
#dashboard .mini-cal { height: 293px; }
#dashboard .mini-cal-grid { flex: 1; grid-auto-rows: 1fr; }   /* .mini-cal is already flex-column */
#dashboard .mini-cal-day { aspect-ratio: auto; height: auto; border-radius: 7px; position: relative; }
```

Delete from `index.html` (lines 1373–1380): the `dashFloatChip` `<p>` and the `dash-hero-meta` div's `dashHeroToday`/`dashHeroWeek` spans. `dashHeroRange` moves directly under the balance value, un-hidden by the same updater. The ids `dashHeroToday`/`dashHeroWeek` are reborn inside Zone B (§3) so `ui.dashHeroToday`/`ui.dashHeroWeek` (app.js:381) keep resolving.

The `@media (max-width: 1239px) { aspect-ratio: auto }` release at 2998 stays; the card no longer declares a ratio anywhere, height comes from the 293 columns.

---

## 2 TILE ANATOMY

Tile box at 1440: column 330px, 7 `1fr` tracks, 3px gaps -> **44.57 x 36px** (36 = 231/6 rows; 5-row months auto-stretch to 43.8px, 4-row to 55.5px — taller never clips).

**Traded tile** (`.mini-cal-day.is-trade`), markup change in `renderDashMiniCal()` (app.js:11908, the `tiles.push` for the stats branch) — the single text node `${day}` becomes:

```html
<i class="mc-ix">19</i><b class="mc-amt">+1,037</b>
```

```css
#dashboard .mini-cal-day .mc-ix {
  position: absolute; top: 3px; right: 5px;
  font: 600 9px/1 var(--font-mono); font-style: normal;
  color: var(--text-faint); opacity: 0.7;
}
#dashboard .mini-cal-day .mc-amt {
  font: 700 11px/1 var(--font-mono);
  letter-spacing: -0.02em;
  color: var(--text);
}
#dashboard .mini-cal-day.is-trade:hover {
  filter: brightness(1.06);
  --day-intensity: calc(var(--day-intensity, 0) + 0.25);  /* one wash step deeper */
}
#dashboard .mini-cal-day.is-trade:focus-visible { box-shadow: inset 0 0 0 1px var(--accent); }
#dashboard .mini-cal-day.is-scratch {
  background: var(--surface-inset);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent);
}
#dashboard .mini-cal-day.is-scratch .mc-amt { color: var(--text-muted); font-weight: 600; }
```

**Money grammar** — one line in app.js, no new formatter file; `formatStatMoney` (src/lib/format.js:21) already tiers at $1,000/$10,000:

```js
const tileMoney = (v) => (v > 0 ? "+" : "") + formatStatMoney(v).replace("$", "");
```

| Day P&L | Renders | Glyphs | Width @11px mono (~6.6px/glyph) |
|---|---|---|---|
| +$1,036 | `+1,036` | 6 | ~40px in 44.6 — fits |
| +$183 | `+183` | 4 | ~26px |
| -$55 | `-55` | 3 | ~20px |
| +$12,400 | `+12.4K` | 6 | ~40px |
| $0, traded | `0` | 1 | scratch state |

The header net (`miniCalNet`) declares the currency once; tiles carry no `$`.

**States**, exactly:
- **Traded**: corner `mc-ix` day number 9px faint; `mc-amt` centered, 11px 700 `var(--text)`, always signed; existing 4-step wash `calc(var(--day-intensity)*22% + 10%)` unchanged. `title="+$1,036, 3 trades"` and the aria-label kept verbatim from the shipped renderer.
- **Scratch** (trades > 0, pnl === 0): `mc-amt` reads `0` in `--text-muted` on `surface-inset` + inset hairline, class `is-scratch` added in the `pnlClass` ternary's empty branch.
- **Untraded past**: unchanged shipped path — single centered 11px day number, `text-faint`, `surface-inset`. No corner index, no fake anatomy.
- **Future**: unchanged, opacity .45.
- **Today untraded**: centered day number, `color: var(--accent); font-weight: 600`, plus the existing `is-today` inset accent ring.
- **Today traded**: full money anatomy + the ring.
- **Blank lead/trail**: unchanged `is-blank`.

**Foot** (app.js:11916): replace the BEST line (duplicates the pulse row's Best Day) with:

```js
const red = [...dayStats.values()].filter((s) => s.pnl < 0).length;
const avg = dayStats.size ? round(net / dayStats.size) : 0;
ui.miniCalFoot.textContent = dayStats.size
  ? `${green} GREEN${red ? ` · ${red} RED` : ""} · AVG ${tileMoney(avg) === "0" ? "$0" : tileMoney(avg).replace(/^([+-])/, "$1$")}`
  : "AWAITING FIRST TRADE";
```

(AVG = month net / traded days: owner's August = 2273/5 = `AVG +$455`.)

Click contract untouched: tiles stay `<button data-date>` -> journal day filter; head/foot -> calendar view.

---

## 3 THE NOW ZONE

Markup, inserted in `index.html` after the balance value + `dashHeroRange`, replacing the deleted `dash-hero-meta` and `dashFloatChip`:

```html
<div class="dash-now">
  <div><span class="dash-now-label">Today</span>
       <span class="dash-now-fig" id="dashHeroToday">$0</span> <span class="dash-now-sub" id="dashNowTodaySub"></span></div>
  <div><span class="dash-now-label">This week</span>
       <span class="dash-now-fig" id="dashHeroWeek">$0</span></div>
  <div><span class="dash-now-label">Open P&amp;L</span>
       <span class="dash-now-fig" id="dashNowOpen">FLAT</span></div>
  <div><span class="dash-now-label" id="dashNowStreakLabel">Green streak</span>
       <span class="dash-now-fig" id="dashNowStreak">0 DAYS</span></div>
  <div><span class="dash-now-label">Next event</span>
       <span class="dash-now-fig" id="dashNowEvent">QUIET</span></div>
  <div><span class="dash-now-label">From highs</span>
       <span class="dash-now-fig" id="dashNowHighs">AT HIGHS</span></div>
</div>
```

Fill rules — five cells written by `renderBalanceCard(analytics)` (app.js:10022, which already owns `dashHeroToday`/`dashHeroWeek`; the `setChip` writes at 10044–10064 are rewritten):

| Cell | Source | Format | Idle state (never blank, never hidden) |
|---|---|---|---|
| TODAY | `analytics.todayPnl` (8537); trade count = trades with `trade.date === today` | `+$412` (`formatSignedCurrency`), sub `· 3 TRADES` 11px faint | `$0` idle-toned, sub `· NO TRADES` |
| THIS WEEK | sum `analytics.dailyPnl` (8514, a Map) for iso dates >= Monday of the current week | `+$2,273` | `$0` idle |
| OPEN P&L | `openFloatingPnl()` (13995) | `+$76` pos/neg | `FLAT` in `.is-idle` when `open === 0` — flat is information; the hide-at-zero behavior dies with `dashFloatChip` |
| GREEN STREAK | **new** ~6-line `currentDayStreak(analytics.dailyPnl)`: sort traded dates desc, walk while `sign(pnl)` matches the most recent traded day's sign; untraded calendar days between traded days do not break it (a weekend is not a loss). NOT `maxWinStreak` (8539, historical max) | `5 DAYS`; label flips to `RED STREAK` + `.is-neg` on a losing run | `0 DAYS` idle when no traded days |
| NEXT EVENT | `rankEvents(terminal.events, { now, currencies: tradedCurrencies(state.trades), minImpact: "Medium" })[0]` — same call the edge mini makes at 16441; `countdown` already imported at app.js:37 | `CPI · 46M` (minute granularity); under 10 min: `CPI · 9:59` with `.is-hot` | `QUIET` in `.is-idle` when events are empty, stale, feed down, or terminal gated — never a throw |
| FROM HIGHS | `analytics.currentDrawdown` (8532) | `-$184` neg | `AT HIGHS` in `.is-pos` when 0 |

Ticks: `renderLiveEquity` (14020, already runs on every price poll) also patches `dashNowOpen`. The NEXT EVENT cell is re-patched by the existing minute tick (the greeting tick at ~1915); inside the shipped 1s `tickCountdowns` (15134) add one guarded line that rewrites `dashNowEvent` only when the lead is under 10 minutes — the money card never re-renders per second above that window.

**Zone A delta line**: `dashHeroRange` keeps its updater block (10059–10064) but the copy becomes `+$1,922 · +7.8%` — value + `pct = base > 0 ? change / base * 100 : 0`, no `PAST MONTH` prefix (the lit range tab already names the period). Never hidden once `hasTrades`.

**Zone C captions**: in `renderBalanceCard`, after slicing equity for the range delta: `hi = Math.max(...slice)`, `lo = Math.min(...slice)` — computed here, the spark module (`src/modules/charts.js`) is not touched, the canvas is not touched, only its wrap's CSS moved. Write into `.dash-ground-caps` (aria-hidden): left `1M EQUITY` (relabels `3M EQUITY` / `ALL EQUITY` with the toggle), right `H $26,510 · L $23,981` via `formatStatMoney`.

Why these six: each can change within the hour (the NOW test). Every pulse-row figure below — win rate, PF, expectancy, avg w/l, best/worst day — changes on the month's timescale (the QUALITY test). Zero overlap; session state stays in the greeting.

---

## 4 COLUMN ARITHMETIC (1440, card 975, content 927 after 24px side padding)

**LEFT = 573px** (927 − 330 − 24 gap):

| Zone | Budget |
|---|---|
| A: hero-top row 40 + 4 + value 34 + 6 + delta line 14 | 98 |
| gap | 14 |
| B: 2 rows x (11 label + 5 + 17 fig = 33) + 18 row-gap | 84 |
| gap (7 hairline air + 7) | 14 |
| C: 11 air + 72 spark (absolute, bottom-anchored, inside the 83px padding) | 83 |
| **Total** | **293** |

NOW cells: `(573 − 2x20) / 3 = 177.67px` — built as `1fr` tracks so the edges close (fixed 177px would leave a 2px drift).

**RIGHT = 330px**, `.mini-cal` fixed `height: 293px`:

head 18 + gap ~6 + weekdays 11 + gap ~6 + **grid flex:1 = 231** + gap ~6 + foot 15 = **293**. (The shipped `mini-cal-open` is already a single baseline flex row — AUGUST left, 18px net right — no markup change.)

Six-row August 2026: 231 = 6x36 + 5x3, tiles 36px tall exactly as specced. Five-row month: same 231px grid, `1fr` rows stretch tiles to 43.8px. Four-row February: 55.5px. **Delta between columns: 0px in every month length** — the `1fr`-row grid is the only valve, published in the CSS budget comment, and it cannot desync because both columns are pinned to the same 293.

Card: 20 + 293 + 20 = **333px**, down 46 from 379, blank field 0 x 0.

Type cascade, unbroken: balance 34 > cal net 18 > NOW figures 17 > delta 13 > tile money 11 = labels 11 > ground caps 10 > tile corner 9.

---

## 5 PHONE (`@media (max-width: 899px)`, existing block at 3001)

- Tiles: already 44.6px wide via the shipped `margin-inline: -6px` bleed. Add `#dashboard .mini-cal-day { height: 44px; }` (touch floor) and `#dashboard .mini-cal { height: auto; }` (the 293 pin is desktop-only). Money line ships at 11px (meets the text floor).
- Corner index: `#dashboard .mini-cal-day .mc-ix { display: none; }` on phone — 10px would break the 11px floor, so it is not shipped; `aria-label` and `title` carry the date. Untraded tiles keep their centered 11px day number (they never render `mc-ix`).
- NOW grid: `grid-template-columns: repeat(2, minmax(0,1fr)); row-gap: 14px;` — 2x3, cells ~160px at 375.
- `.dash-ground-caps { display: none; }` (spark is static and unmasked on phone already, captions are desktop furniture).
- Balance keeps the shipped 36px override; spark wrap keeps the shipped static/72px block; `.dash-hero { min-height: 0; padding-bottom: 0; }` in this block since the spark is static here.
- Existing foot `min-height: 44px` and mark hiding stay.

---

## 6 COPY SHEET (owner's real Saturday, Aug 22)

```
Zone A row:   FRI AUG 22   ACCOUNT BALANCE   [EST]        1M 3M ALL
Balance:      $26,438.19
Delta line:   +$1,922 · +7.8%

NOW grid:     TODAY            THIS WEEK        OPEN P&L
              $0 · NO TRADES   +$2,273          FLAT
              GREEN STREAK     NEXT EVENT       FROM HIGHS
              5 DAYS           QUIET            AT HIGHS

  (live weekday variants: TODAY +$412 · 3 TRADES / OPEN P&L +$76 /
   NEXT EVENT CPI · 46M, then CPI · 9:59 in accent / FROM HIGHS -$184)

Ground caps:  1M EQUITY                    H $26,510 · L $23,981

Cal head:     AUGUST                                     +$2,273
Tiles:        17 +412 | 18 +183 | 19 +1,036 | 20 +526 | 21 +115
              (19 deepest wash, 21 lightest; 22 = bare accent-ringed "22")
Foot:         5 GREEN · AVG +$455              TJ · traderjournal.space
Losing month: 3 GREEN · 4 RED · AVG -$88
```

No em or en dashes anywhere in rendered copy; separators are `·`.

---

## 7 BUILD ORDER

1. **index.html**: delete `dashFloatChip` + the two `dash-hero-meta` chip spans; move `dashHeroRange` under the value; insert the `.dash-now` grid with the six cells (ids exactly as §3, reusing `dashHeroToday`/`dashHeroWeek`); add `.dash-ground-caps` div beside `.dash-spark-wrap`.
2. **clay-v3.css layout**: column 236 -> 330, hero padding 83, value clamp 30/34, `.dash-now` + `.dash-hero-range` + `.dash-ground-caps` rules, spark 59%/0.45, budget comment (§1). Verify card renders 333px before touching tiles.
3. **clay-v3.css calendar**: `.mini-cal` 293 pin, grid `flex:1` + `1fr` rows, tile `aspect-ratio: auto`, `.mc-ix`/`.mc-amt`/`.is-scratch`/hover/focus rules.
4. **app.js tiles**: `tileMoney` one-liner; traded-tile template gains `<i class="mc-ix">` + `<b class="mc-amt">`; scratch branch adds `is-scratch`; foot line -> GREEN/RED/AVG. Title/aria/click untouched.
5. **app.js NOW zone**: rewrite the 10044–10064 block — today cell (+trade count sub), week net over `dailyPnl` from Monday, delta line with inline pct, hi/lo captions from the sliced equity, `currentDayStreak` (new, ~6 lines), `currentDrawdown` cell, event cell via `rankEvents` with the QUIET fallback. `renderLiveEquity` writes `dashNowOpen` (FLAT at zero) and drops its chip branch.
6. **app.js ticks**: minute tick refreshes `dashNowEvent`; one guarded line in `tickCountdowns` (15134) for the under-10-minute mm:ss window.
7. **Phone block** (§5 deltas) in the 899 media query.
8. **Verify** (§8), both themes, then run the existing `tests/*.check.mjs` suite — no test references the deleted ids, but the smoke tests must still pass.

---

## 8 VERIFY (measurable)

1. At 1440: `.dash-month-card` height 333 ± 2px; `.dash-hero` and `.mini-cal` client heights both 293 ± 1px; no descendant of the hero column has `bottom > 293 + 20`.
2. Simulate a 5-row month (system date) — card height unchanged at 333, tiles measure ~44px tall, no gap under the calendar foot.
3. Every traded tile's `.mc-amt` `scrollWidth <= clientWidth` of its tile for the values `+1,036`, `-55`, `+12.4K` (inject via a test month); day 19 shows `+1,036`, not `+1.0K`.
4. Kill the events feed (empty `terminal.events`): NEXT EVENT reads `QUIET`, zero console errors. Set an event 8 minutes out: cell shows `mm:ss` in accent and updates each second; at 46 minutes it updates at most once per minute (assert no per-second writes above 10m).
5. With no open trades, `dashNowOpen` reads `FLAT` and is visible (`hidden === false`); `document.getElementById("dashFloatChip") === null`.
6. Streak: seed dailyPnl Mon–Fri green + Saturday today -> `5 DAYS`; append a red Friday -> label `RED STREAK`, fig `1 DAYS` -> render as `1 DAY` (singular guard); confirm the cell does NOT equal `analytics.maxWinStreak` when history holds a longer old run.
7. Contrast: at `--day-intensity: 1` on `pnl-negative`, dark theme, `.mc-amt` (`var(--text)`) vs the washed background >= 4.5:1; same check light theme and pos wash.
8. Phone 375: tile height >= 44px, money text 11px, `.mc-ix` not rendered/hidden, NOW grid is 2x3, all six cells visible, no horizontal scroll.
9. `dashHeroRange` shows `+$1,922 · +7.8%` form and re-renders on 1M/3M/ALL clicks together with the spark and the H/L caption (one control, three bindings).
10. Tile click still opens the journal filtered to `data-date`; head and foot still open the calendar view; hover on a traded tile deepens the wash and the shipped tooltip text is byte-identical to before.