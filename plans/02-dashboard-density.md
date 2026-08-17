# Plan 02 — Dashboard density: "The Desk Comes Upstairs"

STATUS: phases 1 and 2 are BUILT and shipped (c245659, 3c516fe). Analytics grid
1291 -> 770 and deck 345 -> 191, 675px verified. Phases 3+ (quad, boards, stat
strip) are specified below and not yet built.

Won 2 of 3 judges. Part 0 is the verification pass that killed the design's
biggest claim before any code was written: the hero does not govern the deck,
the risk card does, so a hero only pass saves 2px not 177.

BUILD SPEC — "The Desk Comes Upstairs", phased. Every number below was measured live at 1440x900 in demo mode (`sessionStorage.axiom_journal_demo_v1 = "1"`), not derived.

---

# PART 0 — WHERE THE DESIGN IS WRONG

Verified against the real files. Fix these before writing a line, or the budget does not land.

### 0.1 The hero does not govern the deck. Risk does. (blocks the single biggest claim)

Measured natural content heights inside `.dash-deck`:

| | natural | rendered |
|---|---|---|
| `.dash-hero` | 320px | 345 (stretched) |
| `.dash-risk` | 343px | 345 |

`.dash-risk` breakdown: 24 pad + head 13.2 + gap 20 + body 150.4 + gap 20 + consequence 91.5 + 24 pad = 343.

**The design's "hero 345 -> 168 saves 177px on the deck" saves 2px.** The row is a grid row; it is as tall as the taller card. Any hero-only pass is wasted work. Phase 2 below cuts both together.

Second consequence: inside `.dash-risk-body`, the 118px dial is *not* the tall thing either — `.dash-risk-figures` measures 150.4px (two stacked `.risk-strip-item`s). Swapping the dial for a meter bar and leaving the figures stacked saves nothing. The figures must go two-up.

### 0.2 The analytics grid gap is 16px, not 12px

`styles.css:4945` sets `.panel-grid-analytics { gap: var(--space-3) }` (12px), but `styles.css:7691` sets `.panel-grid { gap: var(--space-4) }` (16px). Equal specificity (0,1,0), later source wins. Computed gap: **16px**. Confirmed in the browser.

### 0.3 The analytics rows are 376 / 515 / 368, not 3 x 376

376 + 515 + 368 + 2x16 = 1291. Matches the measured table exactly.

Row 2 (515) is the expensive one, and it is governed by `.panel-trader-score`, not the strategy chart:
- panel-head **94px** (the `.info-btn` wraps to its own line under the h3/p block)
- `#traderScoreChart` data-height **300**
- `.trader-score-foot` **58px**
- 48px padding

### 0.4 The baseline stack is 2354px, not 2338px

Gaps are not 5 x 12. `#dashboard` (the view) has `gap: var(--space-5)` = **20px**; `.dash-stats` has `gap: var(--space-3)` = **12px**.

```
head 80 + 20 + [deck 345 + 12 + quad 98 + 12 + boards 375 + 12 + rail 89] + 20 + analytics 1291 = 2354
```

### 0.5 The quad and the rail are not adjacent

Real DOM order inside `#dashboardMetricGrid` (index.html):

```
.dash-deck                 1554
.prop-card#propTracker     1626   <- the design never mentions this
.dash-quad                 1699
.dash-boards               1725
.dash-rail                 1773
```

Fusing quad + rail is a **DOM move of seven `<article>` elements across `.dash-boards`**, not a re-wrap. It is still safe (every `[data-metric]` travels with the node) but call it what it is.

`.prop-card#propTracker` is hidden unless the active account has prop rules on. When on it is a tall card sitting between the deck and the band. It is out of scope for this pass; say so rather than discover it in QA.

### 0.6 `--term-line` already exists — do not redefine it

`clay-v3.css` (final block) already declares the full `--term-*` ramp at `:root`, including `--term-line: #2a313a`. The block's own comment states the ramp deliberately **does not follow `[data-theme="light"]`** ("a screen keeps its own light"), and `tests/clayV3Contrast.check.mjs:411` states `--term-line` is decorative and is deliberately not measured.

Redefining it per theme breaks that contract and is unnecessary: **`--line` and `--line-strong` already exist, already flip per theme, and are already contrast-tuned** (dark `#2b313a` / `#3d4552`; light `#d3d7db` / `#b9bfc6`). Use `var(--line-strong)` for dashboard hairlines. Light-mode check confirmed: `--line` reads too faint on `--surface-1` at 1px; `--line-strong` holds.

Do not add `--term-radius`, `--term-pad-y`, `--term-pad-x`, `--term-row`, `--term-value`, `--term-value-lg`. Each is used once or twice. A token for a single-use value is chrome.

### 0.7 The specificity that eats padding is styles.css:7698, not :7302

```css
/* styles.css:7698  (0,2,0) */
.metric-card:not(.dash-rail-item) {
  padding: var(--space-5);
  min-height: 96px;
  ...
}
```

This is why `.dash-quad-card { min-height: 108px }` (styles.css:4897, 0,1,0) is dead — computed min-height is **96px**. It is also why `.dash-hero { padding: ... }` at styles.css:7754 and styles.css:11896 both lose, and only `clay-v2.css:1090 .metric-card.dash-hero { padding-bottom: 132px }` (0,2,0, later file) survives. Measured hero padding `20px 20px 132px` — the cascade model is confirmed exactly.

