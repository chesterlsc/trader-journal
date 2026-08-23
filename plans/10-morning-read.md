# BUILD SPEC — The Morning Read

Every line number below was read from the file. Every pixel below was measured in the live DOM at 1999×1150 (dpr 2) with the layout prototyped in the browser, not computed on paper.

---

## 0. Three corrections to the audit. Read these first or you will build the wrong thing.

**0.1 `#dashboard.is-active { padding-inline }` LOSES.** The audit and two of the three directions say this one-liner reclaims the 519px gutter. It does not. Proven live:

```
#dashboard.is-active   { padding-inline: 16px }  → computed padding "16px 259.5px"   LOSES
.view.is-active#dashboard { padding-inline: 16px } → computed padding "16px"          WINS
```

`styles.css:12166` is `.view.is-active:not(#terminal)` — `:not(#terminal)` contributes an ID, so it is (1,2,0). `#dashboard.is-active` is (1,1,0). The winner's own comment at `clay-v3.css:3567-3569` already warns about exactly this. Use `.view.is-active#dashboard` — it is (1,2,0), a tie, broken by source order (clay-v3.css loads after styles.css).

**0.2 `.dash-now` is INSIDE `.dash-hero`.** `index.html:1490` opens `<article class="… dash-hero …">`; `index.html:1516` opens `<div class="dash-now">` inside it; the article closes at 1537. Every direction that places `.dash-now`'s children on the top-level grid ships inert rules. **This spec does not move it.** The hero spans all 12 columns and becomes a 3fr/9fr grid with `.dash-now` in its second track — zero DOM moves, one raised surface, no `display:contents` trick that would kill the surface. Measured working: hero 1888×107, `.dash-now` 1404×107 inside it.

**0.3 `[hidden]` does not hide a chart canvas, and it will not hide your new flex panels.** `styles.css:2841-2842` is `.panel-chart canvas { display: block }` at (0,2,0), which beats the UA `[hidden]` rule. Measured: `#drawdownChart.hidden === true` and `getComputedStyle().display === "block"`. Same trap in reverse for `#dashPlaybook`: giving it `display:flex` at (1,2,0) overrode its own `[hidden]` and left a 629px ghost panel. Both need an explicit `display:none` rule. **This is the 3am bug in this diff.**

Two more measured corrections, smaller: the rail's news is **scrollable, not amputated** (`.dem-panel.scrollTop` reaches 447) — it is a hidden nested scroller nobody discovers, which is bad enough. And `.eq-footnotes` is **five** cards (`index.html:1782-1808`), not eight; `.dash-quad` is six (`index.html:1630-1662`).

---

## 1. The layout

Four bands, named by the question a trader asks at 06:41.

| Band | Track | Contents |
|---|---|---|
| **A — which book** | `36px` | `.dash-head`, cols 1–13 |
| **B — am I in shape** | `108px` | `.dash-hero` cols 1–13: Net P&L 44px + six live cells |
| **C — where is my edge** | `minmax(0,0.51fr)` | equity 1–8 · net-daily bars 8–11 · desk rail 11–13 (spans C+D) |
| **D — what did it cost** | `minmax(0,0.49fr)` | calendar 1–4 · playbook 4–8 · discipline 8–11 |

### Measured, at 1999×1150

```
computed grid-template-rows : 36px 108px 449.305px 431.695px   (sum 1025)
+ 3 row gaps × 12                                                    36
+ padding-block 16 × 2                                               32
                                                                   ----
                                                                   1093  = view box height ✓
#dashboard.scrollHeight === clientHeight === 1093                        → NO SCROLL

column pitch : 148.25px   (was 107.664px, +37.7%)
padding      : 16px       (was 16px 259.5px)
```

| Element | Before | After |
|---|---|---|
| `#equityChart` box | 919 × 94 | **1076 × 340** |
| equity plot ratio | 37 : 1 | **3.6 : 1** |
| `.eq-footnotes` | 919 × 13 (clipped, sh 15) | 1076 × 40, 9 figures |
| `.dash-edge-mini` | 347 × 478 | **309 × 893** |
| `#dashEdgeMiniNews` bottom edge | **1280** (130px below fold) | **920** ✓ |
| `.dem-panel` hidden overflow | 447px | 104px |
| `#dashMiniCal` | 586 × 478 (12.2% of screen) | 469 × 432, cells 60 × **45** |
| `.dash-board-slot` | 467 × 407, `display:block` | 469 × 432, sh **430** — 2px slack |
| `.dash-head` | 72px in a 44px track (28px overprint) | 36 × 36, sh 36 |
| `.dash-hero` | 119px in a 96px track (23px spill) | 107 in 108 |
| `#estimatedAnalyticsNotice` | 320×26 fixed at (24,1112) | 1×1 clipped (already fixed at HEAD) |

---

## 2. Build order

Eight steps. Each is independently verifiable and leaves the page shippable. Do not reorder 1 and 2.

