All measurements are in. Writing the delta.

---

# CORRECTED PLACEMENT SPEC — delta against `plans/11-reference-exact.md`

**Chosen: Allocation A.** Rail at lines 9→13 (4 cols, **629.00px** = 2.0389x the spec's 308.50 two-column slot), spanning both fr rows. Bands A, B and C stay full-bleed 12 columns.

Everything below was measured on the running page at `http://127.0.0.1:8010` in an isolated tab (guest demo journal, banner dismissed so `--chrome-h` reads 57 and `#dashboard` is 1943x1093). Nothing was written to disk; `git status` shows only the sibling's pre-existing `D __allocB.js` and `node tests/instrumentPanel.check.mjs` is still OK.

---

## 0. Why A, in two measurements

**The one that rules out B and C.** Band C's `.dash-now` carries six live figures. I measured its natural no-wrap width by cloning it into a `width: max-content` host under §5.2's band-C flex rules:

| content | no-wrap width | 12-col track (A) | 8-col track (B, C) |
|---|---|---|---|
| this journal, idle | 877.84 | fits @1440 (1352) | fits @1440 (897.33) |
| realistic loaded strings | **1097.43** | fits @1440, **254.57 slack** | **CLIPS BY 200.10** |

Loaded strings: `-$12,345.67 · 7 TRADES / -$123,456.78 / -$12,345.67 / 14 DAYS / NFP · 3H 42M / -$123,456.78`. `.dash-now` is `overflow: hidden`, so the clip is silent. B and C both pay for their extra rail rows by narrowing band C, and both then need two of six live figures deleted below 1240x960. **A narrows band C by nothing.**

**What A gives up for that.** The rail is 860.99 tall instead of C's 892.99 — 32px less. Measured cap sweep at 1999x1150, reading `#dashEdgeMiniPanel.scrollHeight − clientHeight` and the picture's overlap onto `#dashEdgeMiniNews`:

| docked picture cap | tile | picture | panel hidden | paints over feed |
|---|---|---|---|---|
| 605 (natural 16:9) | 351.31 | 605 x 340.31 | **95** | 0 |
| 493 (allocation C's) | 288.31 | 493 x 277.31 | **32** | 0 |
| **432** | **254** | **432 x 243** | **0** | **0** |
| 420 | 247.25 | 420 x 236.25 | 0 | 0 |

432px is the largest docked picture that fits A's 810px panel with zero hidden feed. C buys 57px more picture width for 200px of silently clipped band C on every laptop. Not a trade worth making.

**Two other load-bearing counterfactuals, both reproduced at 1440x900** — these force the column split, they are not taste:

- Edge score at **2 columns**: radar canvas **181 x 194**, width term `(181−150)/2 = 15.5` → radius **PINNED at 46**. The 92px-circle regression `charts.js:1515-1518` documents. At 3 columns: 295 x 194 → radius 52.
- Rows at **0.48/0.52**: radar 295 x 169 → **PINNED**. Rows at **0.42/0.58** (today's shipped split, `clay-v3.css:3657`): radar 295 x 131 → **PINNED**, and `#equityChart` lands at 143 — three pixels above the `bare = height < 140` cliff at `charts.js:636`. Only **0.52/0.48** survives.

---

## 1. `grid-template-rows` — unchanged from spec §1

**`clay-v3.css:3657`** (today `36px 108px minmax(0, 0.42fr) minmax(0, 0.58fr)`) becomes:

```css
    /* 1093 view box − 32 padding-block − 48 row gaps = 1013 of track.
       fixed 36+108+20 = 164 · pool 849 · 0.52x849 = 441.48 · 0.48x849 = 407.52
       36 + 108 + 20 + 441 + 408 = 1013.
       NOT a free dial. Measured at 1440x900 on this five-band grid: 0.48/0.52
       puts the radar canvas at 169 and 0.42/0.58 at 131, and drawRadarChart
       (src/modules/charts.js:1519) pins its 46px floor at both. 0.52 is forced. */
    grid-template-rows: 36px 108px 20px minmax(0, 0.52fr) minmax(0, 0.48fr);
```

Measured computed value: `36px 108px 20px 441.477px 407.516px`. `#dashboard.scrollHeight === clientHeight === 1093`.

Keep the two lines above it byte-identical — `tests/instrumentPanel.check.mjs:139` anchors on the literal `"#dashboard.is-active {\n    grid-template-columns"` after comment-stripping.

**Columns.** Pitch is unchanged: `.view.is-active#dashboard { padding-inline: var(--space-4) }` (**`clay-v3.css:3886`**) → 1911 usable, `(1911 − 11x12)/12 = 148.25` exactly (measured on all twelve tracks).

```
2 col = 308.50   3 col = 468.75   4 col = 629.00   5 col = 789.25   8 col = 1270.00
band D  468.75 + 12 + 468.75 + 12 + 308.50 = 1270.00
band E  468.75 + 12 + 789.25             = 1270.00
board   1270.00 + 12 + 629.00            = 1911 ✓   (rail x 1354 → right edge 1983)
```

At 1440x900: pitch 101.664, `2 col 215.33 · 3 col 328.99 · 4 col 442.66 · 5 col 556.32 · 8 col 897.31`; `897.33 + 12 + 442.67 = 1352` ✓.

---

## 2. Bands D and E — replaces §5.4's rules

§5.4 was written against a 2-column rail at lines 11→13. Every one of its area values moves. Named by selector:

| §5.4 rule | fate | current address |
|---|---|---|
| `.panel-grid-analytics { display: contents }` | **KEEP verbatim** | `clay-v3.css:3959` |
| `.panel-grid-analytics > #dashEdgeScore` | **REWRITE** `4/1/5/4` (unchanged value, but §5.4 wrote it and it must be re-anchored to row 4) | `clay-v3.css:3962` |
| `.panel-grid-analytics > .panel-span-8` | **REWRITE** `4/4/5/8` → `4/4/5/7` | `clay-v3.css:3960` |
| `.panel-grid-analytics > .panel-span-4` | **REWRITE** `4/8/5/11` → `4/7/5/9` | `clay-v3.css:3961` |
| `.panel-grid-analytics > #dashLedger` | **REWRITE** `5/1/6/5` → `5/1/6/4`, **plus `overflow: hidden`** (§4) | `clay-v3.css:3963` |
| `#dashMiniCal` | **REWRITE** `5/5/6/11` → `5/4/6/9` | `clay-v3.css:4008` |
| `#propTracker` | **REWRITE** `5/5/6/11` → `5/4/6/9` | `clay-v3.css:3977` |
| `.dash-edge-mini` `grid-area` | **REWRITE** `4/11/6/-1` → `4/9/6/-1` | `clay-v3.css:3986` |
| `:has(#propTracker:not([hidden])) #dashMiniCal { display:none }` | **KEEP verbatim** | `clay-v3.css:3978` |
| `#drawdownChart { display: none }` | **KEEP verbatim, LOAD BEARING** | `clay-v3.css:3970` |
| `#dashPlaybook, .dash-board-slot { display: none }` | **KEEP verbatim** | `clay-v3.css:3975-3976` |
| `.mini-cal-footrow { display: none }` / `.mini-cal-open { min-height: 0 }` | **KEEP verbatim** | new, per §5.4 |
| the four `:has(.dash-edge-mini[hidden])` close-up lines | **REWRITE** — see §5 | `clay-v3.css:4014-4015` |

**DELETED outright: nothing in §5.4.** Every rule survives; seven change their area value.

The replacement block, in place of `clay-v3.css:3956-3963`:

```css
  /* ── BAND D: WHERE IS MY EDGE ──────────────────────────────────────────
     display:contents places the panels directly on the outer grid, which is
     what kills .panel-span-8's `grid-column: span 8` clamp without a new
     override. Content region is lines 1→9 (8 cols, 1270.00); the rail takes
     9→13 (4 cols, 629.00 — twice the reference's 308.50) and spans both fr
     rows. 1270 + 12 + 629 = 1911.

     3 : 3 : 2 IS NOT A TASTE CALL. Edge score keeps 3 columns because
     drawRadarChart (src/modules/charts.js:1519) reads the canvas's own CSS box
     and a 2-column panel at 1440x900 gives it 181px of width — (181−150)/2 =
     15.5 — which pins the 46px floor: the 92px-circle regression documented at
     charts.js:1515-1518. Net daily P&L takes the 2 because it is the only one
     of the three that degrades continuously (.day-bars is grid-auto-columns:
     minmax(0,1fr), clay-v3.css:3315, which never clamps) instead of falling off
     a cliff. Do not "rebalance" this to 2:3:3 to match the reference. */
  #dashboard.is-active .panel-grid-analytics { display: contents; }
  #dashboard.is-active .panel-grid-analytics > #dashEdgeScore { grid-area: 4 / 1 / 5 / 4; }
  #dashboard.is-active .panel-grid-analytics > .panel-span-8  { grid-area: 4 / 4 / 5 / 7; }
  #dashboard.is-active .panel-grid-analytics > .panel-span-4  { grid-area: 4 / 7 / 5 / 9; }

  /* ── BAND E: WHAT DID IT COST ──────────────────────────────────────────
     overflow:hidden is the ledger's own renderer's stated contract —
     app.js:12465 says "The panel is overflow:hidden" and it is not: .panel
     computes overflow:visible, so a row count rendered against a taller box
     propagates straight into #dashboard's scrollHeight. Measured on the first
     flip: 1165 vs 1093 at 1999 and 927 vs 843 at 1440. renderDashLedger is only
     reached from renderAll (app.js:8259), which resize never calls. One
     declaration makes the no-scroll promise structural instead of
     renderer-timing-dependent. */
  #dashboard.is-active .panel-grid-analytics > #dashLedger { grid-area: 5 / 1 / 6 / 4; overflow: hidden; }
  #dashboard.is-active #dashMiniCal { grid-area: 5 / 4 / 6 / 9; }
  #dashboard.is-active #propTracker { grid-area: 5 / 4 / 6 / 9; }
```

Measured at 1999x1150 (x, y, w, h — `w`/`h` from `offsetWidth`/`offsetHeight`; `.dash-reveal` leaves a `translateY(14px)` on the analytics panels, so their rect `y` reads 14 high):

```
.dash-head        72,  73, 1911.00,  36.00     lines 1→13
.dash-hero        72, 121, 1911.00, 108.00     lines 1→13  (clientWidth 1911; the article paints 1888.07 inside its own inset)
.dash-now         72, 241, 1911.00,  20.00     lines 1→13  sw 1911 === cw 1911
#dashEdgeScore    72, 287,  468.75, 441.48     lines 1→4
.panel-span-8    552.75, 287, 468.75, 441.48   lines 4→7
.panel-span-4   1033.50, 287, 308.50, 441.48   lines 7→9
#dashLedger       72, 726.48, 468.75, 407.52   lines 1→4   sh 406 === ch 406
#dashMiniCal     552.75, 726.48, 789.25, 407.52 lines 4→9
.dash-edge-mini 1354, 273,  629.00, 860.99     lines 9→13, rows 4→6
```

At 1440x900: `1352/32 · 1352/88 · 1352/18 · 329/325 · 329/325 · 215.33/325 · 329/300 · 556.33/300 · rail 442.67/637`.

---

## 3. The rail — `clay-v3.css:3986`, and the cap the doubled width breaks

```css
    grid-area: 4 / 9 / 6 / -1;   /* 4 cols, 629.00 = 2.0389x the reference's
                                    308.50; both fr rows plus the 12px between
                                    them = 441.477 + 12 + 407.516 = 860.99 */
```

**This is the part of the spec the wider rail actually invalidates.** `.dem-tv` computes `overflow: visible` and `.dem-tv .bb-mon` carries `aspect-ratio: 16 / 9` (**`styles.css:9668`**). At 627px of rail the picture lays out **605 x 340.31** against a 168px tile cap, and paints **183.31px straight over `#dashEdgeMiniNews`**. `#dashEdgeMiniPanel` reports `scrollHeight === clientHeight === 810`, zero hidden — a lie, because visible overflow does not enter a scroll box. **This ships today** (`clay-v3.css:3986` already places the rail at 4 columns) and is invisible at 2 columns, where the picture is only 284.5 x 160.03.

**`clay-v3.css:3996`** `#dashboard.is-active .dem-tv { max-height: 168px; }` becomes:

```css
  /* THE 16:9 TILE TURNS WIDTH INTO HEIGHT. At the 4-column rail the picture
     wants 605 x 340.31 and .dem-tv is overflow:visible, so without a cap it
     paints 183.31px over the news column — measured. 432 is the largest
     picture the 810px panel holds with ZERO hidden feed and ZERO overlap:
     432 x 243 (16:9) + 11 of tile padding = 254 in a 256 box, leaving
     253.55 news + 256.28 wire + 44 key. Sweep: 605 → 95 hidden, 493 → 32,
     436 → 0 but 0.25 of overhang, 432 → 0 and 0.
     THE :not(.is-tv-out) IS LOAD BEARING, NOT PADDING. clay-v3.css:4211-4217
     gives the popped-out .bb-mon width/height/max-height and never max-width,
     so an unscoped cap survives into the popout: measured, the fixed frame is
     919.54 x 517.23 and the picture stays 432 x 243 inside it. */
  #dashboard.is-active .dem-tv { max-height: 256px; }
  #dashboard.is-active .dash-edge-mini:not(.is-tv-out) .dem-tv .bb-mon {
    max-width: 432px;
    margin-inline: auto;
  }
```

Measured docked at 1999x1150: tile 627 x 254, picture **432 x 243**, `#dashEdgeMiniPanel` 810 = 810 (**0 hidden**), picture-over-news **0**, `.dem-key` bottom clears the panel by 2.16px.

Against the reference's own 2-column rail, measured on the same DOM: rail 308.50 x 860.99, picture **284.5 x 160.03**, panel **136px behind a nested scroller**. So the doubled rail delivers **2.31x the docked picture area and removes the reference rail's 136px scroller entirely.**

Do **not** write the cap as `!important` and do **not** put it on `.dem-tv` alone. Also rejected by measurement: `max-height: 100%; width: auto` on `.bb-mon` — the picture still renders 605 x 340.31 and overflows the tile by 84px.

---

## 4. `#dashLedger { overflow: hidden }`

Stated above inside the band-E rule. Verified: before it, the first read after the flip was `#dashboard.scrollHeight 1165 vs clientHeight 1093` at 1999 and `927 vs 843` at 1440 — the culprit is `TABLE.dash-ledger` at 434.75 x 406 with `getComputedStyle(#dashLedger).overflow === "visible"`. After it, `1093 === 1093` **before** the trim loop runs at all; the shipped loop (`app.js:12467-12470`) then settles at 13 rows at 1999 and 9 at 1440, panel 406 = 406 and 298 = 298.

Note for §1's table: the shipped renderer fills the panel, so the ledger table measures **434.75 x 238** (9 rows) at 1999, not the `595 x 166` §1 records. `getComputedStyle(.dash-ledger).min-width` is `"0px"` and `scrollWidth === clientWidth === 435` — the global `table { min-width: 980px }` (**`styles.css:3537`**) is already dead via **`clay-v3.css:4126-4130`**.

---

## 5. The `:has([hidden])` reflow — `clay-v3.css:4014-4015`

In allocation A the rightmost item of band D is `.panel-span-4` and of band E is `#dashMiniCal` — **exactly the two the shipped rule already names.** It needs two additions only:

```css
  #dashboard.is-active:has(.dash-edge-mini[hidden]) .panel-grid-analytics > .panel-span-4,
  #dashboard.is-active:has(.dash-edge-mini[hidden]) #dashMiniCal,
  #dashboard.is-active:has(.dash-edge-mini[hidden]) #propTracker,
  #dashboard.is-active:has(.dash-edge-mini[hidden]) #dashboardEmptyState { grid-column-end: -1; }
```

Measured free state at 1999 (`#dashEdgeMini.hidden`): `.dash-now` 1911 · `.panel-span-4` 308.50 → **949.50** · `#dashMiniCal` 789.25 → **1430.25** · `#dashLedger` unchanged 468.75 · day bar 6.25 → 27.61 · **no overlap** (1033.5+949.5 = 1983 and 552.75+1430.25 = 1983, both the right padding edge) · board 1093 === 1093. With `#propTracker` showing: 779.78 pro / 1413.09 free, calendar `display: none`, no scroll.

§5.2's `.dash-now` is already `3 / 1 / 4 / -1`, so it needs no close-up rule — this is band C's dividend.

**§5.5 stands verbatim, and I re-proved its specificity claim.** With `#dashboardEmptyState` showing, the cull at **`clay-v3.css:4062-4065`** closes the rail: measured `display: none`, rail 0x0. `> .dash-edge-mini` at (2,3,0) **loses** — still 0x0. `> #dashEdgeMini:not([hidden])` at (3,3,0) **wins** — rail 629 x 860.99 at (1354, 273), empty panel 422 x 287.2 at (816.5, 483.9), no overlap, board 1093 === 1093 — and with `hidden` set it still closes. Insert immediately after `clay-v3.css:4065`.

---

## 6. Short screens — rewrite `clay-v3.css:4080-4091`, measured at 1440x900

```css
@media (min-width: 1240px) and (max-height: 960px) {
  /* 843 − 32 padding − 48 gaps = 763 of track.
     fixed 32+88+18 = 138 · pool 625 · 0.52x625 = 325 · 0.48x625 = 300, both exact. */
  #dashboard.is-active { grid-template-rows: 32px 88px 18px minmax(0, 0.52fr) minmax(0, 0.48fr); }
  #dashboard.is-active .dash-hero { padding-block: 10px; }
  #dashboard.is-active .strip-cell { gap: 2px; }
  #dashboard.is-active .strip-cell .metric-value,
  #dashboard.is-active [data-metric="totalPnl"],
  #dashboard.is-active .dash-hero-value,
  #dashboard.is-active .trader-score-value { font-size: 22px; line-height: 24px; }
  /* (1,3,0), because the rule above is (1,3,0) and §5.9's own
     [data-metric="accountBalance"] form is (1,2,0) and LOSES to it. */
  #dashboard.is-active .dash-hero-equity .metric-value { font-size: 12px; line-height: 14px; }
  #dashboard.is-active .dash-hero-equity { margin-top: 3px; }
  #dashboard.is-active .gauge { width: 28px; height: 28px; }
  #dashboard.is-active .eq-footnotes { flex: 0 0 40px; grid-template-rows: 16px 16px; row-gap: 8px; }
  /* Tiles are 33.33 here: 8 padding + 10 index + 13 money = 31. The count is
     the line that does not fit. */
  #dashboard.is-active .mini-cal-day .mc-n { display: none; }
  /* THE WEEK TOTAL BLEEDS LEFT AND scrollWidth WILL NEVER TELL YOU — a
     justify-content:flex-end flex box does not report leftward overflow, and
     the cell measures 57 === 57 while overflowing. At 11px/4px the content box
     is 49 and "-$12,480" is 52.80 (+3.80) and "-$123,456" is 59.41 (+10.41).
     At 9px with 2px side padding: 53 of box, 48.60 of text, clears by 4.40 —
     and 9px is the ramp .mc-n already uses at clay-v3.css:4007. */
  #dashboard.is-active .mini-cal-week { font-size: 9px; padding: 4px 2px; }
  /* A 667px rail cannot hold a 16:9 picture, a wire and a feed at any width —
     see COST 5. The pair below is the same shape as the tall block: the
     picture is capped and the tile follows it, so nothing paints over the feed.
     284 x 159.75 is exactly what the reference's 2-column rail shows at
     1999x1150. Measured hidden: 194px picture → 184, 284 → 234, 418 → 310. */
  #dashboard.is-active .dem-tv { max-height: 171px; }
  #dashboard.is-active .dash-edge-mini:not(.is-tv-out) .dem-tv .bb-mon { max-width: 284px; }
}
```

Measured at 1440x900 with the block live: rows `32px 88px 18px 325px 300px`, `#dashboard.scrollHeight === clientHeight === 843` and `scrollWidth === clientWidth === 1384` **before** the ledger trim as well as after. Radar canvas 295 x 194 → radius **52** (clears 46 by 6 — §1's "203 → 56.5" and allocation A's "196 → 53" are both high; the measured value on this grid is 52). Equity 295 x 205, `compact` true, `bare` false. Calendar tracks `63.8359 x7 + 57.4531`, tile 63.84 x 33.33. Day bars host 181.33, bar **3.141** against a 3px gutter. Ledger table 295 x 238, `scrollWidth === clientWidth`. `.dash-now` 1352 === 1352. Rail 442.67 x 637, tile 440.67 x 170.75, picture 284 x 159.75, overlap 0, panel 586 vs 820 → **234px behind its own scroller**.

---

## 7. What else the spec says that measurement changes

| spec item | verdict |
|---|---|
| **§5.4's `.dem-tv` cap** | The 168px cap is what the doubled rail invalidates. Replaced above, §3. This is the only rule the wider rail actually breaks. |
| **§5.4's `:has([hidden])` close-up** | Stands in shape; two selectors added (§5). `.dash-now` needs none — it never leaves 12 columns. |
| **§5.6, the calendar's 8th column** | **Stands verbatim.** Rewrite `clay-v3.css:3161` to `repeat(7, minmax(0, 1fr)) minmax(0, 0.9fr)` and extend `clay-v3.css:3369-3370`. Measured with the emitter in place: tracks `93.3203 x7 + 83.9844`, tiles **93.32 x 51.25**, week cell 83.98 x 51.25 at 1999; 7 columns / 7 visible headers / 44px tiles at 375x812. **BUILD HAZARD REPRODUCED:** with the column rule live and no `.mini-cal-week` emitter, the 37 flat cells auto-flow into 8 tracks and land under the wrong weekday. §5.6 and §7i are ONE commit, never the column first. |
| **§5.7, the Edge score foot** | **Stands verbatim at (1,2,0).** Allocation C's demand for an `#dashEdgeScore` qualifier is dead weight: `styles.css:8062` is a bare `.trader-score-foot` at **(0,1,0)** and `#dashboard.is-active .trader-score-foot` beats it on every axis. A/B measured on the same DOM — spec form: margin-top 8px, canvas 435 x 310, radius 110. ID form: margin-top 8px, canvas 435 x 310, radius 110. Identical. Without §5.7 at all: canvas 435 x 269, radius 89.5. Do not add the qualifier. |
| **§5.7's "pins the floor without it" claim** | Does not reproduce on this grid. Removing the foot rule at 1440 gives canvas 295 x 186 → radius 48, still clear. §5.7 buys 8px of canvas here, not rescue. Ship it anyway; correct the claim. |
| **§5.8, `.eq-footnotes` at six** | **Unaffected by the rail width.** The panel is 3 columns in this allocation and in the spec's, and `.eq-footnotes` lives inside it. `grid-template-columns: repeat(3, …)` × 2 rows still holds. Ship as written. |
| **§5.10's "self-reinforcing canvas fixed point"** | Does not exist on this build. `getComputedStyle(#traderScoreChart).flex` reads `1 1 0px` — the canvas is a flex item of `.panel-grid-analytics > .panel` (**`clay-v3.css:3717`**, `display: flex; flex-direction: column`), so `height: auto` never falls back to the bitmap ratio. Stable at 435 x 310 across every resize I forced. **Do not add a `height: 100%` pin** — that re-states the track as an answer rather than a ceiling. §5.10's own `#traderScoreChart { height: 260px }` below 1240 stays; that branch is not flex. |
| **§4.2 / §5.2, band B** | **Untouched.** Band B keeps its full 12 columns, so §5.2's `grid-area: 2 / 1 / 3 / -1` and its five 1.3/1/1/1/1.2fr tracks stand as written. The strip-cell wrap that an 8-column strip produces does not arise here. §5.2's instruction to delete `#dashboard.is-active .dash-hero > * { grid-column: 1 }` (**`clay-v3.css:3923`**) is still load bearing — leave it in and all five cells stack in track 1. |
| **§5.9's `[data-metric="accountBalance"]` override** | **Real spec defect, fixed above.** `#dashboard.is-active .strip-cell .metric-value` is (1,3,0); `#dashboard.is-active [data-metric="accountBalance"]` is (1,2,0) and loses despite being written later. The clause renders at 22px. Restated at (1,3,0) via `.dash-hero-equity .metric-value`. |

---

## 8. Build order — every step ships and no step scrolls

Run `node tests/instrumentPanel.check.mjs` after each.

| step | what | why it is shippable |
|---|---|---|
| **1** | **`#dashLedger { overflow: hidden }` alone**, added to `clay-v3.css:3963`. | Independent of the flip and needed by it. On today's four-band grid it changes nothing visible; it makes the panel honour the contract `app.js:12465` already claims. Land it first so the flip cannot regress the no-scroll promise. |
| **2** | **The `.dem-tv` cap pair** (§3), on today's grid. | Fixes a bug that ships **right now**: `clay-v3.css:3986` already puts the rail at 4 columns and the picture already paints 183.31px over the news feed. One value change + one new rule. Revertable alone. |
| **3** | **Calendar 8th column + `.mini-cal-week` emitter** — §5.6 and §7i, replacing `app.js:12366` (`ui.miniCalGrid.innerHTML = tiles.join("")`). **Same commit, never split.** | Purely additive on the current 3-column calendar; the extra track and the extra cell arrive together so no day ever lands under the wrong weekday. |
| **4** | **Band B strip + band C line** — §4.2, §4.3, §5.2, §5.3, §7e, §7f, plus the §5.9 `.dash-hero-equity .metric-value` fix. Test edit: `tests/instrumentPanel.check.mjs:201`, `figures` 9 → 6. | `.dash-now` moves out of `.dash-hero` in the same commit as the CSS that places it. On the four-band grid it lands unplaced in the implicit flow for one commit — ugly, never broken. |
| **5** | **The flip**: rows (`clay-v3.css:3657`), the seven grid-areas (§2), the reflow additions (§5), the §5.5 escape, the short-screen block (§6). Test edits: lines **142, 145, 147, 149**. | This is the only step that must land whole. Everything it places already exists in the DOM — `#dashEdgeScore` at `index.html:1760` and `#dashLedger` at `index.html:1890` both ship today. |
| **6** | §5.10's below-1240 block. | Degradation only. |

**Test edits, exact.** `tests/instrumentPanel.check.mjs`:

- **line 142** → `assert.equal(tall, "36px 108px 20px minmax(0, 0.52fr) minmax(0, 0.48fr)", …)`
- **line 145** → `assert.equal(rowsOf(shortDecls), "32px 88px 18px minmax(0, 0.52fr) minmax(0, 0.48fr)", …)`
- **line 147** → `assert.equal(36 + 108 + 20 + Math.round(0.52 * 849) + Math.round(0.48 * 849), 1013, …)` (verified: 1013 = 1093 − 32 − 48)
- **line 149** → `assert.equal(32 + 88 + 18 + Math.round(0.52 * 625) + Math.round(0.48 * 625), 763, …)` (verified: 763 = 843 − 32 − 48)
- **line 201** → `assert.equal(figures, 6, …)`, with step 4

**Guard 6 (`tests/instrumentPanel.check.mjs:126-130`) stays green.** I ran its regex `/\.dash-edge-mini[^{]*\{[^}]*display:\s*none/` over the comment-stripped text of every rule this delta adds — including the `:not(.is-tv-out) .dem-tv .bb-mon` cap and the `:has(.dash-edge-mini[hidden])` reflow — and it does not match. Guard 5's `/:has\(\.dash-edge-mini\[hidden\]\)/` still matches. No `app.js` change is required by this delta, so "no new module-level `const`/`let` below `init()`" holds by construction.

---

## 9. VERIFY — paste into the console at 1999x1150

Dismiss the demo banner first so `--chrome-h` reads 57. Widths and heights come from `offsetWidth`/`offsetHeight`: `.dash-reveal` leaves a `translateY(14px)` on the analytics panels, so their rect `y` reads 14px low.

```js
(() => {
  const ok = [], bad = [];
  const T = (name, got, want, tol = 0.02) => {
    const pass = Array.isArray(want)
      ? want.every((w, i) => Math.abs(got[i] - w) <= tol)
      : Math.abs(got - want) <= tol;
    (pass ? ok : bad).push(`${name}: ${JSON.stringify(got)}${pass ? "" : "  WANT " + JSON.stringify(want)}`);
  };
  const d = document.getElementById("dashboard");
  const box = el => [el.offsetWidth, +el.offsetHeight.toFixed(2)];
  const x  = el => +el.getBoundingClientRect().x.toFixed(2);
  const q  = s => document.querySelector(s);

  // ── the board ────────────────────────────────────────────────────────────
  T("#dashboard client",   [d.clientWidth, d.clientHeight], [1943, 1093]);
  T("#dashboard NO SCROLL",[d.scrollWidth, d.scrollHeight], [1943, 1093]);
  T("rows", getComputedStyle(d).gridTemplateRows === "36px 108px 20px 441.477px 407.516px" ? 1 : 0, 1);

  // ── one per panel: width, height, left edge ──────────────────────────────
  T("A .dash-head",      [...box(q(".dash-head")),      x(q(".dash-head"))],      [1911, 36, 72]);
  T("B .dash-hero",      [q(".dash-hero").clientWidth,  q(".dash-hero").clientHeight], [1911, 108]);
  T("C .dash-now",       [...box(q(".dash-now")),       x(q(".dash-now"))],       [1911, 20, 72]);
  T("D #dashEdgeScore",  [...box(q("#dashEdgeScore")),  x(q("#dashEdgeScore"))],  [468.75, 441.48, 72]);
  T("D .panel-span-8",   [...box(q(".panel-span-8")),   x(q(".panel-span-8"))],   [468.75, 441.48, 552.75]);
  T("D .panel-span-4",   [...box(q(".panel-span-4")),   x(q(".panel-span-4"))],   [308.50, 441.48, 1033.50]);
  T("E #dashLedger",     [...box(q("#dashLedger")),     x(q("#dashLedger"))],     [468.75, 407.52, 72]);
  T("E #dashMiniCal",    [...box(q("#dashMiniCal")),    x(q("#dashMiniCal"))],    [789.25, 407.52, 552.75]);
  T("RAIL 4col=2x",      [...box(q(".dash-edge-mini")), x(q(".dash-edge-mini"))], [629.00, 860.99, 1354]);
  T("board closes", 1270 + 12 + 629, 1911);

  // ── nothing clips sideways, nothing scrolls inside ───────────────────────
  [".dash-now", "#dashEdgeScore", ".panel-span-8", ".panel-span-4", "#dashLedger", "#dashMiniCal"]
    .forEach(s => T(`${s} sw===cw`, [q(s).scrollWidth - q(s).clientWidth], [0]));
  T("#dashLedger clipped", getComputedStyle(q("#dashLedger")).overflow === "hidden" ? 1 : 0, 1);
  T("#dashLedger sh===ch", [q("#dashLedger").scrollHeight - q("#dashLedger").clientHeight], [0]);

  // ── the panels that carry hard floors ────────────────────────────────────
  const rad = document.getElementById("traderScoreChart");
  const radius = Math.max(Math.min((rad.clientWidth - 150) / 2, (rad.clientHeight - 90) / 2), 46);
  T("radar canvas", [rad.clientWidth, rad.clientHeight], [435, 310]);
  T("radar radius OFF the 46 floor", radius, 110);
  const eq = document.getElementById("equityChart");
  T("equity canvas", [eq.clientWidth, eq.clientHeight], [435, 322]);
  T("equity compact===false", eq.clientWidth < 430 ? 1 : 0, 0);
  T("equity bare===false",    eq.clientHeight < 140 ? 1 : 0, 0);
  const g = document.getElementById("miniCalGrid");
  T("calendar 8 tracks", getComputedStyle(g).gridTemplateColumns.split(" ").length, 8);
  T("calendar tile", [g.querySelector(".mini-cal-day").offsetWidth,
                      +g.querySelector(".mini-cal-day").offsetHeight.toFixed(2)], [93.32, 51.25], 0.05);
  const bars = q(".day-bars");
  T("day bars n", bars.children.length, 30);   // padded journals only; fewer is fine
  T("day bar width", +bars.children[0].getBoundingClientRect().width.toFixed(2), 6.25, 0.05);

  // ── the rail actually holds the Release Edge ─────────────────────────────
  const panel = document.getElementById("dashEdgeMiniPanel");
  const tv = document.getElementById("dashEdgeMiniTv");
  const mon = tv.querySelector(".bb-mon");
  const news = document.getElementById("dashEdgeMiniNews");
  T("rail panel ZERO hidden", panel.scrollHeight - panel.clientHeight, 0);
  T("docked picture", [mon.offsetWidth, +mon.offsetHeight.toFixed(2)], [432, 243]);
  T("picture does NOT paint over the feed",
    Math.max(0, +(mon.getBoundingClientRect().bottom - news.getBoundingClientRect().top).toFixed(2)), 0);

  // ── TV POPOUT: the iframe is never re-created and never closed ───────────
  const ifr = tv.querySelector("iframe");
  const capIfr = ifr, capParent = ifr && ifr.parentElement, capMon = mon;
  if (ifr) ifr.setAttribute("data-verify", "1");
  const noneAncestors = el => { const o = []; let n = el;
    while (n && n.tagName !== "HTML") { if (getComputedStyle(n).display === "none") o.push(n.id || n.tagName); n = n.parentElement; }
    return o; };
  document.getElementById("dashEdgeMiniOut").click();
  T("popped position", getComputedStyle(tv).position === "fixed" ? 1 : 0, 1);
  T("popped frame", [tv.offsetWidth, +tv.offsetHeight.toFixed(2)], [919.54, 517.23], 0.6);
  T("popped z-index", +getComputedStyle(tv).zIndex, 5);
  T("cap RELEASED when popped", getComputedStyle(mon).maxWidth === "none" ? 1 : 0, 1);
  T("same .bb-mon node", tv.querySelector(".bb-mon") === capMon ? 1 : 0, 1);
  if (ifr) {
    T("same iframe node",   tv.querySelector("iframe") === capIfr ? 1 : 0, 1);
    T("same iframe parent", ifr.parentElement === capParent ? 1 : 0, 1);
    T("iframe probe intact", ifr.getAttribute("data-verify") === "1" ? 1 : 0, 1);
    T("ZERO display:none ancestors", noneAncestors(ifr).length, 0);
  }
  T("board still no-scroll while popped", [d.scrollWidth, d.scrollHeight], [1943, 1093]);
  document.getElementById("dashEdgeMiniOut").click();
  T("re-docked", [tv.offsetWidth, +tv.offsetHeight.toFixed(2)], [627, 254]);
  T("same node after re-dock", tv.querySelector(".bb-mon") === capMon ? 1 : 0, 1);
  T("board no-scroll after re-dock", [d.scrollWidth, d.scrollHeight], [1943, 1093]);
  if (ifr) ifr.removeAttribute("data-verify");

  console.log(`%c${bad.length ? "FAIL " + bad.length : "PASS"} — ${ok.length} ok`,
              `color:${bad.length ? "#f66" : "#6c6"};font-weight:700`);
  bad.forEach(b => console.warn(b));
  ok.forEach(o => console.log(o));
  return { pass: bad.length === 0, failures: bad };
})()
```

Known and **not** a failure: `.dash-head` reports `scrollHeight 48` against `clientHeight 36`. It is `overflow: visible` and pre-existing — I toggled the delta off and measured 48/36 on the shipped four-band grid too, and 46/32 both ways at 1440. It does not enter `#dashboard`'s scroll box. Separate fix; the 30px `.btn`/`.nav-btn` box at `clay-v3.css:3900-3901` plus its line box is what exceeds 36.

---

## 10. What the wider rail cost — for the owner

The rail takes 320.50px. Measured on the same DOM, the spec's own §5.4 allocation versus this one:

| panel | reference (spec §5.4) | with the 2x rail | cost |
|---|---|---|---|
| **Release Edge rail** | 308.50 x 860.99, picture 284.5 x 160.03, **136px of the panel behind a scroller** | **629.00 x 860.99**, picture **432 x 243**, **0 hidden** | **+320.50 · 2.0389x width · 2.31x picture area · scroller gone** |
| Edge score | 468.75, radar radius 110 | 468.75, radar radius 110 | **nothing** |
| Cumulative curve | 629, canvas 595 x 322 | 468.75, canvas 435 x 322 | −160.25 |
| Net daily P&L | 468.75, bars 11.59px | 308.50, bars **6.25px** | −160.25 |
| Calendar | 949.50, tiles 113.60 x 51.25 | 789.25, tiles **93.32 x 51.25** | −160.25 |
| Recent trades | 629, table 595 | 468.75, table 434.75 | −160.25 |
| Head / strip / run-facts | 1911 each | **1911 each** | **nothing** |

Five things the owner should be told plainly:

1. **The calendar is 17% narrower than the reference gives it.** 949.50 → 789.25, tiles 113.60 → 93.32 wide. Height is untouched, so a tile is still 1.82x wider than tall and the 8th weekly-total column still fits at 83.98. But the calendar is the panel they named first, and it paid.

2. **Net daily P&L is the panel that really pays.** 468.75 → 308.50, and its 30 bars go 11.59px → 6.25px at 1999 and 6.93px → **3.14px at 1440x900**, where the bar is exactly as wide as the 3px gutter between bars. It reads as a comb, not a distribution. There is no code floor here — `grid-auto-columns: minmax(0, 1fr)` at `clay-v3.css:3315` never clamps — which is precisely why this panel absorbs the cut instead of the radar, which has a hard one.

3. **The curve keeps its axis but loses its margin.** Canvas 595 → 435 against the `compact = width < 430` threshold at `charts.js:635`. Five pixels. Solved exactly: the y-axis gutter collapses 56 → 44 and the headline 17 → 15 at any window **below 1979px**. The owner's 1999 clears it by 20px of window. Under the reference's 4-column curve that cliff sat at ~1504px. Anyone on a 1920 monitor gets the compact axis and will not be told why.

4. **Two columns of the board now belong to a panel TradeZella does not have.** Every reference panel is present, in the reference's row order, none below 2 columns, none below its content floor, and bands A, B and C are full-bleed exactly as the reference draws them. But the reference's analytics region is 12 columns wide and this one is 8. That is the honest price of "just add my release edge", and no allocation avoids it — the only question was which panels absorb it.

5. **On a 1440x900 laptop the rail still scrolls internally: 234px.** Doubling the width cannot fix that, because `aspect-ratio: 16 / 9` (`styles.css:9668`) turns every extra pixel of width into 0.5625 of height. Measured across the whole cap range at 1440: a 194px picture leaves 184px hidden, 284 leaves 234, 418 leaves 310. A 637px rail cannot hold a picture, a wire and a news feed on a 900px screen at any width. The zero-scroll Release Edge is a **1999x1150 promise**. The one rule that would close it is dropping `.dem-screen` (the wire block, 256.28px) below 960px of height — a content decision, not a layout one, and not one I would make on the owner's behalf.