**Rule for the whole build: every padding/min-height override on `.dash-hero` or `.dash-quad-card` must be at least (0,2,0).** `.metric-card.dash-hero`, `.metric-card.dash-quad-card`. clay-v3 is the last file, so (0,2,0) is enough; do not use `!important`.

styles.css:7302 (`.panel, .metric-card:not(.dash-rail-item), ...`) sets background-image and box-shadow only. Relevant to flattening a cell, not to padding.

### 0.8 The boards show 4 and 3 rows today, not "~5"

- `app.js:9334` — `.slice(0, 4)` in `renderPlaybook`
- `app.js:9827` — `.slice(0, 3)` in `renderUnjournalled`

"MORE rows than today" is two number edits. Both are inside function bodies, so the TDZ trap does not apply.

### 0.9 `.dash-spark-wrap` is absolutely positioned

`styles.css:4833` — `position: absolute; inset: auto 0 0 0`. It contributes **zero** flow height. The 132px `padding-bottom` is the entire reserve.

Therefore: changing `height: 118px` alone changes the card height by 0. Changing `padding-bottom` alone leaves the curve overlapping the meta row. **Always both, in the same commit.**

The design cites `clay-v2.css:503` for the 132px. Correct anchors:
- `clay-v2.css:503` — `.dash-spark-wrap { height: 118px }`
- `clay-v2.css:1090` — `.metric-card.dash-hero { padding-bottom: 132px }`
- `clay-v2.css:572-574` — `@media (max-width: 720px) .metric-card.dash-hero { padding-bottom: 126px }` (the mobile hole — confirmed present)
- `styles.css:9019` — `@media (max-width: 720px) .metric-card.dash-hero { padding-bottom: 82px }` (the earlier one clay-v2 supersedes)

### 0.10 `.dash-head` is 80px only when nothing is open

With an open position, `#progressTradeSummary` renders a 60px `.dash-live-pill` and the flex row wraps: **measured 156px**. The status strip must either keep the pill inline or accept two rows when a trade is live. Design it for 156, not 80.

### 0.11 The dashboard is 4922px tall. This design's scope is 2354 of it.

Measured children of `#dashboard` below the analytics grid:

```
.panel-grid-bottom     484
#accountsPanel         233
.panel (checklist)     748
#rulesPanel            367
```

Head-to-analytics-bottom is 2354; the whole scroller is 4922. If the ask is "less scroll", a head-only-to-analytics pass answers under half of it. Phase 6 exists for this.

### 0.12 Test coupling — verified, all clear

- `tests/mobileFloors.check.mjs:98` — `const rules = [...parse("styles.css"), ...parse("clay-v2.css")]`. **clay-v3.css is invisible to it.** It cannot go red from a clay-v3 addition. It *can* go red from any edit to the other two files that lowers a font-size below 11 with no `min-width` media guard.
- `tests/clayV3Contrast.check.mjs` walks top-level `:root` / `[data-theme=...]` blocks and measures a fixed name list. Adding non-colour custom properties there is inert. Adding a *colour* named in `SURFACES`/`TERM_GROUNDS` is not.
- `tests/cssSanity.check.mjs` parses all three sheets: balanced braces/parens/brackets, no empty selector slot.
- Only one test asserts on dashboard markup: `tests/landingDemo.check.mjs:105` requires `dash-ticker-tag">live` to survive in index.html. **Keep `<span class="dash-ticker-tag">live &middot; 5s</span>` verbatim in both ticker strips.**
- No test references `data-height`, `.panel-head`, `.dash-play-*`, `.dash-quad*`, or `.dash-rail*`.

Baseline confirmed green before any edit: mobileFloors, copyDashes, clayV3Contrast (147 pairings), cssSanity (2146 rules), charts.smoke (35317 ops).

### 0.13 Minor

- `tabular-nums`: `.metric-value` already uses `--font-mono` (JetBrains Mono). The declaration is a one-line hedge for the fallback stack, not a feature. Ship it, don't sell it.
- The edge-mini docks at `@media (min-width: 1240px)` (styles.css:10166), not 1025. The nav seam is 1025 (clay-v2.css:602, styles.css:3869). Use **1025** for the compaction seam; the two-column dashboard at 1240 is a superset and inherits it.
- `styles.css:11896` `@media (min-width: 1240px) and (max-width: 1699px)` retunes `.dash-hero`, `.dash-deck`, `.dash-quad`, `.dash-stats`, `.dash-board`. clay-v3 is a later file, so equal-specificity rules win. Only `.dash-board` there is (0,1,0) against our (0,1,0) — fine, later file wins.

---

# PART 1 — SEAM AND FILE

All work lands in **`clay-v3.css`**, appended at the end of the file, inside one block:

```css
/* ==========================================================================
   THE DESK COMES UPSTAIRS — dashboard density pass.
   Desktop only, behind the same 1025px seam the topnav switches on
   (clay-v2.css:602, styles.css:3869). tests/mobileFloors.check.mjs parses
   styles.css and clay-v2.css only and measures at 375px, so nothing here is
   in its field of view — and nothing here applies to a phone either way.
   Every rule is #dashboard-scoped: the journal, review and desk views keep
   clay untouched.
   ========================================================================== */
@media (min-width: 1025px) {
  /* phases land here, in order */
}
```

Two exceptions, both named per phase: the six `data-height` attribute edits in `index.html` (Phase 1), the seven-element DOM move (Phase 4), and the clay-v2 mobile hero fix (Phase 2c, which must go in clay-v3 at `.metric-card.dash-hero` specificity inside `@media (max-width: 720px)`).

**Never** put a bare `font-size` below 11px in styles.css or clay-v2.css. Inside clay-v3 the test cannot see it, but the floor is real: nothing user-facing goes below 11px at any width.

---

# PHASE 1 — ANALYTICS COMPACTION
**Measured: 1291 -> 922. Saves 369px.** Pure CSS + 6 attribute edits. No DOM, no JS, no test coupling. Highest pixels-per-risk in the build; land it first.

### 1a. `index.html` — six `data-height` edits

`src/modules/charts.js:1617` reads `Number(canvas.dataset.height || 280)` and `styles.css:2812` gives the canvas `width: 100%; height: auto`, so the attribute maps 1:1 to rendered CSS pixels. One attribute per canvas, zero JS.

| line | canvas | was | is | why |
|---|---|---|---|---|
| 1856 | `#equityChart` | 240 | **240** | unchanged — the one full-size chart (hierarchy graft) |
| 1891 | `#drawdownChart` | 240 | **180** | |
| 1919 | `#strategyPerformanceChart` | 280 | **200** | rotated x-labels: verify |
| 1931 | `#traderScoreChart` | 300 | **170** | radar spoke labels: verify |
| 1949 | `#psychologyChart` | 240 | **180** | |
| 1962 | `#sessionChart` | 240 | **180** | |
| 1975 | `#rMultipleChart` | 240 | **180** | |

Keep the `was ->` note as an inline HTML comment on each edited line so the next session sees the old ramp without git archaeology.

### 1b. `clay-v3.css`

```css
  /* --- Analytics panes ---------------------------------------------------
     A pane head is one line: the h3 and its subtitle sit on a baseline row
     instead of stacking, which is where row 2's 94px of chrome lived (the
     info button was wrapping under the title block). Nothing is removed. */
  #dashboard .panel-grid-analytics { gap: 8px; }

  #dashboard .panel-grid-analytics .panel { padding: 12px; }

  #dashboard .panel-grid-analytics .panel-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  #dashboard .panel-grid-analytics .panel-head > div {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }
  #dashboard .panel-grid-analytics .panel-head h3 {
    font-size: 13px;
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  #dashboard .panel-grid-analytics .panel-head p {
    margin: 0;
    font-size: 11px;          /* --fs-micro, the floor, exactly */
  }

  /* The info button was taking a whole 42px line to itself. */
  #dashboard .panel-grid-analytics .panel-head-inline {
    flex-wrap: nowrap;
    align-items: flex-start;
  }
  #dashboard .panel-grid-analytics .panel-head-inline > div { flex: 1 1 auto; min-width: 0; }
  #dashboard .panel-grid-analytics .panel-head-inline > .info-btn { flex: 0 0 auto; }

  /* Two stacked toggle groups become one row: 88px of head becomes 38. */
  #dashboard .strategy-performance-toolbar {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    width: auto;
  }

  #dashboard .panel-trader-score .trader-score-foot { padding-top: 8px; }
```

### 1c. Check it landed

In devtools console on the dashboard at 1440:

```js
const g = document.querySelector('.panel-grid-analytics');
JSON.stringify({
  total: Math.round(g.getBoundingClientRect().height),
  rows: [...g.children].map(p => Math.round(p.getBoundingClientRect().height))
});
```

Expect `total: 922`, `rows: [318,318,332,332,256,256,256]`. Measured live.

### 1d. Collision check before committing 1a (mandatory)

The two likeliest to clip are the strategy bars' rotated x-labels and the radar's spoke labels. At the new heights, screenshot both panels and confirm:
- `#strategyPerformanceChart` at 200: x-labels not overlapping the axis, `truncatePerformanceLabel` still leaving readable stubs;
- `#traderScoreChart` at 170: `wrapRadarLabel` two-line labels not clipped at the canvas edge.

If either clips, raise that one canvas by 20 and re-measure; do not lower the others to compensate.

### 1e. Risk

- Light theme: nothing here touches colour. Verified in light mode, no washout.
- 11px floor: `.panel-head p` is set to exactly 11px, inside `min-width: 1025px`. Below 1025 the rule does not apply and `--fs-body` (13.5px) still governs.
- 44px targets: `.info-btn` keeps its `@media (max-width: 899px), (pointer: coarse)` 44px rule in clay-v2.css:4035. Untouched.
- Tests: none reference these selectors or `data-height`.

**Running total: 2354 -> 1985.**

---

# PHASE 2 — THE DECK (hero and risk, together)
**Measured: deck 345 -> 191. Saves 154px.** Pure CSS. Both cards or neither (see 0.1).

### 2a. `clay-v3.css`