| # | Step | Ship-safe alone? |
|---|---|---|
| 1 | Delete the second `@media (min-width:1240px)` block in styles.css | yes — reveals the true stretch behaviour |
| 2 | Add `align-items: stretch`, delete the six `height:100%` workarounds | yes |
| 3 | The padding line + the 4-band grid + placements | yes — this is the visible win |
| 4 | Flex-column panels, `flex:1` last lists, the `[hidden]` guards | yes |
| 5 | charts.js: `clientHeight` first, height ladder, nice-number ticks | yes — helps every view |
| 6 | index.html DOM edits (Net P&L node, footnote move, day-bars div) | yes |
| 7 | app.js: three lines in `renderDashboardMetrics`, one in `renderLiveEquity`, `renderDayBars` | yes |
| 8 | Short-screen branch + the below-1240 notice fix | yes |

---

## 3. STEP 1 — delete the second 1240 block

**styles.css:9936-9979 → replace with just the `display:grid`.** This is a DELETE, not a re-scope. Re-scoping it to `max-width:1239px` (two losing directions proposed this) would apply a two-column sticky-rail desktop grid to every phone — a range that has never had those declarations.

Delete `styles.css:9944` (`grid-template-columns`), `9951` (`column-gap`), `9952` (`row-gap`), **`9953` (`align-items: start` — the leak)**, `9958` (`#dashboard > *:not(.dash-edge-mini) { grid-column: 1 }`), **`9962` (`margin-bottom: var(--space-5)` — measured live on `.dash-head` and `.panel-grid-analytics`, which put a 427px margin box in a 407px track)**, and `9963-9978` (the whole sticky `.dash-edge-mini` block, already cancelled by `clay-v3.css:3652-3655`). Keep the comment at 9930-9935 and:

```css
@media (min-width: 1240px) {
  #dashboard.is-active { display: grid; }
}
```

Also delete, same step:

- `styles.css:12171` — `#dashboard.is-active { align-content: start; }` (contradicts `align-content: stretch` at clay-v3.css:3572)
- `clay-v3.css:1242` and `clay-v3.css:1258-1262` — the margin-bleed apparatus, dead since `margin: 0` landed at `clay-v3.css:3655`. Measured: `#dashEdgeMiniNews` right edge sat exactly on the padded content edge, zero bleed. 15 lines of comment describing behaviour that cannot occur.
- `clay-v3.css:3393-3395` and `clay-v3.css:3340-3341` — `.panel-grid-bottom` rules whose target is `display:none` at `clay-v3.css:3712`.

**Verify:** below 1240 nothing moves (all deletions were inside `min-width:1240px`). At 1240+, `getComputedStyle('.dash-head').marginBottom === "0px"`.

---

## 4. STEP 2 — one declaration replaces six

**clay-v3.css:3563-3574** — add one line to the `#dashboard.is-active` rule:

```css
    align-items: stretch;     /* styles.css:9953 turned this off from a second
                                 1240 block; that block is now deleted, and this
                                 states it rather than inheriting a default. */
```

**Then delete `clay-v3.css:3594-3609` entirely** — the 12-line comment ("Stretch alone does not bind…") and the six `height: 100%` props it justifies. The comment mis-diagnoses the cause: stretch did not bind because it was switched off two files ago, not because min-height was auto (`min-height: 0` was already applied at 3583 and 3593). Replace with:

```css
  /* height:auto, not 100%: the item stretches to its track by construction now,
     and 100% would re-state the track as an answer instead of a ceiling —
     which is what stopped .panel-chart canvas sizing to its own flex box. */
  #dashboard.is-active .panel-grid-analytics,
  #dashboard.is-active .dash-edge-mini,
  #dashboard.is-active .dash-board-slot,
  #dashboard.is-active #dashPlaybook,
  #dashboard.is-active #dashMiniCal,
  #dashboard.is-active #propTracker { height: auto; overflow: hidden; }
```

**Also delete `clay-v3.css:3612-3613`** (`.panel-chart, .panel-chart canvas { min-height: 0; height: 100% }`) and replace with `height: auto` — the canvas sizes from flex in step 4 and the JS reads the truth in step 5.

Keep `clay-v3.css:3614-3618` (`.panel-grid-analytics > .panel { display:flex }`) — step 4 widens it.

---

## 5. STEP 3 — the grid

All of this goes inside the existing `@media (min-width: 1240px)` at **clay-v3.css:3553**.