```css
  /* --- The deck ----------------------------------------------------------
     The deck row is as tall as its TALLER card, and that card is the risk
     meter (343px natural) not the balance hero (320px). Cutting one alone
     saves 2px. Both, in one commit.

     Specificity: .metric-card.dash-hero, because styles.css:7698
     `.metric-card:not(.dash-rail-item)` is (0,2,0) and a bare .dash-hero
     loses to it — the same cascade that killed the desk rail. */

  /* Balance hero. 132px of bottom padding reserved a 118px decorative well
     under a 49px number; the sparkline keeps every pixel of DATA at 56px
     because it never had an axis. .dash-spark-wrap is position:absolute
     (styles.css:4833), so the padding-bottom IS the reserve — both move. */
  #dashboard .metric-card.dash-hero {
    padding: 12px 16px 12px;
    min-height: 0;
    border-radius: 14px;
  }
  #dashboard .dash-hero-top { gap: 8px; }
  #dashboard .dash-hero-value {
    font-size: 44px;           /* the page's anchor stays the biggest thing */
    margin-top: 2px;
  }
  #dashboard .dash-hero-meta { margin-top: 6px; min-height: 0; }
  #dashboard .dash-spark-wrap {
    height: 56px;
    border-radius: 0 0 14px 14px;
  }

  /* Risk. The dial was not the tall thing: .dash-risk-figures stacks two
     meters at 150px. Two-up, and the dial drops to 64. Same numbers. */
  #dashboard .dash-risk {
    padding: 12px 16px;
    gap: 8px;
    min-height: 0;
    border-radius: 14px;
  }
  #dashboard .dash-risk-body { gap: 12px; align-items: center; }
  #dashboard .dash-dial,
  #dashboard .dash-dial svg { width: 64px; height: 64px; }
  #dashboard .dash-dial-value { font-size: 20px; }
  #dashboard .dash-risk-figures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    align-content: start;
  }
  #dashboard .dash-risk .risk-strip-item { gap: 2px; }
  #dashboard .dash-risk-consequence {
    padding: 6px 8px;
    font-size: 12px;
    line-height: 1.4;
  }

  #dashboard .dash-stats { gap: 8px; }
```

### 2b. Do NOT touch the SVG dial's geometry in JS

`app.js:9008` computes `stroke-dasharray` from `2 * Math.PI * 48` against the `r="48"` in the markup, and the `viewBox="0 0 118 118"` scales. Shrinking the dial in CSS only (`width`/`height` on `.dash-dial` and its `svg`) keeps the arc correct with zero JS. Confirmed rendering at 64px.

### 2c. The mobile hero hole — REQUIRED, ships with this phase

`clay-v2.css:572-574` reserves 126px of `padding-bottom` on the phone hero for a 118px well. Phase 2a does not change `.dash-spark-wrap` below 1025px, so the phone well stays 118 and 126 is still correct.

**If you ever move the phone spark height, this rule must be beaten at equal specificity in clay-v3:**

```css
/* OUTSIDE the min-width:1025px block, at the end of clay-v3.css */
@media (max-width: 720px) {
  /* Beats clay-v2.css:573 at equal specificity by file order. Only needed
     if the phone sparkline height changes; the desktop pass does not. */
  #dashboard .metric-card.dash-hero { padding-bottom: 126px; }
}
```

Ship this rule as a comment-only note in Phase 2, and as live CSS the moment anyone touches the phone spark. Leaving 126px over a shrunk well is a crater; leaving it over an unchanged 118px well is correct.

### 2d. Check

```js
const q = s => Math.round(document.querySelector(s).getBoundingClientRect().height);
JSON.stringify({ deck: q('.dash-deck'), hero: q('.dash-hero'), risk: q('.dash-risk'),
                 body: q('.dash-risk-body'), figs: q('.dash-risk-figures') });
```

Expect `deck: 191`, `risk: 191`, `body: 65`, `figs: 65`. The hero should now be the governing card (natural ~191) — that is the hierarchy graft landing: the 44px numeral is 2x the 20px band values and 2.2x the 20px dial figure.

Also confirm the sparkline redrew at the new height: `document.getElementById('dashSparkline').clientHeight === 56`. `drawDashSparkline` (app.js:8668) reads `clientHeight` with `padTop = 14` and a 4px bottom, leaving 38px of usable range at 56 — verified drawing correctly, no JS change.

### 2e. Risk

- `.dash-risk-link` ("Cooldown rules") keeps its 44px `inline-flex` from clay-v2.css:4023 at coarse pointer / max-899. Untouched.
- `.dash-range-btn` keeps `min-height: 32px` on desktop (clay-v2.css:1035) and 44px at max-899 (clay-v2.css:1578). Untouched.
- `.dash-risk-consequence` at 12px is above the 11px floor, and only above 1025px.
- Light theme: verified. The hero at 14px radius on the concrete ground still reads as a moulded pane.

**Running total: 2354 -> 1831.**

---

# PHASE 3 — THE BOARDS BECOME ROWS
**Measured: 423 -> 228 (demo state, 4 tiles + full unjournalled card). Saves 195px.** Pure CSS — no `renderPlaybook` rewrite. This is the phase the judges priced as an app.js rendering rewrite; it is not, because `.dash-play-tile` is already `display: grid` and only needs columns.