```css
  /* ── THE INSTRUMENT OPTS OUT OF THE READING COLUMN ─────────────────────
     .view.is-active:not(#terminal) (styles.css:12166) is (1,2,0) because
     :not(#terminal) contributes an ID. #dashboard.is-active is (1,1,0) and
     LOSES — measured, it left the computed padding at "16px 259.5px".
     .view.is-active#dashboard is (1,2,0), a tie, broken by source order
     (index.html loads clay-v3.css after styles.css). VERIFIED live: computed
     padding "16px", column pitch 107.664px → 148.25px.
     styles.css:12162 already blesses the precedent for #terminal: "it is an
     instrument, not a document." So is this. */
  .view.is-active#dashboard { padding-inline: var(--space-4); }

  /* ── ROWS ──────────────────────────────────────────────────────────────
     1093 view box − 32 padding-block − 36 gaps = 1025 of track.
     36 + 108 + 0.51×881 + 0.49×881 = 36 + 108 + 449.3 + 431.7 = 1025 ✓ */
  #dashboard.is-active { grid-template-rows: 36px 108px minmax(0, 0.51fr) minmax(0, 0.49fr); }

  /* One source of truth for tile height. styles.css:7501 min-height:96px is
     what both floated the tiles AND clipped them; the track sizes the item now. */
  #dashboard.is-active .metric-card { min-height: 0; }

  /* ── BAND A: which book, which window ────────────────────────────────── */
  #dashboard.is-active > .dash-head { grid-area: 1 / 1 / 2 / -1; padding: 0; gap: 12px; flex-wrap: nowrap; }
  #dashboard.is-active .dash-head .dash-greeting { display: flex; align-items: baseline; gap: 10px; flex: 0 1 auto; }
  #dashboard.is-active .dash-head .dash-hello { font-size: 13px; margin: 0; }
  /* min-height:0 and padding-block:0 are load bearing: .btn ships a 52px box
     that overflowed the 36px row by 8px before these landed. Measured sh 44→36. */
  #dashboard.is-active .dash-head .btn,
  #dashboard.is-active .dash-head .nav-btn { min-height: 0; height: 30px; padding-block: 0; padding-inline: 12px; font-size: 12px; }
  #dashboard.is-active .dash-head .kbd-hint { display: none; }
  #dashboard.is-active .dash-live { margin-left: auto; max-width: 380px; overflow: hidden; }

  /* ── BAND B: one raised surface, seven figures, ZERO DOM MOVES ─────────
     .dash-now is a CHILD of .dash-hero (index.html:1490 wraps 1516), so it
     cannot be placed on this grid and display:contents on it would delete the
     surface. Instead the hero spans the full row and becomes the 2-track grid;
     .dash-now sits in track 2 and lays its six cells out itself. */
  #dashboard.is-active .dash-hero {
    grid-area: 2 / 1 / 3 / -1;
    padding: 12px 0 12px 16px;
    display: grid;
    grid-template-columns: 3fr 9fr;
    grid-auto-rows: min-content;
    align-content: center;
    column-gap: 0;
  }
  #dashboard.is-active .dash-hero > * { grid-column: 1; }
  #dashboard.is-active .dash-hero .dash-now {          /* (1,3,0) beats the line above */
    grid-column: 2; grid-row: 1 / span 9; align-self: stretch;
    margin: 0; padding: 0; border-top: 0;
    display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));
    column-gap: 0; row-gap: 0; align-content: center;
  }
  #dashboard.is-active .dash-now > * { padding: 0 16px; border-left: 1px solid var(--line); }
  #dashboard.is-active .dash-hero .dash-spark-wrap,
  #dashboard.is-active .dash-hero .dash-ground-caps,
  #dashboard.is-active .dash-hero .metric-note,
  #dashboard.is-active .dash-hero-range,
  #dashboard.is-active .dash-hero #dashCardDate { display: none; }
  #dashboard.is-active .dash-quad { display: none; }   /* emptied in step 6 */

  /* ── BAND C ────────────────────────────────────────────────────────────
     display:contents on .panel-grid-analytics places the two chart panels
     directly, which is what kills .panel-span-8's `grid-column: span 8`
     clamp (styles.css:4870) without a new override. Measured before: both
     panels at x=794, y 237 and 447 — stacked, splitting a 407px row. */
  #dashboard.is-active .panel-grid-analytics { display: contents; }
  #dashboard.is-active .panel-grid-analytics > .panel-span-8 { grid-area: 3 / 1 / 4 / 8; }
  #dashboard.is-active .panel-grid-analytics > .panel-span-4 { grid-area: 3 / 8 / 4 / 11; }

  /* LOAD BEARING. styles.css:2842 is `.panel-chart canvas { display: block }`
     at (0,2,0), which BEATS the UA [hidden] rule — verified: hidden === true,
     computed display === "block". The canvas STAYS in the DOM so
     ui.drawdownChart (app.js:536) and drawAllCharts (charts.js:538) never read
     null; only its box goes. */
  #dashboard.is-active #drawdownChart { display: none; }

  /* ── THE DESK RAIL: full C+D height, right column ──────────────────────
     NEVER display:none on this element or any ancestor, in any state, at any
     breakpoint — clay-v3.css:3546-3549 already carries that warning and it
     extends here. The iframe dies if its box does.
     `grid-template-rows: auto minmax(0,1fr)` bounds the .dem-panel track,
     which is what makes the overflow-y:auto already written at 3672 bind. */
  #dashboard.is-active .dash-edge-mini { grid-area: 3 / 11 / 5 / -1; grid-template-rows: auto minmax(0, 1fr); }
  #dashboard.is-active .dem-news { min-height: 0; }   /* grandchild — the floor
                                                          at 3591 never reached it */
  /* The 16:9 tile eats the news column. Capping it hands the feed its height
     back BEFORE any scrolling is needed: 193px → 168px at a 309px column. */
  #dashboard.is-active .dem-tv { max-height: 168px; }

  /* ── BAND D ────────────────────────────────────────────────────────────
     Calendar keeps its month — "ugly" was about appearance, not existence —
     but drops from 586×478 (12.2% of the viewport) to 469×432. Six rows at
     45px cells, above the 44px floor the file already uses at clay-v3.css:3294.
     ESCAPE HATCH, if the owner wants it bigger or gone: it is ONE grid-area
     swap with #dashPlaybook or the discipline slot. No new code. Do not
     rebuild this decision from scratch. */
  #dashboard.is-active #dashMiniCal  { grid-area: 4 / 1 / 5 / 4; padding: 12px; gap: 8px; }
  #dashboard.is-active #dashPlaybook { grid-area: 4 / 4 / 5 / 8; }
  #dashboard.is-active .dash-board-slot { grid-area: 4 / 8 / 5 / 11; }
  #dashboard.is-active #propTracker  { grid-area: 4 / 1 / 5 / 4; }

  /* ── THE BOARD CLOSES WHEN A PANEL IS OFF ──────────────────────────────
     .dash-edge-mini ships `hidden` (index.html:1448) and renderPlaybook
     toggles #dashPlaybook.hidden (app.js:10507). Without these, a fresh
     account shows a 309px hole down the right and a 629px hole in band D.
     All four states measured: SH === CH === 1093 in every one. */
  #dashboard.is-active:has(.dash-edge-mini[hidden]) .panel-grid-analytics > .panel-span-4,
  #dashboard.is-active:has(.dash-edge-mini[hidden]) .dash-board-slot { grid-column-end: -1; }
  #dashboard.is-active:has(#dashPlaybook[hidden]) #dashMiniCal { grid-column: 1 / 6; }
  #dashboard.is-active:has(#dashPlaybook[hidden]) .dash-board-slot { grid-column-start: 6; }
```