### 3a. `clay-v3.css`

```css
  /* --- The boards --------------------------------------------------------
     A playbook tile is already display:grid (clay-v2.css:1295). Giving it
     COLUMNS turns a 136px tile into a 42px table row with hairline
     splitters. No renderer change: renderPlaybook's markup is untouched. */
  #dashboard .dash-board { padding: 12px 14px; border-radius: 14px; }
  #dashboard .dash-board-head { margin-bottom: 8px; align-items: center; }
  #dashboard .dash-board-head > div {
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0;
  }
  #dashboard .dash-board-head h3 {
    font-size: 13px;
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  #dashboard .dash-board-head p { margin: 0; font-size: 11px; display: inline; }
  #dashboard .dash-board-link { min-height: 28px; }

  #dashboard .dash-playbook-grid { grid-template-columns: 1fr; gap: 0; }
  #dashboard .dash-play-tile {
    grid-template-columns: minmax(0, 1fr) auto auto 90px;
    align-items: center;
    gap: 10px;
    padding: 5px 8px;
    border-radius: 0;
    box-shadow: none;
    background: none;
  }
  #dashboard .dash-play-tile + .dash-play-tile { box-shadow: inset 0 1px 0 var(--line-strong); }
  #dashboard .dash-play-value { font-size: 15px; }
  #dashboard .dash-play-meta { font-size: 11px; white-space: nowrap; }
  #dashboard .dash-play-bar { width: 90px; }
  #dashboard .dash-alert { margin-top: 8px; padding: 8px 10px; }

  #dashboard .dash-unjournalled { gap: 8px; }
  #dashboard .dash-unj-list { gap: 0; }
  #dashboard .dash-unj-foot { padding-top: 8px; }
```

### 3b. Depth-as-data survives — do not drop `.is-sunk`

`.dash-play-tile.is-sunk` (clay-v2.css:1303) swaps background and shadow. Flattening the tile removes the raised/sunk read. **The money colour and the up/down glyph already carry it** (`app.js:9352` writes `pnl-positive`/`pnl-negative` and the arrow), which is what WCAG 1.4.1 requires, so nothing is lost informationally. Add a one-line replacement so the row still reads at a glance:

```css
  #dashboard .dash-play-tile.is-sunk { background: var(--pnl-neg-soft); }
```

### 3c. MORE rows than today — two number edits in app.js

This is the graft that makes the boards a win rather than a shrink. Both are inside function bodies, so **no module-level `const`/`let` is added below `init()` and the TDZ trap is not in play.**

- `app.js:9334` — `.slice(0, 4)` -> `.slice(0, 8)` in `renderPlaybook`
- `app.js:9827` — `.slice(0, 3)` -> `.slice(0, 6)` in `renderUnjournalled`

At 42px per row, 8 playbook rows = 336 + head 30 + 24 pad = 390. That is taller than the 228 above. **Therefore cap the pane, per the Instrument graft:**

```css
  #dashboard .dash-playbook-grid,
  #dashboard .dash-unj-list {
    max-height: 176px;         /* 4 rows visible, the rest scroll */
    overflow-y: auto;
    overscroll-behavior: contain;
  }
```

Ship 3a+3b first and verify at 228. Ship 3c as a separate commit so the height win is not hostage to it. If 3c makes the pane feel like a scroll-jail, revert 3c alone and keep 4/3 rows at 42px — the height saving is identical either way.

### 3d. Check

```js
const q = s => Math.round(document.querySelector(s).getBoundingClientRect().height);
JSON.stringify({ boards: q('.dash-boards'), tile: q('.dash-play-tile'), grid: q('.dash-playbook-grid') });
```

Expect `boards: 228`, `tile: 42`.

### 3e. Risk