**Delete** `clay-v3.css:3621` (old `.dash-head` placement), `3625-3626` (old hero/quad placement), `3631-3634` (`.dash-hero .dash-now { display: none }` — the whole "now" layer was invisible at exactly the owner's breakpoint), `3635-3636` (old hero padding and 26px value), `3639-3646` (old row-3 placement), `3650-3653` (old row-4 placement; keep `position: static; margin: 0` at 3654-3655).

---

## 6. STEP 4 — dead space becomes structurally impossible

`.panel` declares no `display` (`styles.css:2807-2814`) — measured `display: block`, which is why nothing inside the Discipline Monitor can claim its leftover height. Widen the flex rule that already works at `clay-v3.css:3614`:

```css
  #dashboard.is-active .panel-grid-analytics > .panel,
  #dashboard.is-active .dash-board-slot,
  #dashboard.is-active #dashPlaybook {
    display: flex; flex-direction: column; min-height: 0; gap: 8px; padding: 16px;
  }
  /* MANDATORY companion. The rule above is (1,2,0) and BEATS [hidden] at
     (0,1,0): measured, a hidden #dashPlaybook stayed a 629×432 ghost panel. */
  #dashboard.is-active #dashPlaybook[hidden] { display: none; }

  /* THE RULE: the last list in a panel is flex:1. A box cannot then be taller
     than its content, and its content cannot be shorter than the box. This is
     what makes the blank the owner has flagged three times unreachable BY
     CONSTRUCTION rather than by tuning. The emptiness that remains is pooled
     in ONE place on purpose — beside the figure you read first — never
     distributed as slack into every box. Do not "fill" the band-B gap later. */
  #dashboard.is-active #equityChart,
  #dashboard.is-active #dashDayBars,
  #dashboard.is-active .dash-playbook-grid,
  #dashboard.is-active #riskViolations { flex: 1 1 0; min-height: 0; }
  /* .rule-cost-list is a GRANDCHILD (index.html:1708 wraps 1710); the flex
     item is .rule-cost, so that is what has to grow. */
  #dashboard.is-active .rule-cost { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
  #dashboard.is-active .rule-cost-list { flex: 1 1 0; min-height: 0; overflow-y: auto; }

  #dashboard.is-active .dash-playbook-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: minmax(0, 1fr);
    overflow-y: auto;
  }

  /* The 9-figure stat strip under the curve. Explicit rows, because with
     `auto` the flex algorithm sized the strip before the grid wrapped and
     clipped a row. If VERIFY 7 still fails, the one-line fallback is
     `> * { height: 17px; overflow: hidden }` — do not chase it further. */
  #dashboard.is-active .eq-footnotes {
    display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
    grid-template-rows: 17px 17px; row-gap: 6px; column-gap: 16px;
    flex: 0 0 40px; align-content: center; margin: 0;
  }
  #dashboard.is-active .eq-footnotes > * { margin: 0; padding: 0; }

  /* Chrome cull. 17 raised surfaces → 6: band B's strip, equity, day bars,
     calendar, playbook, discipline. A raised edge means "this is a panel" again.
     (.eq-footnotes cards were already flat at clay-v3.css:3319-3328.) */
  #dashboard.is-active .dash-quad-card,
  #dashboard.is-active .dash-play-tile { background: none; box-shadow: none; border: 0; border-radius: 0; }

  /* Ink the panels do not need at this size. */
  #dashboard.is-active .eq-scrub-hint { display: none; }   /* the canvas aria-label
                                        already says "Drag across it, or press the arrow keys" */
  #dashboard.is-active .panel-head p,
  #dashboard.is-active .dash-board-head p { display: none; }   /* 12px sub-copy × 5 panels */
  #dashboard.is-active .panel-head { margin: 0; }
  #dashboard.is-active .mini-cal-footrow .month-card-mark { display: none; }  /* screenshot
                                        watermark; clay-v3.css:3305 already drops it at narrow widths */

  /* Type ramp: 44 / 28 / 20 / 13 / 11. Today the top is 26/22/22/20 — a
     four-point band holding nine unequal figures, which is a tie, not a rank. */
  #dashboard.is-active [data-metric="totalPnl"] { font: 700 44px/48px var(--font-mono); letter-spacing: -0.03em; margin: 0; }
  #dashboard.is-active [data-metric="accountBalance"] { font: 600 13px/16px var(--font-mono); color: var(--text-faint); margin: 4px 0 0; }
  #dashboard.is-active #dashEquityTag { font: 600 11px/16px var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); margin-right: 6px; }
  #dashboard.is-active .dash-now-fig { font: 700 20px/22px var(--font-mono); }
  #dashboard.is-active #dashHeroToday,
  #dashboard.is-active #dashNowOpen { font-size: 28px; line-height: 30px; }
  #dashboard.is-active .score-item strong { font-size: 20px; }   /* was --fs-lg 18px
                                        at styles.css:3690; a discipline score is a
                                        behaviour trigger, not a footnote */
  #dashboard.is-active .dash-play-value { font-size: 17px; }     /* down from 22px at
                                        clay-v2.css:1152 — a per-setup expectancy is
                                        a 30-second figure, not a 1-second one */
```

Rhythm cap, enforced rather than listed: **three spacing values (8 / 12 / 16), one gap (12), two radii (`--radius-xl`, 999px)** on this view. The rules above use only those. Any new rule that needs a fourth is wrong.

---

## 7. STEP 5 — `src/modules/charts.js`

**7.1 One expression is the whole "unreadable mush" defect.** `charts.js:1625`:

```js
    const height = Number(heightOverride || canvas.dataset.height || 280);
```
→
```js
    // The box is the truth. data-height stays as the fallback for a canvas
    // that has no box: a .view without .is-active is display:none
    // (styles.css:2645), a closed <details> is too, and #drawdownChart is
    // explicitly display:none on this grid — all three report clientHeight 0.
    // VERIFIED live at 1999x1150: equityChart 340 / drawdownChart 0 →180 /
    // traderScoreChart 0 →240 / playbookChart 0 →240.
    const height = Number(heightOverride) || canvas.clientHeight || Number(canvas.dataset.height) || 280;
```

`heightOverride` still wins first, so `drawBarChart`'s `fitHeight` (charts.js:1073) is unaffected. This alone takes `#equityChart` from a 919×240 bitmap displayed in a 919×94 box — a **2.55× anamorphic vertical crush at a perfect 1:1 horizontal** — to 1:1 on both axes, and un-smears the three-pass glow stroke at `charts.js:729-743` whose blur radii were authored against 240px and squashed to 39%.

**7.2 The height ladder.** `charts.js:632-635` reserves a flat 72px of chrome regardless of height. Without a ladder, 7.1 converts a squashed lie into a **crisp** one. Insert after `charts.js:641`:

```js
    // Honest floors. 10px type needs ~2.5x leading to read, so 4 gridline rows
    // need >=30px of spacing; below that the axis is decoration.
    const rows = plotH >= 128 ? 4 : plotH >= 68 ? 2 : 0;
    const bare = height < 140;      // no gridlines, no y-axis, no date labels
    if (height < 100) {             // not a small chart — a decoration pretending
      drawReadoutOnly(ctx, colors, series, options, { left, right, top: 8, bottom: height - 4 });
      geometry.delete(canvas);
      return;
    }
```

with `padTop = bare ? 14 : 42` and `padBottom = bare ? 4 : 30` at `charts.js:634-635` (14/4 is the sparkline's own budget, `app.js:9823-9824`), `rows` threaded into `drawPlotFrame` (replacing the hard `const rows = 4` at `charts.js:983`), `drawDateLabels` (charts.js:793) skipped when `bare`, and a `Math.min` guard so `plotH` is never below `plotW / 6` — otherwise a short screen still renders a 20% drawdown as a 0.9° flat line. `drawReadoutOnly` is ~8 lines: the figure at `colors.font(700, 17)` plus a 2px trend rule.

**7.3 Nice-number y-ticks.** Independent of 7.1 — a crisp axis reading `$50.5K / $50.4K / $50.2K / $50.1K / $49.9K` in a 48px gutter is still a grey smear, and on a $500k account all five compact to `$500K`, which is a silent lie. Before the loop at `charts.js:986`:

```js
    const raw  = (max - min) / rows;
    const mag  = 10 ** Math.floor(Math.log10(raw));
    const step = mag * [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw);
    const first = Math.ceil(min / step) * step;
```

Draw rules at `yFor(first + i * step)` rather than `top + (bottom-top)*i/rows`, and drop the 14% headroom at `charts.js:665-669` — the nice-number ceiling supplies it. If two adjacent formatted labels come out identical, fall back to `formatCurrency` for that axis.

**7.4** In `drawAllCharts` (charts.js:518), leave the `#drawdownChart` `paint()` call at 538-556 **exactly as it is**. It draws into a 871×180 offscreen bitmap nobody sees, costs nothing, and keeps `ui.drawdownChart` non-null forever.

---

## 8. STEP 6 — `index.html`

Six edits. Every one is inert to JS except where noted.

**8.1 The headline figure.** Insert immediately **before** `index.html:1508`:

```html
                <p class="metric-value dash-hero-value" data-metric="totalPnl">$0.00</p>
```

Do **NOT** relabel or rename `[data-metric="accountBalance"]`. `app.js:9703` feeds it `formatCurrency(analytics.accountBalance)` from `app.js:8587` (`accountBalance: currentBalance`), and `renderLiveEquity` at `app.js:14447` re-queries it by that exact attribute on every price poll. `analytics.totalPnl` already exists on the return object at `app.js:8586`.

**8.2 The label.** `index.html:1493` → `<p class="metric-label" id="dashBalanceLabel">Net P&amp;L</p>`, and add the equity tag immediately before line 1508's balance figure:

```html
                <span class="dash-hero-tag" id="dashEquityTag">Account balance</span>
```

**8.3 The stat strip.** Move the four keeper articles from `.dash-quad` into `.eq-footnotes`: `winRate` (1631-1635), `profitFactor` (1636-1640), `expectancy` (1641-1645), `avgWinLoss` (1646-1649) → append inside `.eq-footnotes` after `index.html:1807`. **Delete** `bestDay` (1650-1655) and `worstDay` (1656-1661) outright — the net-daily bars state both extremes plus the 28 facts between them, which is why the tiles existed. Then **delete the now-empty `<section class="dash-quad">` wrapper** (1630 and 1662).

Strip `dash-reveal` and `style="--i: N"` from the four moved articles — the reveal stagger was authored for a 6-tile row that no longer exists.

**8.4 The day-bars.** Inside the `.panel-span-4` article, change `index.html:1812` to `<h3>Net Daily P&amp;L</h3>` and insert after the `</canvas>` at 1821:

```html
              <div class="day-bars" id="dashDayBars" role="img" aria-label="Net profit or loss for each of the last 30 trading days"></div>
```

**8.5** Move `.dash-range` (1495-1499) and `#dashEstChip` (1494) out of `.dash-hero-top` into `.dash-head`, before `#journalNewTradeBtn` (1404). The EST chip then sits beside the range pill instead of 519px from the sentence it qualifies, and `#estimatedAnalyticsNotice` stays visually-hidden as `clay-v3.css:3690-3700` already made it. **The move is inert:** `ui.balanceRangeButtons` is `Array.from(querySelectorAll("[data-balance-range]"))` captured once at module load (app.js:384) and moving a node preserves its listeners; `syncBalanceRangeButtons()` (app.js:10152) reads that same array.

---

## 9. STEP 7 — `app.js`

Four edits. **TDZ rule honoured: no new module-level `const`/`let` anywhere. One function declaration (hoisted, safe at any line) and three in-place edits.**

**9.1 `renderDashboardMetrics` — three lines.** `ui.metricNodes` is a flat `querySelectorAll("[data-metric]")` at `app.js:377`, so a node present in the initial HTML is picked up for free.

- `app.js:9703`, inside `values`, add: `totalPnl: formatSignedCurrency(analytics.totalPnl),`
- `app.js:9720`, inside `tweens`, add: `totalPnl: { value: analytics.totalPnl, format: formatSignedCurrency },`
- `app.js:9737`, inside `toneValues`, add: `totalPnl: analytics.totalPnl,`

The existing loop at `app.js:9745-9763` then tweens it, tones it via `toneBySign` (app.js:12596), and toggles the card hairline. Zero new plumbing.

**9.2 `renderLiveEquity` — one line.** `app.js:14454`:

```js
  const label = document.getElementById("dashBalanceLabel");
```
→
```js
  // Retargeted: #dashBalanceLabel is the static "Net P&L" header now. The
  // balance/equity distinction belongs on the clause it qualifies.
  const label = document.getElementById("dashEquityTag");
```

Nothing else writes `#dashBalanceLabel` — grepped, this is the only writer.

**9.3 `renderDayBars` — one function, no canvas.** Insert as a function declaration after `renderDashMiniCal` closes at **`app.js:12349`**. It reuses `analytics.dailyPnl` (already a `Map` on the return object at `app.js:8581`) and the same `Math.abs / max` intensity shape `renderDashMiniCal` computes at `app.js:12320-12322`:

```js
/* The reference's spine, in DOM. No canvas: a new one would need its own
   dpr, its own hidden-view sizing and its own resize path, and drawBarChart
   (charts.js:1065) is horizontal-only — padLeft 138, rowGap = plotH/entries.length —
   so 30 dates would be 1020px of rows. CSS bars off a centreline inherit the
   theme tokens for free and cannot regress getCanvasContext. */
function renderDayBars(analytics) {
  const host = document.getElementById("dashDayBars");
  if (!host || !(analytics?.dailyPnl instanceof Map)) {
    return;
  }
  const days = [...analytics.dailyPnl].filter(([, pnl]) => pnl !== 0).slice(-30);
  const peak = Math.max(...days.map(([, pnl]) => Math.abs(pnl)), 1);
  host.innerHTML = days
    .map(([date, pnl]) =>
      `<span class="day-bar" data-s="${pnl > 0 ? 1 : -1}" style="--mag:${(Math.abs(pnl) / peak).toFixed(3)}" title="${escapeHtml(date)} · ${escapeHtml(formatSignedCurrency(pnl))}"></span>`
    )
    .join("");
}
```

Call it at **`app.js:12349`**'s caller — insert `renderDayBars(state.analytics);` immediately after `renderDashMiniCal();` at **`app.js:12248`**.

**9.4** Nothing else. `renderBalanceCard` already writes all five `.dash-now` figures (app.js:10349-10383) and `renderNowEvent` (app.js:10451) already reads the desk's own event ranking. Band B needs no new renderer — only the grid-area and the font sizes changed.

**CSS for the bars** (base scope, outside the media query, so it works below 1240 too):

```css
.day-bars { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 3px; min-height: 140px; }
.day-bar { position: relative; }
.day-bar::before { content: ""; position: absolute; left: 0; right: 0; top: 50%;
  height: calc(var(--mag) * 46%); background: var(--pnl-neg); border-radius: 0 0 2px 2px; }
.day-bar[data-s="1"]::before { top: auto; bottom: 50%; background: var(--pnl-pos); border-radius: 2px 2px 0 0; }
```

---

## 10. STEP 8 — short screens and below 1240

### 10.1 Short screens — `@media (min-width: 1240px) and (max-height: 960px)`

Budget at **1440×900**, measured live:

```
843 view box − 32 padding − 36 gaps                    = 775 of track
32 (A) + 88 (B) + 0.48×655 + 0.52×655
  = 32 + 88 + 314.398 + 340.594                        = 775 ✓
#dashboard.scrollHeight === clientHeight === 843            → NO SCROLL

#equityChart 750 × 216  (plot 676 × 144, ladder holds rows: 4)
#dashMiniCal cells 40 × 38   .dash-board-slot sh 339 in 341
```

```css
@media (min-width: 1240px) and (max-height: 960px) {
  #dashboard.is-active { grid-template-rows: 32px 88px minmax(0, 0.48fr) minmax(0, 0.52fr); }
  #dashboard.is-active .dash-hero { padding-block: 10px; }
  #dashboard.is-active [data-metric="totalPnl"] { font-size: 34px; line-height: 38px; }
  #dashboard.is-active [data-metric="accountBalance"] { font-size: 12px; line-height: 14px; margin-top: 3px; }
  #dashboard.is-active #dashHeroToday,
  #dashboard.is-active #dashNowOpen { font-size: 22px; line-height: 24px; }
  #dashboard.is-active .dash-now-fig { font-size: 17px; line-height: 19px; }
  #dashboard.is-active .eq-footnotes { flex: 0 0 52px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  #dashboard.is-active .mini-cal-footrow { display: none; }
  #dashboard.is-active .dem-tv { max-height: 120px; }
}
```

### 10.2 Below 1240 — measured at 1100×900, one fix needed

Nothing in the grid block applies. The page scrolls, as it always has. `.dash-now` stays inside `.dash-hero` (no DOM move), `.eq-footnotes` holds all nine in its existing `flex-wrap` row (970×30), `#drawdownChart` renders normally at 468×146, `#dashDayBars` renders at 468×140 off the base `min-height`, and the empty-state rule is unaffected.

The one live defect: `#estimatedAnalyticsNotice` measured 996×26, `white-space: nowrap`, `text-overflow: ellipsis` — a 126-character provenance sentence truncated mid-word on every tablet and narrow laptop. **Delete `clay-v3.css:3258-3260`** (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`). Keep 3254-3257. Below 1240 the page scrolls, so a two-line footnote costs nothing; above 1240 the note is clipped out of view regardless.

---

## 11. VERIFY

Run at exactly **1999×1150**, dashboard active, with a journal that has trades. One assertion per defect in the brief. Paste into the console:

```js
const $ = (s) => document.querySelector(s), d = $('#dashboard'), cs = getComputedStyle;
const box = (s) => { const e = $(s); const b = e.getBoundingClientRect();
  return { w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), sh: e.scrollHeight, ch: e.clientHeight }; };
console.table({
  1: ['padding 519px→0',     cs(d).padding === '16px'],
  2: ['column 107.7→148.25', cs(d).gridTemplateColumns.split(' ')[0] === '148.25px'],
  3: ['NO SCROLL',           d.scrollHeight === d.clientHeight && d.clientHeight === 1093],
  4: ['head no overprint',   box('.dash-head').sh <= 36],
  5: ['hero no spill',       box('.dash-hero').sh <= 109],
  6: ['equity box >= 330',   box('#equityChart').h >= 330],
  7: ['stat strip 40px',     box('.eq-footnotes').ch >= 40 && $$('.eq-footnotes > article').length === 9],
  8: ['charts side by side', box('.panel-span-8').w > 1000 && $('.panel-span-4').getBoundingClientRect().x > 1100],
  9: ['bitmap 1:1',          $('#equityChart').height === Math.floor(box('#equityChart').h * devicePixelRatio)],
 10: ['news above fold',     box('#dashEdgeMiniNews').bottom < 1150],
 11: ['rail spans C+D',      box('.dash-edge-mini').h > 850],
 12: ['discipline no blank', box('.dash-board-slot').ch - box('.dash-board-slot').sh <= 4],
 13: ['playbook no blank',   box('#dashPlaybook').ch - box('#dashPlaybook').sh <= 4],
 14: ['tiles no clip',       [...$$('.metric-card')].every(e => e.scrollHeight <= e.clientHeight + 2)],
 15: ['calendar <= 470w',    box('#dashMiniCal').w <= 470 && box('.mini-cal-day').h >= 44],
 16: ['NET P&L printed',     !!$('[data-metric="totalPnl"]') && parseInt(cs($('[data-metric="totalPnl"]')).fontSize) === 44],
 17: ['now layer visible',   cs($('.dash-now')).display === 'grid' && box('.dash-now').w > 1300],
 18: ['balance is a clause', parseInt(cs($('[data-metric="accountBalance"]')).fontSize) === 13],
 19: ['notice not on floor', box('#estimatedAnalyticsNotice').w <= 2],
 20: ['drawdown box gone',   cs($('#drawdownChart')).display === 'none' && !!window.ui?.drawdownChart !== false],
 21: ['day bars drawn',      $$('#dashDayBars .day-bar').length > 0],
 22: ['<=6 raised surfaces', [...$$('#dashboard *')].filter(e => cs(e).boxShadow.includes('rgb') && e.offsetParent).length <= 12],
});
```

**Then five state checks that no static assertion catches:**

| # | State | Expected |
|---|---|---|
| 23 | `dashboardEmptyState.hidden = false` | only `.dash-head` and `#dashboardEmptyState` have a box. **Verified:** `clay-v3.css:3703` is (3,2,1) and beats `display: contents` at (1,2,0) — `.panel-grid-analytics` is a direct child of `#dashboard` (index.html:1743), so the migrated stat cards are covered. **Check this FIRST, before any pixel tuning.** |
| 24 | `dashEdgeMini.hidden = true` | bars panel and discipline widen to 789px; `SH === CH === 1093`. Measured. |
| 25 | `dashPlaybook.hidden = true` | calendar widens to 789px, discipline starts at col 6; `SH === CH === 1093`. Measured. Without the `[hidden]` guard in §6 this leaves a 629px ghost. |
| 26 | Navigate to Journal and back | `#equityChart` redraws at 1076×340, not 900×280 — proves the `clientHeight` fallback chain survives a display:none round trip. |
| 27 | `#dashEdgeMiniTv` iframe | still playing after every one of the above. If it stopped, something took a `display:none` on an ancestor. |

**And at 1440×900:** `d.scrollHeight === d.clientHeight === 843`, `.mini-cal-day` height ≥ 36, `#equityChart` height ≥ 200.

---

## 12. What I deliberately did NOT do

**The radar → horizontal bars swap.** `drawRadarChart` (charts.js:1441-1617) is genuinely the wrong form for six normalised magnitudes — the polygon area, which dominates the read, depends on the arbitrary axis order at `app.js:9356-9362`. Swapping it for the existing `drawBarChart` would delete ~180 lines. But `#dashDepth` is a closed `<details>` off this grid (clay-v3.css:3711), so the swap changes nothing the owner is judging, and it touches a shared drawing routine on the same night as the canvas-sizing fix. Separate PR.

**`#dashRecent`, the closed-trades ledger.** ~12 lines over `getClosedTrades().slice(-11).reverse()`, and probably the read a trader performs most. There is no 13th column and no fifth row for it. If band D reads thin after the owner sees this, it takes the playbook's slot in one `grid-area` swap. Written down here so nobody re-plans it.

**The drawdown as a shared-x underwater subplot.** `options.underwater` already exists at `charts.js:653-655`, so it is a placement change rather than new code, and a drawdown you can see the SHAPE of does beat two figures restating its endpoints. It costs the equity curve ~60px and adds a second sizing path to the panel I am rebuilding tonight. The drawdown survives as three readable figures — `maxDrawdown` and `currentDrawdown` in the stat strip, `#dashNowHighs` in band B — where it was previously a 147px box restating numbers printed twice elsewhere. Add the subplot next, as `grid-template-rows: minmax(0,1fr) 106px` on the equity panel.

**Re-scoping `styles.css:9929` to `max-width: 1239px`.** Two directions proposed it "because that is what its comments describe." Its comments describe intent; its declarations are a two-column sticky-rail desktop grid. Flipping the query would apply that to every phone. Deleted instead.

**A 64px hero.** 44px is the ship value. If the first read still does not land, the lever is the figure, not the gap — 44 → 64 is one declaration, and it is the FIRST thing to try before anyone proposes filling band B's deliberate air.

**Chasing the last 14px of `.eq-footnotes` overflow.** It is inside an `overflow: hidden` panel, invisible, and the equity canvas already absorbs it (`SH === CH === 1093` holds). The named one-line fallback is in §6. Spending another hour there is how the other four attempts ran out of time before the layout landed.

**Reversibility, as a working rule.** Every judgement call here reverts in one declaration, never a rewrite: the stat-strip move reverts by putting `.dash-quad` back at `2 / 4 / 3 / -1`; the deleted `.panel-head p` by one `display`; the calendar size by one `grid-area`; the day-bars by one `display: none` and un-hiding `#drawdownChart`. This user has rejected four attempts. The cost of attempt six being wrong should be minutes.