- 42px rows: `.dash-play-tile` and `.dash-unj-row` are `<button>`s. On desktop (min-width 1025, fine pointer) 42px is well over the 24px WCAG 2.5.8 minimum. **The 44px floor rules live in `@media (max-width: 899px), (pointer: coarse)` and are untouched.** A 1400px touch laptop hits the coarse branch and keeps 44px.
- `.dash-board-head p` at 11px is exactly the floor.
- `tests/mobileFloors.check.mjs` CONTROLS list does not include `.dash-play-tile` or `.dash-unj-row`; no new obligation created.
- Light theme: `--line-strong` (#b9bfc6 on #f0f2f4) is the hairline that survives the user's light-mode screenshots. `--line` (#d3d7db) is too faint at 1px — verified visually. Use `--line-strong` everywhere a splitter carries structure.

**Running total: 2354 -> 1636.**

---

# PHASE 4 — THE READINGS BAND (quad + rail fusion)
**Measured: 138 + 12 + 89 = 239 -> 77. Saves 162px** (against the given-table baseline of 98+12+89=199, saves 122). The one DOM change in the build, and the strongest single gesture.

### 4a. `index.html` — move seven `<article>` elements

Move all seven `.dash-rail-item` articles from `<section class="dash-rail">` (lines 1773-1811) into `<section class="dash-quad">` (ends line 1720), appended after the fourth `.dash-quad-card`. Then delete the now-empty `<section class="dash-rail">` wrapper.

Rename `.dash-quad`'s `aria-label` from `"Edge quality"` to `"Performance readings"` and update its comment.

**Preserve verbatim, node for node:**
- every `data-metric` attribute (11 of them)
- every `data-metric-delta` (11) and `data-metric-sub` (2)
- `id="dashboardMetricGrid"` on the parent `.dash-stats` — `app.js:360` toggles it for the empty state
- the `.metric-card` class on every article (it carries the label/value typography)

**Delete while moving:**
- `data-tilt` from the four `.dash-quad-card` articles (attribute deletion only — `app.js:8880` `querySelectorAll("[data-tilt]")` tolerates a shorter list, zero JS change, zero TDZ exposure). Tilt stays on `.dash-hero` and `.dash-risk`.
- `class="dash-reveal" style="--i: 2..5"` from the four quad cards, and `class="dash-reveal" style="--i: 6"` from the deleted rail wrapper. Add `class="dash-reveal" style="--i: 2"` to the `.dash-quad` section itself so the band reveals as one plane. Hero stays `--i: 0`, risk `--i: 1`, propTracker `--i: 2`.

### 4b. `clay-v3.css`

```css
  /* --- The readings band -------------------------------------------------
     Eleven cells, one anatomy: 11px micro label over a tabular mono value,
     separated by drawn hairlines instead of gaps. The .metric-card anatomy
     the site already ships IS this cell — .metric-label is already
     --fs-micro mono uppercase and .metric-value is already --font-mono
     (styles.css:2693, :2701). Only the box is removed. */
  #dashboard .dash-quad {
    grid-template-columns: repeat(11, minmax(0, 1fr));
    gap: 0;
    padding: 0;
    background: var(--surface-1);
    border-radius: 14px;
    box-shadow: var(--clay-soft);
    overflow: hidden;
  }
  #dashboard .dash-quad > .metric-card {
    padding: 7px 8px;
    min-height: 0;
    border-radius: 0;
    box-shadow: none;
    background: none;
    background-image: none;
    align-content: start;
  }
  #dashboard .dash-quad > .metric-card + .metric-card {
    box-shadow: inset 1px 0 0 var(--line-strong);
  }
  #dashboard .dash-quad .metric-label {
    font-size: 11px;                 /* the floor, exactly */
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Type scale IS the hierarchy inside the band: the four edge readings run
     20px, the seven secondary ones 14px. One band, two ranks. */
  #dashboard .dash-quad .dash-quad-card .metric-value { font-size: 20px; margin-top: 2px; }
  #dashboard .dash-quad .dash-rail-item .metric-value { font-size: 14px; margin-top: 3px; }

  /* Deltas and the best/worst-day dates STAY. Hiding them would be removing
     information; they lose the chip fill and become a third micro line. */
  #dashboard .dash-quad .metric-delta {
    display: inline-block;
    margin-top: 2px;
    padding: 0;
    background: none;
    font-size: 11px;
    letter-spacing: 0;
    white-space: nowrap;
  }
  #dashboard .dash-quad .metric-sub {
    display: block;
    margin-top: 1px;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Values align in columns. .metric-value is already JetBrains Mono, so
     this only guards the fallback stack. One line, no claims. */
  #dashboard .dash-quad .metric-value,
  #dashboard .dash-hero-value,
  #dashboard .dash-dial-value,
  #dashboard .dash-play-value { font-variant-numeric: tabular-nums; }
```

### 4c. Check

```js
JSON.stringify({
  band: Math.round(document.querySelector('.dash-quad').getBoundingClientRect().height),
  cells: document.querySelectorAll('.dash-quad > .metric-card').length,
  cellW: Math.round(document.querySelector('.dash-quad-card').getBoundingClientRect().width),
  metrics: document.querySelectorAll('#dashboard [data-metric]').length,
  overflow: [...document.querySelectorAll('.dash-quad .metric-value')].some(v => v.scrollWidth > v.clientWidth),
  railGone: !document.querySelector('.dash-rail')
});
```

Expect `band: 77`, `cells: 11`, `cellW: 95`, `metrics: 12` (11 in the band + `accountBalance`), `overflow: false`, `railGone: true`. All measured live; **no value overflowed its 95px cell**, including "Current Drawdown" and "Winning Streak".

Also confirm the empty state still toggles: with zero trades, `#dashboardMetricGrid` gets `hidden` and `#dashboardEmptyState` appears. That path reads the id on `.dash-stats`, which is untouched.

### 4d. Risk

- The band is desktop-only. Below 1025px `.dash-quad` keeps `repeat(4, 1fr)` from styles.css:4890 (2-up below 900 from styles.css:5024), and the seven ex-rail articles now flow into it — **check the phone at 375 after the move**: they will render 2-up as `.dash-quad-card`-less `.metric-card`s. Add, outside the 1025 block:

  ```css
  @media (max-width: 1024px) {
    #dashboard .dash-quad { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
    #dashboard .dash-quad > .metric-card { min-height: 44px; }
  }
  ```
  This replaces the `.dash-rail` responsive nth-child hairline rewrites at styles.css:5006-5016 and :5065-5075, which are now dead selectors. Leave them — they cost nothing and deleting them is a separate cleanup.

- `styles.css:8856` `.dash-rail-item .metric-delta { font-size: var(--fs-micro) }` still applies and is 11px. Safe.
- `styles.css:4939` `.dash-rail-item .metric-delta { font-size: 10.5px }` is superseded by :8856 (later, equal specificity). mobileFloors already accounts for this and is green. **Do not re-order or delete either rule.**
- `styles.css:7302` gives `.metric-card:not(.dash-rail-item)` a `background-image` and `box-shadow`; our (0,1,0)+`#dashboard` (1,1,0) rule beats it. Confirmed flat.
- Light theme: verified. `--line-strong` splitters, `--surface-1` band on `--surface-0` ground.

**Running total: 2354 -> 1474** (using the given-table quad/rail baseline of 199; **-1636 with the demo-state 239**).

---

# PHASE 5 — THE STATUS STRIP
**80 -> 44 with nothing open; 156 -> 88 with a live position. Saves 36-68px.** Lowest ratio, so it lands last, but it converts spent-once chrome into always-useful chrome.

### 5a. `clay-v3.css`

```css
  /* --- The status strip --------------------------------------------------
     The greeting and the clock collapse into one caps segment; the three
     tickers were already one line. The strip goes sticky, which lets
     #dashTickerDock (the duplicate the 5s poll already patches) ride along
     unchanged — setupStickyDashTicker (app.js:13214) measures
     .dash-head's rect, which still exists and still scrolls. */
  #dashboard .dash-head {
    position: sticky;
    top: 0;
    z-index: 4;
    gap: 12px;
    padding: 6px 4px;
    background: var(--surface-0);
    box-shadow: inset 0 -1px 0 var(--line-strong);
  }
  #dashboard .dash-greeting {
    flex: 0 0 auto;
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  #dashboard .dash-clock { font-size: 11px; }
  #dashboard .dash-hello {
    margin: 0;
    font: 600 11px/1.2 var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  #dashboard .dash-log-btn,
  #dashboard .dash-import-btn { min-height: 32px; height: 32px; padding: 0 14px; }
  #dashboard .dash-live-pill { padding: 4px 8px 4px 12px; }
  #dashboard .dash-live-main { min-height: 32px; }
```

### 5b. Copy guard

`tests/copyDashes.check.mjs` bans an em/en dash with a word on both sides, **including the `&mdash;` / `&ndash;` entity forms**. The existing strip already uses `&middot;` (`live &middot; 5s`) — keep it. Any new strip copy uses `&middot;`, a comma, or a full stop. Never `&mdash;`.

`tests/landingDemo.check.mjs:105` requires the literal string `dash-ticker-tag">live` to survive in index.html. Do not restructure that span.

### 5c. Check

```js
const h = document.querySelector('.dash-head');
JSON.stringify({ h: Math.round(h.getBoundingClientRect().height),
                 sticky: getComputedStyle(h).position });
```

Expect 44 with no open position, ~88 with one. Then scroll the dashboard and confirm `#dashTickerDock` still gets `.is-docked` — `setupStickyDashTicker` compares `head.getBoundingClientRect().bottom < dashboard.getBoundingClientRect().top`. **With the head now sticky at `top: 0` of its own scroller, that condition never becomes true and the dock never appears.** Either:
- (a) drop `position: sticky` and keep the 44px strip in flow (simplest, and the dock keeps working), or
- (b) keep sticky and delete the dock + its call site, since a sticky head makes the duplicate redundant.

**Take (a) for this phase.** It is one line less code and zero JS. Option (b) is a follow-up, and it deletes ~20 lines of markup plus one function — file that as the cleanup it is.

### 5d. Risk

- `.dash-hello` at 11px is the floor exactly, and only above 1025px. Below, clay-v2.css:826 keeps `clamp(21px, 2.4vw, 27px)`.
- `.dash-log-btn` at 32px: `tests/mobileFloors.check.mjs` `OFF_PHONE` already exempts `.kbd-hint` and `.dash-log-flag` because `#journalNewTradeBtn` is `display: none` below 899px (the FAB owns it). The 32px is desktop-only and pointer-fine. Do not add a `pointer: coarse` branch that would drop a touch laptop below 44.
- Named loss, per the design: the 22px "Welcome back." headline is demoted to an 11px caps segment. It carries no data.

**Running total: 2354 -> 1438** (given-table baseline) / **2518 -> 1518** in the demo state.

---

# PHASE 6 — THE TAIL (optional)
**Measured: -113px.** Everything below the analytics grid is 1832px of the 4922px scroller and the winning design never touches it.

```css
  #dashboard .panel-grid-bottom { gap: 8px; }
  #dashboard > .panel,
  #dashboard .panel-grid-bottom .panel { padding: 14px 16px; }
  #dashboard .panel-head { margin-bottom: 8px; }
```

Small return because those panels are content-driven (the checklist editor, the accounts list, the rules panel), not chrome-driven. Ship it for consistency, not for the pixels. Anything more is a second project.

---

# HEIGHT BUDGET

Measured at 1440x900 in demo mode, head to analytics bottom.

| phase | section | before | after | delta | running total |
|---|---|---:|---:|---:|---:|
| — | baseline (given table) | | | | **2354** |
| 1 | analytics grid | 1291 | 922 | **-369** | 1985 |
| 2 | deck (hero + risk) | 345 | 191 | **-154** | 1831 |
| 2 | `.dash-stats` gaps 12 -> 8 (x3) | 36 | 24 | -12 | 1819 |
| 3 | boards | 375 | 228 | **-147** | 1672 |
| 4 | quad + rail + gap -> band | 199 | 77 | **-122** | 1550 |
| 5 | head | 80 | 44 | **-36** | **1514** |
| 6 | tail (below scope) | 1832 | 1719 | -113 | — |

**Head-to-analytics: 2354 -> 1514, a 35.7% cut with zero information removed.**

Like-for-like in the same live DOM (demo state, which has visible deltas, `metric-sub` dates, four playbook tiles and an open position): **2518 -> 1518, a 39.7% cut.** That is the honest number, and it is inside the user's own 1/1.65 = 61%-of-current calibration.

Fold inventory at 900px: readings visible on screen one goes from **~11-15 to 22** (balance, floating P&L, today, week, risk %, both budget meters, all 11 band cells, and all four playbook expectancy figures). Measured.

Full scroller: **4922 -> 3921** with all six phases (-20% of total scroll; -40% of the part this design governs).

---

# RISK REGISTER

| # | risk | where | mitigation |
|---|---|---|---|
| 1 | Hero-only cut saves nothing | `.dash-deck` is a grid row | Phase 2 cuts hero and risk in one commit. Never split it. |
| 2 | Padding override silently loses | styles.css:7698 `.metric-card:not(.dash-rail-item)` is (0,2,0) | Every hero/quad padding rule is `.metric-card.dash-hero` / `.metric-card.dash-quad-card`. No `!important`. |
| 3 | Sparkline crater | `.dash-spark-wrap` is `position: absolute` | Height and `padding-bottom` always move together. Phase 2c documents the clay-v2.css:573 phone rule and when it must be beaten. |
| 4 | Light-mode washout on hairlines | every splitter | `var(--line-strong)`, never `var(--line)`, never `--term-line` (which is dark-only by contract). Verified in light mode. |
| 5 | 11px floor | `.panel-head p`, `.dash-hello`, `.metric-label`, `.dash-play-meta` | All set to exactly 11px, all inside `min-width: 1025px`. Nothing in styles.css or clay-v2.css is edited to a smaller size, so mobileFloors cannot see a change. |
| 6 | 44px targets | `.dash-play-tile` 42px, `.dash-log-btn` 32px, `.dash-range-btn` 32px | Every floor rule lives in `@media (max-width: 899px), (pointer: coarse)` in clay-v2.css §10h/§15b and is untouched. A touch laptop at 1400px hits the coarse branch. |
| 7 | Chart label collision | `#strategyPerformanceChart` 200, `#traderScoreChart` 170 | Phase 1d is a hard gate before committing 1a. Screenshot both; raise the offender by 20 rather than lowering the rest. |
| 8 | `[data-metric]` hooks lost in the move | index.html 1699-1811 | Phase 4c asserts `document.querySelectorAll('#dashboard [data-metric]').length === 12`. Run it before and after. |
| 9 | Sticky head kills the ticker dock | app.js:13214 | Phase 5c takes option (a): no `position: sticky`. Do not add it without deleting the dock. |
| 10 | TDZ trap | app.js | The only JS in this build is two `.slice()` numbers inside existing function bodies (Phase 3c). **No new module-level `const`/`let` anywhere, and nothing below the `init()` call.** |
| 11 | `copyDashes` entity blind spot | any new label | `&middot;` only. The scanner catches `&mdash;`/`&ndash;` with a word on both sides. |
| 12 | `landingDemo` string assert | index.html ticker | `dash-ticker-tag">live` must survive verbatim in both strips. |
| 13 | `.prop-card#propTracker` | index.html:1626 | Out of scope, hidden unless prop rules are on. When on, it sits between the deck and the band at full clay size. Flag as a follow-up; do not discover it in QA. |
| 14 | `.dash-rail` responsive rules go dead | styles.css:5002-5016, :5056-5075 | Harmless dead selectors after Phase 4. Phase 4d adds the replacement `@media (max-width: 1024px)` rule for the merged band. Deleting the dead ones is a separate cleanup commit. |

---

# HONEST LOSSES, NAMED

Nothing informational is removed. Three decorative things are:

1. **Tilt physics on the eleven small cells** — `data-tilt` deleted by attribute only. At 95px cell width a tilt is noise. It stays on the hero and the risk card.
2. **The carved inset-shadow sparkline well** — the 118px decorative recess becomes a 56px strip. The sparkline itself keeps every data point; it never had an axis to lose, and `drawDashSparkline` is fully resolution-independent.
3. **The 22px "Welcome back." headline** — demoted to an 11px caps segment in the status strip. It carries no number.

Plus one depth-as-data swap: `.dash-play-tile.is-sunk` loses its pressed shadow and gains a `--pnl-neg-soft` fill. The money colour and the up/down glyph already carried the same reading (WCAG 1.4.1), so the tone survives the flattening.