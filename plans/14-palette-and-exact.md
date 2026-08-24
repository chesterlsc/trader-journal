Every claim verified. Writing the spec.

# BUILD SPEC — Trader Journal renovation/v2

All line numbers are against **HEAD `8595ddc`** with a clean tree. Each step shifts the lines below it, so **edit by selector / anchor text, not by line number.** Every number below was read out of the working tree or measured in a browser at 1999×1150; nothing is quoted from the mapping without re-checking.

**Verified baseline:** `clayV3Contrast` 147 green · `charts.smoke` OK · 46/46 suite green (3 of them need `node_modules`, which the scratch copy lacked — they pass in the repo).

**Four mapping/design claims are wrong and are corrected in place below.** Do not act on the originals:

| Claim | Reality |
|---|---|
| Band A headline is 28px, bump to 44px | `clay-v3.css:632` is inside `@media (min-width: 1025px)` (opens at `:516`) and already sets **44px**. `:3092`'s 28px is a base a breakpoint overrides. **Bumping it is a regression.** |
| RISK STATE renders `.is-idle` faint | `app.js:10407` passes tone `1` — it paints **green** today. |
| Parser desync proved by "3 of 6 :root in styles.css" | I ran the real `tokenBlocks`: styles.css **3 of 3**, no desync. clay-v3.css **1 of 2** is real. |
| `const short = normalizeDirection(...)` fixes `"Sold"` | `normalizeDirection("Sold") === ""`. It fixes `"Short"`, `"S"`, `" Sell "`, `"sell short"` — not `"Sold"`. |

---

## STEP 1 — REVIEW QUEUE

Owner named it. Independently shippable, no palette dependency.

### 1a. REASON is clipped to 66px — this is "every REASON reads 'Trend'"

**Measured in a browser at 1999×1150** against the real three-sheet cascade, panel 744px:

```
column widths:  Date 242 | Sym 66 | Side 68 | P&L 95 | Reason 66 | Source 132
"Trend Continuation"  needs 119px  in a 66px cell   -> CLIPPED
"Model signal bounce" needs 126px                    -> CLIPPED
"Breakout retest"     needs  99px                    -> CLIPPED
7 of 8 real setup names clip.
```

Cause: `clay-v3.css:4377-4383` pins `max-width: 0`. Commit `8595ddc` widened DATE to 242px (year + clock), which starved REASON further. **Deleting `max-width: 0` alone is not enough** — the auto algorithm then hands REASON 329px and takes DATE down to 137px, and the columns move as data changes, which the render's static table does not do.

**Rewrite `clay-v3.css:4377-4383` in place, and add the fixed layout on `.dash-ledger`:**

```css
/* THE TABLE IS FIXED, NOT AUTO. `max-width: 0` is the standard shrink-to-
   ellipsis trick for an AUTO table, but it starves the column to its share:
   measured at 1999x1150 it gave REASON 66px while "Model signal bounce" needs
   126px, which is the owner's "every REASON reads Trend". Deleting it alone
   swings the other way — REASON took 329px and DATE dropped to 137px, and the
   columns then move every time the data does. Percentages hold both still. */
.dash-ledger { table-layout: fixed; width: 100%; }
.dash-ledger th:nth-child(1), .dash-ledger td:nth-child(1) { width: 21%; }  /* date + clock */
.dash-ledger th:nth-child(2), .dash-ledger td:nth-child(2) { width: 11%; }  /* symbol */
.dash-ledger th:nth-child(3), .dash-ledger td:nth-child(3) { width:  9%; }  /* side */
.dash-ledger th:nth-child(4), .dash-ledger td:nth-child(4) { width: 16%; }  /* net p&l */
.dash-ledger th:nth-child(5), .dash-ledger td:nth-child(5) { width: 26%; }  /* reason */
.dash-ledger th:nth-child(6), .dash-ledger td:nth-child(6) { width: 17%; }  /* source */

.dash-ledger .lq-reason {
  /* max-width: 0 DELETED. nowrap + ellipsis stay: under `fixed` they now only
     catch a runaway free-text Custom setup, which is what they are for. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-soft);
}
```

**Measured after the change**, same page, panel 744px:

```
Date 141 | Sym 74 | Side 60 | P&L 107 | Reason 174 | Source 114     table 670px
all 7 real setup names fit (widest 126px in 174px)   -> 0 clipped
"A very long custom setup name typed by hand" 285px  -> ellipsised, correct
document.body.scrollWidth 1999  -> NO horizontal scroll
```

Holds at every panel width down to 640px with zero clipping. At 375px the six-column table ellipsises rather than scrolling — correct degradation.

### 1b. SIDE bypasses the app's one direction predicate

`app.js:12553` hand-rolls `String(trade.direction || "").toLowerCase() === "sell"`. Measured against `normalizeDirection` (`src/lib/core.js:156`):

| stored value | `normalizeDirection` | shipped literal | renderer today |
|---|---|---|---|
| `"Sell"` / `"SELL"` | `Sell` | `true` | correct |
| `"Short"` | `Sell` | **`false`** | **"Long", white — wrong side** |
| `"S"` | `Sell` | **`false`** | **wrong side** |
| `" Sell "` | `Sell` | **`false`** | **wrong side** |
| `"sell short"` | `Sell` | **`false`** | **wrong side** |
| `"Sold"` | `""` | `false` | "Long" — *neither* predicate reads it |

`normalizeTrades` (`app.js:14126`) canonicalises on load, but four writers push straight into `state.trades` without it — `app.js:3625`, `:4635`, `:5687`, `:2493` — so a raw side reaches the DOM in-session. This is a **correctness bug** (wrong side shown); the missing colour is its visible half.

`normalizeDirection` is already imported at `app.js:18`.

```js
// app.js:12553 — replace
            // ONE reading of a side for the whole app. A literal === "sell" is
            // strictly weaker than normalizeDirection, which also reads
            // "Short", "S" and untrimmed values — and every one of those this
            // renderer paints as an uncoloured "Long", i.e. the WRONG SIDE.
            const short = normalizeDirection(trade.direction) === "Sell";
```

**Same defect, same fix, `src/modules/recentTradesView.js:178`** — add `normalizeDirection` to the existing `core.js` import on line 1:

```js
    const isSell = normalizeDirection(trade.direction) === "Sell";
```

### 1c. `formatQueueDate` parses a date-only string as UTC

```
TZ=America/New_York  new Date("2026-08-21")  ->  "Aug 20, 2026"      WRONG
TZ=Asia/Manila       new Date("2026-08-21")  ->  "Aug 21, 2026"      latent here
```

Introduced by `8595ddc`. `parseTradeEntryDate` (`src/modules/tradeDisplay.js:85`) builds the date at **local noon** precisely to dodge this, and is already destructured into app.js at `:813` — no new import.

```js
// app.js:12508 — replace the body
function formatQueueDate(trade) {
  // parseTradeEntryDate builds a date-only string at LOCAL NOON on purpose:
  // `new Date("2026-08-21")` is UTC midnight, and formatting THAT with a local
  // Intl formatter prints "Aug 20" anywhere west of Greenwich — i.e. for every
  // US trader, which is who Topstep/CPI/"09:30 LOCAL" is for. Reaching past the
  // shared helper is how this comes back.
  const d =
    parseTradeEntryDate(trade.date) ||
    new Date(trade.closedAt || trade.createdAt || trade.updatedAt || NaN);
  return Number.isNaN(d.getTime())
    ? formatCompactTradeDate(trade)
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}
```

Keep the year here, not in the shared `formatCompactTradeDate` — that helper is month/day by design and also feeds the landing tape and the unjournalled card, which sit beside today's date.

### 1d. A zero P&L renders green

`app.js:12575` — `netPnl < 0 ? "is-neg" : "is-pos"` has no third branch, so `$0.00` paints mint. Band A already prints TODAY `$0.00` neutral.

```js
              `<td class="${trade.netPnl < 0 ? "is-neg" : trade.netPnl > 0 ? "is-pos" : ""}">${escapeHtml(
```

### 1e. `formatQueueTime` runs twice per row, and the date cell has no text separator

`app.js:12571-12572`. `textContent` currently reads `"Aug 21, 202619:00"` — the `<i>` is spaced by `margin-left: 6px`, which a screen reader cannot hear.

```js
            const at = formatQueueTime(trade);   // hoist, once per row
            // ...
              `<tr><td>${escapeHtml(formatQueueDate(trade))}` +
              `${at ? ` <i class="lq-at">${escapeHtml(at)}</i>` : ""}</td>` +
```

### 1f. Foot collapses to the render's "7 ITEMS" when nothing is trimmed

`app.js:12603-12605`. The badge and foot **do not contradict** — badge = `getUnjournalledTrades().length`, the same backlog the nav and dock badges use (`app.js:11007`); the foot counts rows shown. Moving the badge write would desync three places. The foot just never collapses.

```js
    const of = isQueue ? queue.length : rows.length;
    setText(count, host.rows.length === of ? `${of} items` : `${host.rows.length} of ${of} shown`);
```

### 1g. Chip CSS: merge the two `.lq-src` blocks, drop the undeclared token

`clay-v3.css:4389-4400` declares `border: 1px solid currentColor; opacity: .85`; `:4402-4404` immediately undoes both. And `:4411` reads `var(--text-muted, ...)` — **`--text-muted` is declared in no file** (grepped all three sheets), so the fallback does all the work and the harness cannot see it. The brief's `chipEstimated` is `#8695a8` on a 12% tint — that is `--text-soft`.

```css
/* Replace clay-v3.css:4389-4404 with ONE block, one intention. */
.dash-ledger .lq-src {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  font: 600 11px/1.4 var(--font-mono);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
/* clay-v3.css:4410-4413 */
.dash-ledger .lq-src.is-estimated {
  color: var(--text-soft);                                        /* 5.31:1 */
  background: color-mix(in srgb, var(--text-soft) 12%, transparent);
}
```

**SOURCE mapping is correct — do not flip it.** `isTopstepOrdersImport` (`app.js:3727`) tests `importSource === "topstepx-orders"`, set only on the Orders path (`app.js:4458`), which stamps `pnlIsEstimated: true` and estimates fees from a published schedule. Orders → **Estimated**, topstepx → **Broker verified**, none → **Manual**. Every chip reading ESTIMATED in the owner's journal is the honest answer for a book built entirely from an Orders CSV.

**Rows that look alike are real data, not a renderer bug.** For an Orders import the importer hard-codes `setupType/session/timeframe` to `"Not recorded"` (`app.js:4481`, `:4390`), the reconstruction supports only MGC/GC (`app.js:4421`), and `notes: ""` (`app.js:4495`) puts every row in the queue. The clock beside the date (shipped in `8595ddc`) is what separates intraday fills. **Do not add a renderer-side dedup** — it would delete real trades. Fixing 1a makes this *more* visible: rows that read `Trend Continua…` become rows that read `Trend Continuation`. That is honest.

---

## STEP 2 — THE PALETTE, ONE TOKEN BLOCK

**Simulated end to end**, full repo copy at `/tmp/pal4`: **152/152 contrast pairings green in both themes** (147 + 5 that measure a token which until now did not exist), full suite green.

> ### DO NOT REPLACE THE DARK BLOCK WHOLESALE
> `clay-v3.css:37-155` declares 83 tokens. Seven are **not** in the audit's replacement: `--clay-raised` (`:106`), `--clay-float` (`:111`), `--clay-soft` (`:116`), `--clay-accent` (`:117`), `--clay-pressed` (`:122`), `--shadow` (`:130`), `--shadow-modal` (`:131`). `--clay-accent` is item 19 of `ACCENT_TOKENS` (`tests/clayV3Contrast.check.mjs:394-414`) and `:415-421` asserts it is present in that exact block — the suite fails with *"accent-derived token --clay-accent not overridden"*. The other six fall through to `clay-v2.css`'s warm `hsl(30 40% 3%)` era, putting a warm shadow under a blue-black ground.
>
> **Apply as targeted value edits in place.** The list below is exhaustive and line-anchored.

### 2a. Dark block — value edits inside `:root:not([data-theme="light"])` (`clay-v3.css:37`)

```css
:38   --surface-0: #080b12;        /* page — blue-black ground */
:39   --surface-1: #0c1119;        /* cards, panels */
:40   --surface-2: #111823;        /* nav, modal, raised */
:41   --surface-3: #16202d;        /* hover/active — LIGHTEST, binds every text ratio */
:42   --surface-inset: #05080e;    /* wells, inputs, table heads — below the ground */
:44   --line: #151d28;             /* brief divider: the 108-consumer inner hairline */
:51   --line-strong: #1b2532;      /* brief panelBorder */
:52   --line-accent: rgba(249, 115, 22, 0.45);
      /* INSERT after :50 — --info was never overridden here and fell through to
         the violet-era styles.css:62. Deliberately the same hue as --term-live
         so the product has ONE cyan, not two. */
+     --info: #22d3ee;
+     --info-soft: rgba(34, 211, 238, 0.12);
:54   --text: #e6ecf5;
:55   --text-soft: #8695a8;        /* brief textMuted */
:56   --text-faint: #7c8b9e;       /* NOT the brief's #5d6b7d — see 2c */
:57   --text-inverse: #080b12;
:59   --accent: #f97316;
:60   --accent-strong: #fb8b3a;
:61   --accent-muted: rgba(249, 115, 22, 0.14);
:63   --pnl-pos: #34d399;
:64   --pnl-pos-soft: rgba(52, 211, 153, 0.12);
:65   --pnl-pos-line: rgba(52, 211, 153, 0.38);
:66   --pnl-neg: #f87171;
:67   --pnl-neg-soft: rgba(248, 113, 113, 0.12);
:68   --pnl-neg-line: rgba(248, 113, 113, 0.38);
:70   --chart-grid: #131b26;
:71   --chart-axis: #8695a8;
:72   --chart-line-deep: #9a4409;
:73   --chart-glow: rgba(249, 115, 22, 0.5);
:74   --chart-halo: rgba(249, 115, 22, 0.24);
:75   --chart-halo-fade: rgba(249, 115, 22, 0);
:76   --chart-area-top: rgba(249, 115, 22, 0.35);      /* brief curveFill */
:77   --chart-area-mid: rgba(249, 115, 22, 0.11);
:78   --chart-area-bottom: rgba(249, 115, 22, 0);
:79   --chart-canvas-top: #0a0e16;     /* MUST stay below --surface-1 luminance */
:80   --chart-canvas-bottom: #070a11;  /* or the carved-well read inverts */
:81   --chart-canvas-glow: rgba(249, 115, 22, 0.06);
:83   --chart-pos-deep: #12795a;
:84   --chart-pos-glow: rgba(52, 211, 153, 0.5);
:85   --chart-neg-deep: #96343a;
:86   --chart-neg-glow: rgba(248, 113, 113, 0.5);
:87   --chart-halo-neg: rgba(248, 113, 113, 0.24);
:88   --chart-halo-neg-fade: rgba(248, 113, 113, 0);
:89   --chart-neg-area-top: rgba(248, 113, 113, 0.04);
:90   --chart-neg-area-bottom: rgba(248, 113, 113, 0.42);
:95   --chart-track: rgba(58, 68, 83, 0.12);   /* brief drawdownFill #3a4453 */
:96   --chart-crosshair: rgba(134, 149, 168, 0.55);
:97   --chart-tooltip-bg: rgba(12, 17, 25, 0.96);
:98   --chart-tooltip-line: #1b2532;
:100  --chart-ring-wash: rgba(134, 149, 168, 0.05);
:101  --spark-pos-fade: rgba(52, 211, 153, 0);
:102  --spark-neg-fade: rgba(248, 113, 113, 0);
:128  --control-edge: #6b7789;     /* blue-shifted; draws the render's bordered controls */
:139  --halo-accent: rgba(249, 115, 22, 0.35);
:140  --aurora-a: rgba(249, 115, 22, 0.12);
:141  --aurora-b: rgba(52, 211, 153, 0.07);
:142  --aurora-c: rgba(134, 149, 168, 0.08);
:143  --aurora-fade: rgba(249, 115, 22, 0);
:144  --landing-grid-line: rgba(249, 115, 22, 0.10);
:145  --floor-glow: rgba(249, 115, 22, 0.10);
:146  --nav-scrim: rgba(4, 6, 10, 0.60);
:148  --glass-top: #111823;        /* Band A is "one surface split by hairlines", */
:149  --glass-bottom: #0d131c;     /* so the deck gradient wants to be nearly FLAT: */
:150  --deck-top: #111823;         /* one step, not two. */
:151  --deck-bottom: #0d131c;
:153  --deck-wash: rgba(249, 115, 22, 0.04);
:154  --deck-groove: hsl(220 45% 1% / 0.70);
```

**Leave untouched:** `--warn` `:49` (10.15:1 on the new panel), `--warn-soft` `:50`, `--chart-canvas-shadow` `:82`, `--chart-highlight*` `:91-92`, `--chart-shade*` `:93-94`, `--chart-tooltip-shadow` `:99`, all five clay stacks `:106-127`, `--shadow`/`--shadow-modal` `:130-131`, `--edge-highlight` `:136`, `--focus-ring` `:137`, `--deck-edge` `:152`. Also fix the stale prose at `:12`, `:34`, `:38-42` that still says *"gunmetal"* — that sentence is what sends the next reader backwards.

### 2b. Terminal ramp — `clay-v3.css:483-500`

Skipping this block is the single easiest way to ship a half-converted site: the Market TV surround, the desk and the landing preview all read it, and `styles.css:10035` aliases every token as `--bb-*`. It deliberately does not follow `[data-theme="light"]` — keep that.

```css
:484  --term-void:  #080b12;
:485  --term-pane:  #0c1119;
:486  --term-rail:  #111823;
:487  --term-raise: #16202d;
:488  --term-well:  #05080e;
:489  --term-line:  #1b2532;
:490  --term-edge:  #6b7789;
:491  --term-ink:   #e6ecf5;
:492  --term-soft:  #8695a8;
:493  --term-faint: #7c8b9e;
:494  --term-acc:   #f97316;
:495  --term-wash:  rgba(249, 115, 22, 0.10);   /* 0.14 FAILS — see 2c */
:497  --term-pos:   #34d399;
:498  --term-neg:   #f87171;
+     /* THE MISSING TOKEN. Read at clay-v3.css:1020, :1021, :4505 and :4549 and
+        declared in NO file, so every cyan in the product has been shipping as
+        the hardcoded fallback #3fd0c9. LIVE / COUNTING ONLY. */
+     --term-live:  #22d3ee;
```

### 2c. THE TWO BRIEF VALUES THAT FAIL — both measured, both one-token fixes

**(1) `textFaint #5d6b7d` is below AA on every surface, including the darkest** — so no surface re-derivation rescues it:

```
--text-faint #5d6b7d on --surface-0      3.62:1   (floor 4.5)
                     on --surface-1      3.48:1
                     on --surface-2      3.28:1
                     on --surface-3      3.02:1
                     on --surface-inset  3.69:1
```

`#7c8b9e` is the nearest tone on the same hue/sat line that clears it everywhere: **5.66 / 5.45 / 5.13 / 4.73 / 5.77:1**. Do **not** smuggle `#5d6b7d` in as an element-scoped pin — the harness would not see it and it would ship 3.0:1 text. That is this repo's own recorded bug class.

**(2) `--term-wash` at the shipped 0.14 alpha fails once faint darkens:**

```
--term-faint on --term-wash over --term-rail   0.14 -> 4.27:1   FAIL
                                               0.10 -> 4.54:1   green
```

A 4%-opacity change to a tint. **This is the binding constraint of the whole palette**, and it is not `--surface-3` as expected.

### 2d. Every dark pairing the suite checks, measured

| pair | ratio | floor |
|---|---|---|
| `--text` on surfaces 0/1/2/3/inset | 16.57 / 15.93 / 15.00 / 13.83 / 16.88 | 4.5 |
| `--text-soft` on surfaces | 6.45 / 6.20 / 5.84 / 5.38 / 6.57 | 4.5 |
| `--text-faint` on surfaces | 5.66 / 5.45 / 5.13 / **4.73** / 5.77 | 4.5 |
| `--accent` on surfaces 0-3 | 7.02 / 6.75 / 6.36 / 5.86 | 4.5 |
| `--accent` on `--accent-muted` over `--surface-1` | **5.68** (was 4.63 — the shipped build's worst; improves) | 4.5 |
| `--accent-strong` on `--accent-muted` over `--surface-2` | 6.25 | 4.5 |
| `--text-inverse` on `--accent` | 7.02 | 4.5 |
| `--pnl-pos` on surfaces | 10.24 / 9.84 / 9.27 / 8.54 / 10.43 | 4.5 |
| `--pnl-neg` on surfaces | 7.12 / 6.84 / 6.44 / 5.94 / 7.25 | 4.5 |
| `--pnl-pos` on `--pnl-pos-soft`/surface-1 (BROKER VERIFIED chip) | 8.02 | 4.5 |
| `--pnl-neg` on `--pnl-neg-soft`/surface-1 | 5.90 | 4.5 |
| `--text-inverse` on `--pnl-pos` / `--pnl-neg` | 10.24 / 7.12 | 4.5 |
| `--warn` on `--surface-1` / its soft | 10.15 / 8.25 | 4.5 |
| `--info` on `--surface-1` / its soft | 10.47 / 8.46 | 4.5 |
| `--chart-axis` on canvas top / bottom | 6.33 / 6.49 | 4.5 |
| `--text` on `--chart-tooltip-bg` over surface-1 | 15.93 | 4.5 |
| `--pnl-pos` / `--pnl-neg` / `--text` on deck top‖bottom | 9.27‖9.69 / 6.44‖6.74 / 15.00‖15.69 | 3 |
| `--control-edge` on surface-0 / surface-1 | 4.33 / 4.17 | 3 |
| `--term-ink` on the 5 grounds | 16.57 → 13.83 | 4.5 |
| `--term-soft` on the 5 grounds | 6.45 → 5.38 | 4.5 |
| `--term-faint` on the 5 grounds | 5.66 → **4.73** | 4.5 |
| **`--term-live` on the 5 grounds** | 10.89 / 10.47 / 9.86 / 9.09 / 11.09 | 4.5 |
| `--term-faint` on `--term-wash` over `--term-rail` | **4.54 ← tightest in the build** | 4.5 |
| `--term-edge` on the 5 grounds | 3.62 → 4.42 | 3 |

Light block untouched; worst light pairing `--chart-axis` on `--chart-canvas-bottom` = 4.66:1, unchanged.

### 2e. Leaks — hexes that would strand half the old palette

Every line below opened and confirmed.

```css
/* clay-v3.css:1020, :1021, :4505, :4549 — the four cyans. The token now
   exists; drop the fallback, or the next person "fixes" a colour by editing a
   fallback four times.                                                       */
    var(--term-live, #3fd0c9)   ->   var(--term-live)

/* clay-v3.css:1022 and :4506 — stale-feed dots, a literal amber beside two
   token-driven siblings.                                                     */
    background: #d9a441;        ->   background: var(--warn);

/* clay-v3.css:4436 — the score rail. Both ENDS follow tokens, the midpoint
   does not; after a re-hue it is the only warm-amber pixel on the board.     */
    linear-gradient(90deg, var(--pnl-neg) 0%, #d9a441 50%, var(--pnl-pos) 100%)
 -> linear-gradient(90deg, var(--pnl-neg) 0%, var(--warn) 50%, var(--pnl-pos) 100%)

/* clay-v3.css:4360 — the round orange badge the brief names by name. The FILL
   follows --accent, the ink on it does not.                       7.02:1     */
    color: #14161a;             ->   color: var(--text-inverse);

/* clay-v3.css:3300, :3353 — THE HOLE NO CONTRAST HARNESS CAN SEE. Element
   opacity multiplies the token AFTER the cascade, so the harness measures
   5.45:1 and the screen shows 1.60:1. Already broken today at 1.83:1; the
   shift deepens it. Full strength is also what the render actually shows.    */
#dashboard .mini-cal-day.is-outside { color: var(--text-faint); }  /* was opacity: 0.32 -> 1.60:1 */
#dashboard .mini-cal-day.is-future  { color: var(--text-faint); }  /* was opacity: 0.45 -> 2.04:1 */

/* styles.css                                                                  */
/* :47    --pnl-pos: #2fd18c   -> #34d399   (dead — v3 overrides — but it is the
          value app.js's fallback had drifted to. Retire it or it happens again) */
/* :1611  rgba(240, 118, 61, 0.05)  -> rgb(249 115 22 / 0.05)                   */
/* :9811  rgb(240 118 61 / 0.05)    -> rgb(249 115 22 / 0.05)  <- SPACE SYNTAX,
          a comma-only grep MISSES this one                                    */
/* :10086 rgba(240, 118, 61, 0.05)  -> rgb(249 115 22 / 0.05)                   */
/* :6449, :6459, :6470, :6480  rgb(216 130 60 / ...) -> rgb(249 115 22 / ...)
          monitor-scene washes: a THIRD oxide matching neither palette          */
/* :6738  color: #2f9bf5  -> var(--pnl-pos)   .lnd-row-mark.is-broker, a blue
          belonging to no palette. If it means "broker verified", the brief
          already assigns that a colour: the chip is mint.                     */
/* :11651 var(--term-warn, #d98a5a) -> var(--term-warn)   dead fallback         */
/* :1554  rgba(240, 179, 78, 0.16)  -> LEAVE. That is --warn, unchanged.        */

/* clay-v2.css:83, :86 — light base, overridden by v3, worth aligning so a lost
   v3 token cannot fall back into last season's hue:
     --pnl-pos: #146b49 -> #11694c ;  --pnl-neg: #b32b4f -> #a71b1b
   DO NOT touch clay-v2's warm hsl casts at :306-321, :1774-1785, :2930-2939,
   :3172-3176 — they are LIGHT-only and v3 re-derives the dark ones cold at
   :296-360. Listed to prevent a wasted edit.                                  */
```

**`app.js:9856` — the only colour literal left in JS.** The comment two lines above it reads *"Every colour is a token."* It is not, and it has drifted twice.

```js
// BEFORE:  const stroke = token(rising ? "--pnl-pos" : "--pnl-neg", "#2fd18c");
// AFTER — do NOT write "#34d399" here. That is the new --pnl-pos, and step 2g
// adds it to the guard that scans this file: the two changes would cancel and
// fail the suite on the same commit. A neutral in NO palette cannot go stale:
const stroke = token(rising ? "--pnl-pos" : "--pnl-neg", "#8a8a8a");
```

### 2f. HTML — the boot veil and the chrome tint

```html
<!-- index.html:18 — the title-bar tint in the Trader Desk shell and mobile Safari -->
<meta name="theme-color" content="#080b12" media="(prefers-color-scheme: dark)" />
<!-- :19 light stays #e6e8ea -->

<!-- index.html:121-131 — THE MOST VISIBLE LEAK. This <style> is inline in <head>
     ON PURPOSE, painting before styles.css, so it can never follow a token.
     Miss it and every cold load flashes gunmetal for one paint. -->
:121   background: #080b12;     /* was #14161a */
:122   --tjv-ink: #e6ecf5;      /* was #e9edf1 */
:123   --tjv-plate: #e6ecf5;    /* was #e9edf1 */
:124   --tjv-type: #080b12;     /* was #14161a */
:125   --tjv-accent: #f97316;   /* was #f0763d */
:129   --tjv-ink: #191c1f;      /* was #14161a — now light's own --text, so no
:131   --tjv-type: #191c1f;        old-palette hex survives anywhere in shipped code */
```

### 2g. Three test changes — **required**, not optional

**(a) `tests/bootVeil.check.mjs:115-118` FAILS on any ground change.** It hardcodes `background: #14161a`. Re-pinning the literal works once and rots; derive it, so the inline veil (which can never follow a token) is enforced *against* one.

```js
const v3 = read("clay-v3.css");
const groundOf = (sel) => {
  const at = v3.indexOf(sel);
  assert.ok(at > 0, `clay-v3.css: missing ${sel}`);
  const m = /--surface-0:\s*(#[0-9a-f]{6})/i.exec(v3.slice(at, at + 4000));
  assert.ok(m, `clay-v3.css: no --surface-0 in ${sel}`);
  return m[1];
};
const darkGround = groundOf(':root:not([data-theme="light"]) {');
const lightGround = groundOf('[data-theme="light"] {');
assert.ok(
  styleBlock.includes(`background: ${darkGround}`),
  `dark ground missing — the veil must paint --surface-0 (${darkGround})`
);
assert.ok(
  new RegExp(`\\[data-theme="light"\\] #tjv \\{[^}]*background: ${lightGround}`).test(styleBlock),
  "light ground missing — a hardcoded dark veil is the same flash, inverted"
);
```

**Teeth verified:** reverting the veil to `#14161a` re-fails with `dark ground missing — the veil must paint --surface-0 (#080b12)`.

**(b) `tests/clayV3Contrast.check.mjs:402` — measure the new token,** or it goes missing again and no test notices (it already did, once):

```js
for (const fg of ["--term-acc", "--term-warn", "--term-pos", "--term-neg", "--term-live"]) {
  for (const bg of TERM_GROUNDS) check("dark", fg, bg, 4.5);
}
```

**(c) `tests/clayV3Contrast.check.mjs:24` — the parser desync.** `tokenBlocks` counts braces without skipping comments, and the doc comment at `clay-v3.css:645-651` contains an example `@media (max-width: 720px) { ... }`.

**Measured with the real function:** clay-v3.css **1 of 2** top-level `:root` blocks — the one at `:669` is invisible. styles.css **3 of 3**, clay-v2.css **2 of 2** — *no desync there.* (The "3 of 6" claim is false; the other three are inside `@media`, which the harness skips deliberately and says so at `:21-23`. Citing it invites someone to "fix" the parser into measuring `@media` blocks.)

Nothing is wrong today (`--rail-w` is a length), but the bottom of the file is exactly where someone adds a token block, and anything declared there ships **unmeasured**.

```js
function tokenBlocks(source, selector) {
  // Blank comments (offsets preserved) so a brace inside a COMMENT cannot
  // desync the depth counter and hide every top-level block after it.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const blocks = [];
  /* ...unchanged... */
}
```

Verified after the fix: 2 of 2 in clay-v3.css, still 3 in styles.css. Do **both**: fix the parser *and* keep every colour token in the two blocks at `:37` and `:162`.

**(d) `tests/clayV3Contrast.check.mjs:374` — extend the JS hex guard** to the current accent and the money family, which it never policed (which is why `app.js:9856` drifted twice):

```js
const OXIDE =
  /#(c2410c|f0763d|f68d5c|a83508|8a2b06|8f3c14|6e2205|f97316|fb8b3a|9a4409|3ecf8e|f7758d|2fd18c|34d399|f87171|146b49|b32b4f)/i;
```

Scanned all five guarded files against this: after step 2e, **zero hits**.

---

## STEP 3 — THE SYMMETRIC DEPTH AXIS

All inside `drawLineChart` in `src/modules/charts.js`. Nothing outside the function reads `depthFloor`.

> ### THE HOIST POINT IN THE DESIGN IS A TDZ CRASH
> The design puts `const hasDepth` after `let rows = maxRows;` (`:699`). `series` is declared at **`:706`**. I applied it exactly as written and it threw on the first paint:
> ```
> ReferenceError: Cannot access 'series' before initialization
>     at drawLineChart (charts.js:704:88)
> ```
> This is the repo's recorded `app.js` TDZ trap in a second file. **Anchor it after the `series.length < 2` early return instead** (after `:711`), which is still above the money-row search.

### 3a. Hoist `hasDepth` — insert immediately after `charts.js:711` (`geometry.delete(canvas); return; }`)

```js
    /* Hoisted here — BELOW `series` (it reads series.length; putting it above
       is a TDZ throw) and ABOVE the money-row search, which owns `rows`. A
       SYMMETRIC depth axis needs a MIDDLE rule to put 0% on, so the shared row
       count must be even, and the search cannot know that unless it is told
       before it runs.
       `!bare` is not redundant with maxRows: a 90px sparkline still gets
       maxRows 2, which alone would let a grey wash and an off-bitmap percent
       column onto a box with 8px of right gutter. */
    const hasDepth =
      !bare && maxRows > 0 && Array.isArray(options.depth) && options.depth.length === series.length;
```

### 3b. Even-only row filter — `charts.js:738`, first line inside the loop

**Proven necessary.** With `rows = 5` the axis prints `6.25% / 3.75% / 1.25% / -1.25% / -3.75% / -6.25%` — **no 0% row at all**, and the zero line floats between rules.

```js
      for (let n = maxRows; n >= Math.min(3, maxRows); n -= 1) {
        // An odd row count has no middle rule, so 0% would print nowhere.
        if (hasDepth && n % 2) continue;
```

### 3c. Parity guard — immediately after the `if (best) { ... }` block (`charts.js:753-757`)

```js
      // FAILURE PATH THE FILTER EXISTS TO PREVENT: if the even filter leaves
      // only n=4 and niceStep returns null for it, `best` stays null and rows
      // falls back to maxRows = 5 — odd, the exact case above.
      if (hasDepth && rows % 2) rows -= 1;
```

### 3d. `depthFloor` → a positive half-range — replace `charts.js:782-793`

```js
    const depth = hasDepth ? options.depth : null;
    let depthHalf = 0;
    if (depth) {
      const half = rows / 2;
      const deepest = -Math.min(...depth, 0);
      // No drawdown in the window: the series lies flat on the middle rule, so
      // the axis only needs round labels to sit against. 1% a row.
      const dstep = deepest > 0 ? niceStep(deepest, half, (s) => s * half >= deepest) : 1;
      depthHalf = (dstep || 1) * half;
    }
```

### 3e. Three one-line consequences

```js
// charts.js:796 — maps +half -> top, 0 -> middle, -half -> bottom
    const yForDepth = (value) => top + ((depthHalf - value) / (2 * depthHalf)) * plotH;

// charts.js:813 — t=0 -> +half, t=0.5 -> 0, t=1 -> -half.
// drawPlotFrame (charts.js:1183) needs NO change: it already walks the same
// i/rows fraction for both label columns, which is what keeps them on one set
// of rules. padRight (48/40px) still clears "-10%".
      valueAtRight: depth ? (t) => depthHalf * (1 - 2 * t) : null,

// charts.js:844, :846 — the polygon closes across the BOTTOM, not the top.
// Z-order is already right: depth paints at :837, before the equity area at :858.
      ctx.moveTo(depthPoints[0].x, bottom);
      ctx.lineTo(depthPoints[depthPoints.length - 1].x, bottom);
```

**Keep the `Math.min(value, 0)` clamp at `charts.js:840.** `depthPercent` only ever emits ≤ 0, and the clamp is now the only reason the top half stays empty. If a caller ever hands up positive depth, dropping the clamp is the whole change — the axis already covers it.

### 3f. Rewrite the block comment at `charts.js:775-777` — it is now false

It currently reads *"ZERO SITS ON THE TOP RULE … a symmetric axis would label rows the data cannot reach."* That sentence is precisely the note that would send the next reader back to the old form.

```
       ZERO SITS ON THE MIDDLE RULE and the area fills DOWN from the series to
       the plot floor. The axis is symmetric (+half at the top rule, -half at
       the bottom), which is why the row count above must be EVEN. Depth is
       never positive today, so the top half stays empty — that is the
       Math.min(value, 0) clamp below, and it is the only thing holding it.
```

Also `:772`: `depthFloor` → `depthHalf`.

**Fixes a real bug in passing.** On a fresh journal (all-zero drawdown) the old form gave `yForDepth(0) === top`, so the polygon was `top → top → top` and painted **nothing**. Symmetric, `depthHalf` is always ≥ 1, so the area runs from the middle rule to the plot floor.

### 3g. `tests/charts.smoke.mjs` — the check this owes

The harness already drives both depth fixtures (`full` at `:120-122`, all-zero at `:178-180`) and asserts nothing about them. The `fillText` stub already receives `text` and throws it away.

The strategy chart also prints percents, so a flat label list cannot tell a depth tick from a bar label. Bucket by canvas, per paint — `clearRect` is called exactly once per paint (`charts.js:1853`), so it is the frame boundary:

```js
// :7 — labels drawn, PER CANVAS, PER PAINT.
const axisText = {};
const lastAxis = (id) =>
  (axisText[id]?.at(-1) ?? []).filter((t) => /^-?\d[\d.]*%$/.test(t));

// :8   function makeCtx()  ->  function makeCtx(id)
// :65  getContext: () => makeCtx()  ->  getContext: () => makeCtx(id)

// :24 clearRect
    clearRect: (...args) => {
      noop("clearRect")(...args);
      (axisText[id] ||= []).push([]);
    },
// :41 fillText, after calls.push("fillText")
      const frames = axisText[id];
      if (frames && frames.length) frames[frames.length - 1].push(String(text));

// before the settled `renderCharts(full)`:
delete axisText.equityChart;
renderCharts(full);
{
  // The draw-in tween repaints five times; the LAST frame is the settled axis.
  const pct = lastAxis("equityChart");
  assert.ok(pct.length >= 5, `the depth axis must label every row (got ${pct.length})`);
  assert.ok(pct.length % 2 === 1, "an even row count means an ODD number of labels");
  assert.strictEqual(pct[(pct.length - 1) / 2], "0%", "zero must sit on the MIDDLE rule");
  assert.strictEqual(pct[0], pct[pct.length - 1].replace("-", ""),
    "the depth axis must be symmetric top to bottom");
}

// and the same `delete` + this, around the all-zero fixture:
{
  const pct = lastAxis("equityChart");
  assert.ok(pct.length >= 5, "flat depth must still label every row");
  assert.strictEqual(pct[(pct.length - 1) / 2], "0%", "flat depth still centres zero");
  assert.ok(new Set(pct).size > 1, "flat depth must not collapse every label to 0%");
}
```

**Teeth verified, both regressions:**

| reverted | failure |
|---|---|
| `yForDepth` back to top-anchored | `AssertionError: zero must sit on the MIDDLE rule` |
| even-parity filter + guard removed | `AssertionError: an even row count means an ODD number of labels` |

Settled output on the `full` fixture: `5% / 2.5% / 0% / -2.5% / -5%` — five labels, four intervals, zero centred.

### 3h. Palette knock-on

`--chart-track` is what paints the depth area (`charts.js:850`, `colors.track`). Under the old top-anchored form it was a thin band and its weight never mattered; symmetric, it covers the **lower half of the plot** and is painted **after** `drawPlotFrame` (`:802` then `:837`), so it sits over the lower gridlines and the strong baseline rule. At `0.12` they read through; above ~`0.25` the lower grid disappears. **The alpha is the calibration knob, not the hex** — check it on the real canvas, not in the token file.

---

## STEP 4 — REGION MATCHES

### 4a. Top bar

**The LIVE badge is wired to nothing.** `appLive` appears at `index.html:3543` and in **zero** lines of app.js. `setTickerStale` (`app.js:14931-14935`) toggles `.is-stale` on `[data-ticker-strip]` — `#appTicker`, a *sibling* of the badge. The `data-feed` CSS branches already exist at `clay-v3.css:1020-1022`.

```js
// app.js:14931 — replace the body
function setTickerStale(stale) {
  document.querySelectorAll("[data-ticker-strip]").forEach((strip) => {
    strip.classList.toggle("is-stale", Boolean(stale));
  });
  // The badge in the top bar states feed health and, until now, always said
  // "Live" — including while the tape was frozen.
  const live = document.getElementById("appLive");
  if (live) {
    live.dataset.feed = stale ? "stale" : "live";
    live.textContent = stale ? "Stale" : "Live";
  }
}
```

**Ticker change is blank on first paint.** `app.js:14968` gates the triangle+value block on `Number.isFinite(previous) && price !== previous`. On the first poll `tickerShown[symbol]` is `undefined`, so every `[data-ticker-delta]` span stays empty — and stays empty for any symbol that did not move between two polls. Markup (`index.html:3406`) and the U+25B2/25BC glyphs already exist; only the gate is wrong. Hold the last non-zero delta per symbol, or seed against a session-open reference.

### 4b. Band A

```css
/* clay-v3.css:4058 — one flat surface split by hairlines. NOT A DELTA: the
   vertical rules already ship. But the FIRST cell must lose its left rule, or
   the band reads as a strip of separate tiles rather than one surface. */
#dashboard.is-active .dash-now > *:first-child { border-left: 0; }

/* Restyle the EXISTING 1M/3M/ALL group as the render's pill select rather than
   adding selects with nothing behind them. All three ranges have real state:
   state.dashboard.balanceRange (app.js:291) -> BALANCE_RANGE_DAYS
   (app.js:10211) -> handler at app.js:1787. */
.dash-range {
  border: 1px solid var(--control-edge);
  border-radius: 999px;
  background: var(--surface-inset);
}
```

```html
<!-- index.html:1515 — the sixth NOW cell. One word. -->
<div><span class="dash-now-label">Risk state</span>   <!-- was: From highs -->
     <span class="dash-now-fig" id="dashNowHighs">AT HIGHS</span></div>
```

```js
// app.js:10407 — AT HIGHS paints GREEN today (tone 1), not faint-idle.
// The render wants RED. See RISKS: this is a judgement call, not a bug fix.
  setFig(document.getElementById("dashNowHighs"), dd === 0 ? "AT HIGHS" : nowMoney(-dd), -1, false);
```

**Do not touch:** the headline font size (already 44px at 1999×1150), and `accountBalance` in `toneValues` (`app.js:9752`) — it carries `.pnl-positive` but computes `--text-faint`, and it also feeds the metric-card hairline at `app.js:9768`.

**LOG A TRADE carries a plus glyph** (`index.html:1550`, `M12 5.75v12.5M5.75 12h12.5`); QUICK IMPORT at `:1558` already carries the download path the brief describes. A download glyph on the primary log action is semantically wrong — nothing is downloaded — and is almost certainly a plus misread in the render. **Confirm before changing; my recommendation is leave it.**

### 4c. Calendar — the ruled grid

**Measured live at 1999×1150** with the panel at 392px: 42 cells (6 × 7), cell height 48.5px, grid 298px, `scrollHeight` 296 — **zero overflow, zero page scroll.**

The 1px gap **is** the shared hairline — no `border-collapse` math, no doubled edges. Each cell keeps its own `border: 1px solid transparent`, so the state borders still draw a complete inset box.

```css
/* clay-v3.css:3211-3216 */
#dashboard .mini-cal-weekdays,
#dashboard .mini-cal-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 1px;
}
#dashboard .mini-cal-grid {
  background: var(--line);
  border: 1px solid var(--line);
}
/* clay-v3.css:3242-3260 — square cells on their own fill, so an untraded day is
   a CELL, not a bare numeral floating in a gap. NOTE the comment at :3238-3241
   records that the fully-boxed grid was DELIBERATELY reversed; this undoes it
   to match the render. */
#dashboard .mini-cal-day { border-radius: 0; background: var(--surface-1); }

/* DELETE the two overrides that fight it:
     clay-v3.css:3458   gap: 3px            (breakpoint)
     clay-v3.css:3476   border-radius: 8px                                     */

/* clay-v3.css:3320-3331 — bordered nav buttons, grouped right.
   THE #dashboard PREFIX IS MANDATORY. Measured: an unscoped `.mini-cal-step`
   (0,1,0) loses to the incumbent `#dashboard .mini-cal-step` (1,1,0) and is
   INERT — computed borderTopWidth "0px", style "none", radius "5px". Scoped,
   it computes "1px solid rgb(107,118,132)" and radius 6px.                    */
#dashboard .mini-cal-step { border: 1px solid var(--control-edge); border-radius: 6px; }
#dashboard .mini-cal-nav  { display: flex; gap: 4px; margin-left: auto; }

/* Title above, month as a muted sub-label. NOTE this reverses a decision the
   comment at clay-v3.css:3200-3203 argues for explicitly ("the month IS the
   panel title") — worth one line to the owner. */
#dashboard .mini-cal-title { font: 600 13px/1.2 var(--font-ui); color: var(--text); margin: 0; }
```

**Verified surviving the change, no `!important` needed** — `#dashboard .mini-cal-day.is-trade.pnl-positive` (1 id, 3 classes) outranks `#dashboard .mini-cal-day` (1 id, 1 class):

```
.is-today            borderTopColor  rgb(240, 118, 61)   ✓ orange outline intact
.is-trade.pnl-positive  border + tint intact             ✓
.is-trade.pnl-negative  border intact                    ✓
.is-outside          opacity 1, on --surface-1           ✓ (per step 2e)
```

```html
<!-- index.html:1572-1582. Keep the #miniCalPrev / #miniCalNext ids —
     app.js:2013-2018 and :12345-12348 resolve both by id. -->
<div class="mini-cal-titlerow">
  <div>
    <h3 class="mini-cal-title">Evidence calendar</h3>
    <span class="mini-cal-month" id="miniCalMonth">MONTH</span>
  </div>
  <div class="mini-cal-nav">
    <button type="button" class="mini-cal-step" id="miniCalPrev" aria-label="Previous month">&lsaquo;</button>
    <button type="button" class="mini-cal-step" id="miniCalNext" aria-label="Next month">&rsaquo;</button>
  </div>
</div>
<!-- #miniCalNet keeps its place. -->
```

**NOT A DELTA:** adjacent-month days at **both** ends already ship — `renderDashMiniCal` pads leading at `app.js:12374-12377` and trailing at `:12400-12404`. I counted 42 day nodes in the grid. Only the *ruling* was missing.

### 4d. Market TV

> ### A STRAY BUTTON SHIPS TODAY THAT NEITHER DESIGN ACCOUNTS FOR
> `index.html:1469` carries `hidden`, but `styles.css:9904` declares `.dem-key { display: block; }` — an **author** rule, which beats the UA `[hidden] { display: none }` at any specificity. There is no `.dem-key[hidden]` rule and no global author `[hidden]` reset in any of the three sheets.
>
> **Measured:** `hasAttribute('hidden') === true`, `getComputedStyle().display === "block"`, `getBoundingClientRect().height === 44`, text `"F1 full calendar"`. A 44px bar reading **F1 FULL CALENDAR** is on screen at the foot of the Market TV panel right now.
>
> This repo documents the identical trap three times (`styles.css:2757`, `:8220-8223`, `clay-v3.css:3731-3734`, `:3814-3816`) and missed this one. **Drop the inert `hidden` attribute and retitle it as the render's VIEW CALENDAR link** — `data-target="terminal"` navigation already works, and it must stay in `index.html` where `init` wired it: `ui.navButtons` is a one-time `querySelectorAll(".nav-btn")` snapshot (`app.js:324`, listeners at `:1579`), so a `.nav-btn` emitted later by a render function gets **no handler**.

```css
/* The three blocks. Measured today: .dem-cat has border-top only
   (clay-v3.css:4513-4516), .dem-news border-bottom only (styles.css:9686-9689),
   .dem-screen no border at all (styles.css:9802) — three strips sharing single
   dividers. The two strips use DIFFERENT hairline tokens for the same visual
   line (--line vs --term-line); unify to --term-line, since this panel lives in
   the terminal ramp. */
.dem-cat, .dem-news, .dem-screen {
  margin: 8px 11px;
  padding: 10px 12px;
  border: 1px solid var(--term-line);
  border-radius: var(--radius-lg);
}
/* and DELETE `border-top: 1px solid var(--line)` from .dem-cat (clay-v3.css:4515)
   and `border-bottom: 1px solid var(--term-line)` from .dem-news (styles.css:9688). */

/* styles.css:9643-9653 — the channel header is position:absolute over the
   picture at opacity .5. The render puts it in a row ABOVE the video. Safe: the
   header lives inside monitorTile's own markup (app.js:16734) and this touches
   neither #dashEdgeMiniTv nor the iframe. Also drops the literal
   rgb(6 8 11 / 0.72). */
.dem-tv .bb-mon-h {
  position: static;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: none;
  opacity: 1;
}

/* The LIVE pill, replacing .bb-mon-dot (styles.css:11438) — which is RED,
   animated, and pulses even in standby, asserting liveness nothing verified. */
.dem-live {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 7px; border-radius: 999px;
  background: color-mix(in srgb, var(--term-live) 12%, transparent);
  color: var(--term-live);
  font: 600 10px/1.4 var(--font-mono);
  letter-spacing: 0.08em; text-transform: uppercase;
}
.dem-live::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--term-live); }

/* The econ-calendar star. event.impact is REAL data — ranked through
   IMPACT_RANK (app.js:37), filtering the wire at minImpact:"Medium", and
   already driving `.dem-s.is-hot` at app.js:17375. Pure class swap. */
.dem-row.is-hot { background: color-mix(in srgb, var(--term-acc) 6%, transparent); }
.dem-star { color: var(--term-acc); font-size: 10px; margin-right: 4px; }
```

**Retitle the header in `app.js:17357`, not `index.html`.** `class="dem-h"` appears **nowhere** in index.html — `index.html:1466` is `<span class="dem-sweep">`, `:1467` is `<div id="dashEdgeMiniBody">`. The header is a template literal at `app.js:17357`, re-emitted into `#dashEdgeMiniBody` by `setHtml` at `app.js:17408` on every render. Anything typed into index.html there is destroyed on first paint.

**`.dem-screen` is not the economic calendar.** Measured: `#dashEdgeMiniBody` holds **two** `.dem-h` sections — `F1 wire` (`app.js:17357`) and `F2 your file` (`:17387` / `:17404`), joined into one string. `styles.css:9825` `.dem-h + .dem-h { margin-top: 12px }` exists precisely because there are two. Bordering `.dem-screen` frames the calendar **and** the trader's-file record in one box. Either wrap each `.dem-h` section in its own `<section class="dem-block">` inside the generated string, or border `.dem-screen` and accept two sections in one frame — **but say which**.

**MARKET CONTEXT is half-buildable.** `newsHeadlines` (`app.js:16467-16478`) emits `<span class="bb-news-src">domain</span>title` and **drops `h.at`**, which the data shape carries (`app.js:2556`). `.bb-news-at` is already styled at `clay-v3.css:4564` and `:4087` and emitted by no JS in the repo — an orphaned class waiting for exactly this. Adding one span gets time / headline / source. Caveat: the sample producer sets `at: ""` (`app.js:2556`), so on guest/demo the time column is blank; only the live path fills it, from GDELT `seendate` (`api/_lib/newsvol.js:213`).

### 4e. Equity legend — label over value, two columns

```html
<!-- index.html:1825-1827. The <b> ids do NOT move, so renderEquityLegend
     (app.js:12485-12500) is untouched. -->
<p class="eq-legend">
  <span class="eq-legend-item is-equity"><i>Equity</i><b id="equityLegendValue">$0.00</b></span>
  <span class="eq-legend-item is-depth"><i>Drawdown</i><b id="equityLegendDepth">$0.00 (0.00%)</b></span>
</p>
```

```css
/* clay-v3.css:4455-4468 */
.eq-legend { display: flex; align-items: flex-start; gap: 28px; margin: 0 0 6px; }
.eq-legend-item {
  display: inline-grid;
  grid-template-columns: 7px auto;
  column-gap: 7px;
  row-gap: 2px;
  align-items: center;
  min-width: 0;
}
.eq-legend-item::before { grid-row: 1 / span 2; }
.eq-legend-item i {
  font-style: normal;
  /* TEST TRAP: tests/mobileFloors.check.mjs parses clay-v3.css and floors type
     at 11px with NO mobile branch. Separate the label from the value by CASE,
     TRACKING and COLOUR — never by dropping to 10px. */
  font: 500 11px/1.3 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-soft);
}
.eq-legend-item b { font-size: 15px; }
```

The Drawdown **dot** is already correct — `clay-v3.css:4478` draws it with `var(--chart-axis, var(--text-faint))`, which is `#8695a8` in the new palette (6.20:1). Do **not** point it at the fill colour: `#3a4453` on the panel is 1.92:1, an invisible bullet.

### 4f. Chart panel header

`index.html:1779-1781` is `<div class="panel-head"><h3>Equity / Drawdown</h3></div>` — no select, no buttons. There is no panel-level icon-button pattern anywhere in the app to copy.

```html
<div class="panel-head panel-head-inline">
  <h3>Equity / Drawdown</h3>
  <div class="panel-tools">
    <!-- FREE: analytics.equity and analytics.drawdowns are both already
         computed, drawLineChart already has its `underwater` branch
         (charts.js:589-604), and the drawdown canvas this duplicates is already
         display:none in the grid (index.html:1866). No new data. -->
    <select class="pill-select" id="equitySeriesSelect" aria-label="Chart series">
      <option value="equity" selected>Equity</option>
      <option value="drawdown">Drawdown</option>
    </select>
    <!-- NATIVE: article.requestFullscreen(). The resize listener at app.js:2041
         already calls renderCharts, so it redraws correctly. -->
    <button class="panel-icon-btn" type="button" id="equityExpandBtn" aria-label="Expand chart">…</button>
    <!-- NATIVE: canvas.toDataURL('image/png') on a download link. No dependency. -->
    <button class="panel-icon-btn" type="button" id="equityExportBtn" aria-label="Export chart as PNG">…</button>
  </div>
</div>
```

Three controls, not four. The fourth is in NOT BUILT.

---

## VERIFY

Run in a **foregrounded** browser tab at 1999×1150, after a clean reload. (A backgrounded tab lies: my first read of the ledger showed 24 rows and a 125px overflow; a clean load showed 18 and zero. `app.js:2158-2161` already forces a chart repaint on view activation for exactly this reason.)

```js
// ─── PAGE ─────────────────────────────────────────────────────────────────
console.assert(document.body.scrollWidth <= 1999, "NO horizontal scroll at 1999");
console.assert(document.documentElement.scrollHeight <= 1150, "NO-SCROLL at 1999x1150");
console.assert(!document.querySelector('#dashboard .panel:has(*)')
  || [...document.querySelectorAll('#dashboard .panel')]
       .every(p => p.scrollHeight <= p.clientHeight + 1), "no panel overflows");

// ─── STEP 1: REVIEW QUEUE ─────────────────────────────────────────────────
const rq = document.querySelector('.dash-ledger');
console.assert(getComputedStyle(rq).tableLayout === 'fixed', "1a: table must be fixed");
console.assert([...document.querySelectorAll('.lq-reason')]
  .filter(r => !/^A very long/.test(r.textContent))
  .every(r => r.scrollWidth <= r.clientWidth), "1a: no real setup name may clip");
console.assert(getComputedStyle(document.querySelector('.lq-reason')).maxWidth !== '0px',
  "1a: max-width:0 must be gone");
// 1b — seed one and read it back
console.assert(normalizeDirection === undefined || true, "1b: run tests/journalQueue instead");
// 1c — a date-only trade must print its OWN day, in any TZ
console.assert(!/Aug 20/.test(
  document.querySelector('.dash-ledger tbody td')?.textContent || ''), "1c: UTC off-by-one");
// 1d — a zero row is neither colour
console.assert([...document.querySelectorAll('.dash-ledger td')]
  .filter(td => td.textContent.trim() === '$0.00')
  .every(td => !td.classList.contains('is-pos') && !td.classList.contains('is-neg')),
  "1d: zero P&L must be neutral");
// 1f — foot and rows agree when nothing was trimmed
{
  const rows = document.querySelectorAll('#dashLedgerBody tr').length;
  const foot = document.getElementById('dashQueueCount').textContent;
  console.assert(/^\d+ (items|of \d+ shown)$/.test(foot), "1f: foot wording");
  if (/items/.test(foot)) console.assert(parseInt(foot) === rows, "1f: foot must equal rows");
}

// ─── STEP 2: PALETTE ──────────────────────────────────────────────────────
const cs = getComputedStyle(document.documentElement);
const T = n => cs.getPropertyValue(n).trim();
console.assert(T('--surface-0') === '#080b12', "2a: ground");
console.assert(T('--text-faint') === '#7c8b9e', "2c: NOT the brief's #5d6b7d");
console.assert(T('--term-live')  === '#22d3ee', "2b: the token must EXIST");
console.assert(T('--term-wash').includes('0.1'), "2c: wash alpha 0.10, not 0.14");
for (const t of ['--clay-accent','--clay-raised','--clay-float','--clay-soft',
                 '--clay-pressed','--shadow','--shadow-modal'])
  console.assert(T(t).length > 0, `2a: ${t} must survive the edit`);
// the cyan is now the token, not the fallback
console.assert(getComputedStyle(document.getElementById('appLive')).color
  === 'rgb(34, 211, 238)', "2e: LIVE dot must be #22d3ee, not the #3fd0c9 fallback");
// element-scoped opacity must not multiply a token
console.assert(getComputedStyle(document.querySelector('.mini-cal-day.is-outside')).opacity === '1',
  "2e: the opacity hole — the harness CANNOT see this one");

// ─── PALETTE LEAK SWEEP (shell, not DOM) ──────────────────────────────────
// Must print NOTHING outside tests/ and comments:
//   grep -nE '#(14161a|f0763d|f68d5c|3ecf8e|f7758d|2fd18c|3fd0c9|d9a441|2f9bf5|8f3c14)' \
//        app.js index.html styles.css clay-v2.css clay-v3.css src/modules/*.js
//   grep -nE 'rgba?\(\s*240[,\s]+118[,\s]+61|rgb\(216 130 60|var\(--term-live,|var\(--text-muted' \
//        styles.css clay-v2.css clay-v3.css

// ─── STEP 3: CHART AXIS ───────────────────────────────────────────────────
// tests/charts.smoke.mjs owns this. In the DOM, eyeball only:
//   the right gutter reads  N% / N/2% / 0% / -N/2% / -N%
//   the grey mass sits in the LOWER half and its top edge undulates on 0%

// ─── STEP 4: REGIONS ──────────────────────────────────────────────────────
console.assert(document.getElementById('appLive').dataset.feed, "4a: badge must carry data-feed");
console.assert([...document.querySelectorAll('[data-ticker-delta]')]
  .some(n => n.textContent.trim()), "4a: ticker delta must not be blank on first paint");
console.assert(document.querySelector('.dash-now > *').offsetLeft >= 0 &&
  getComputedStyle(document.querySelector('.dash-now > *:first-child')).borderLeftWidth === '0px',
  "4b: first NOW cell has no left rule");
console.assert(/risk state/i.test(document.querySelectorAll('.dash-now-label')[5].textContent),
  "4b: label is RISK STATE");
console.assert(getComputedStyle(document.getElementById('dashNowHighs')).color
  === 'rgb(248, 113, 113)', "4b: AT HIGHS is red");
{ // 4c — the grid is ruled and today survives
  const g = document.getElementById('miniCalGrid');
  console.assert(getComputedStyle(g).gap === '1px', "4c: 1px gap IS the hairline");
  console.assert(g.children.length === 42 || g.children.length === 35, "4c: full weeks");
  const t = g.querySelector('.is-today');
  if (t) console.assert(getComputedStyle(t).borderTopColor === 'rgb(249, 115, 22)',
    "4c: today keeps its orange border through the ruling");
  const step = document.getElementById('miniCalPrev');
  console.assert(getComputedStyle(step).borderTopWidth === '1px',
    "4c: SCOPE IT #dashboard — an unscoped .mini-cal-step is INERT");
}
{ // 4d — three bordered blocks, and the stray button is dealt with
  ['dem-cat','dem-news','dem-screen'].forEach(c =>
    console.assert(getComputedStyle(document.querySelector('.'+c)).borderTopWidth === '1px',
      `4d: .${c} must be its own bordered block`));
  const k = document.querySelector('.dem-key');
  console.assert(!k || !k.hasAttribute('hidden'),
    "4d: `hidden` is INERT here (styles.css:9904 display:block) — remove it, do not rely on it");
  // The iframe never moves and no ancestor is ever display:none'd:
  const tv = document.getElementById('dashEdgeMiniTv');
  console.assert(!tv || tv.querySelector('iframe') === null ||
    tv.closest('[style*="display: none"]') === null, "4d: Market TV iframe must be untouched");
}
console.assert(getComputedStyle(document.querySelector('.eq-legend-item')).display === 'inline-grid',
  "4e: legend is label-over-value");
console.assert(parseFloat(getComputedStyle(document.querySelector('.eq-legend-item i')).fontSize) >= 11,
  "4e: mobileFloors floors this at 11px");
```

**Shell gate — every step:**

```
node tests/clayV3Contrast.check.mjs   # expect: 152 pairings green,
                                      #   worst dark --term-faint on --term-wash over --term-rail = 4.54:1
node tests/charts.smoke.mjs           # expect: OK
node tests/bootVeil.check.mjs         # expect: OK (and it now DERIVES the ground)
node tests/mobileFloors.check.mjs
node tests/cssSanity.check.mjs
for f in tests/*.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done   # expect: silence
```

---

## NOT BUILT

Nothing below has honest data behind it. Do not ship it as if it does.

**`[USD v]` currency select — DEAD CONTROL.** All three money formatters hardcode `currency: "USD"` (`src/lib/format.js:1-29`). The only currency field in the product is a free-text `<input maxlength="4">` in Settings, read into `account.currency` (`app.js:482`, `:11589`, `:12122`, `:12238`) and consumed by **no formatter anywhere**. A select that changes nothing is worse than no select. Ship a static USD chip with no dropdown affordance, or make `format.js` read the account currency first — a real change across every money surface, not a control.

**Two of the render's four Band A pill selects.** Only a timeframe control maps to real state. Currency is dead (above). The other two are unnamed in the render and have no candidate field. Restyle the existing 1M/3M/ALL group and add nothing else.

**Channel logo inside the `[CNBC v]` select — not possible as specified.** `WALL_CHANNELS` entries are `{ id, name, desk, hours }` (`app.js:1187-1204`) — 16 of them, no image field — and no channel asset is referenced anywhere in the repo. An `<option>` cannot render an image in any browser. Options: (a) a `background-image` on the **closed** select showing only the active channel's mark, or (b) a custom listbox — new keyboard handling on the **same control the four-monitor wall uses** (`app.js:16615` is shared), plus 16 logo files to source and license. **Recommend (a) or skip.**

**`SOURCE: BLS` in the NEXT CATALYST footer — no backing data.** `app.js:17316` is the only read of `.source` on an event in the whole file. `buildSampleReleases` (`app.js:2545-2548`) emits `{key, title, currency, impact, startsAt}` with no source, and the live path assigns `terminal.events = body.events` wholesale from the PHP handler (`app.js:15751`). On guest, preview and demo the right half of that footer never prints. Ship it date-only until the handler emits it.

**The exact `8% / 4% / 0% / -4% / -8%` ticks.** A 4% half-step is not on the shared `1/2/2.5/5/10` ladder. Worked and verified: deepest −6.2%, rows 4, half 2 → `s*2 >= 6.2` first matches 5, so the axis prints `10 / 5 / 0 / -5 / -10`. The render's **left** axis has the same problem: `$52.5K / $51K / $49.5K / $48K / $46.5K` is a $1.5K step, also off the ladder. **Do not add 4 or 1.5 to `niceStep`** — its own comment (`charts.js:520-523`) says a second copy is how two scales drift, and a new rung changes every currency axis in the app to chase two numbers read off a JPEG. The symmetric **structure** matches exactly. Flag the tick values to the owner as the one place the render cannot be copied.

**The third chart-header icon button.** There is no panel pin, no panel settings, no per-panel state anywhere in the app to hang one on. Adding one is a new subsystem, not an icon. Ship three, or ship the third disabled and say so.

**A hard LIVE pill asserting the stream is live right now.** `index.html:897` already records the caveat: there is no free way to confirm a YouTube channel is broadcasting. The pill can honestly say *"this is a live channel"* from the roster. Still a strict improvement on the shipped red animated `.bb-mon-dot`, which pulses in standby.

**MARKET CONTEXT replacing NEWS EDGE — half.** The headline rows are close (one `<span class="bb-news-at">`, class already styled). But the block currently renders the F6 news verdict: per-asset symbol, an `x2.30` ratio, a band chip, a `newsVerdict()` sentence, a STAND DOWN / YOUR WINDOW stance (`app.js:17321-17348`). None of it has a counterpart in the render. **Dropping it is a product decision, not a restyle — confirm before deleting a feature.**

**Setup names for imported rows.** `inferTradeContext` (`app.js:5651`) does `setupType: last?.setupType || "Breakout"` — quick capture never asks for a setup and copies the previous trade's, so one setup propagates through every later capture. Deliberate, with a comment on it: **flag it, do not silently change capture behaviour.** And do not invent setup names to fill REASON for an Orders import — the importer hard-codes `"Not recorded"` (`app.js:4481`) because it genuinely does not know, and the renderer is already right to degrade that to an em dash.

**The light theme.** The owner sent a **dark** render only. Light passes the harness untouched and doing nothing is a defensible round one. If it gets a pass later, change only the hue families (`--accent #a83508 → ~#9c4507`, money `#146b49/#b32b4f → ~#11694c/#a71b1b`). **Do not re-derive the light surfaces blue** — a blue-cast light ground is invention with no reference. Re-derive light casts at `clay-v3.css:277-345`, never in `clay-v2.css`. All 20 `ACCENT_TOKENS` must stay present in the light block.

---

## RISKS

**The tightest margin in the whole palette is 0.04.** `--term-faint` on `--term-wash` over `--term-rail` = **4.54:1** against a 4.5 floor. Three independent future edits break it: raising the wash alpha back toward 0.14, lightening `--term-rail`, or darkening `--text-faint` toward the render. The harness catches all three — but whoever trips it will be tempted to fix the *check* rather than the value.

**`--line-strong` darkens a lot** — `#3d4552 → #1b2532`, roughly halving its lightness, across ~60 `border: 1px solid` rules on controls and cards. Deliberate (the render has no mid-grey hairline), but the single most likely "this looks broken" reaction, and **the harness does not measure decorative hairlines at all**. Look at `.bb-desk` and the `styles.css:10030` region at 1999×1150 before committing.

**`--warn` now sits 12° from `--accent`.** Amber `#f0b34e` is hue 37; the new orange is hue 25 (the old was 19, an 18° gap). They separate on lightness and chroma, not hue. The stale-feed dot and the score-rail midpoint are the two places a viewer must tell them apart at a glance, and both are small marks. If they read as one colour, move `--warn` yellower (toward hue 45) — **not** the accent, which is the render's value.

**The opacity hole is wider than the two lines named.** `clay-v3.css:3300` and `:3353` are the two I measured (1.60:1 and 2.04:1 after the shift). There are at least three more multipliers in the file — `:2185` at 0.48, `:3138` at 0.45, `:3334` at 0.25. Any sitting on `--text-faint` has the same defect, and **no token-reading harness can ever see it**. The audit is `grep -n 'opacity:' ` on any rule that also sets `color: var(--text-`. I only ran it on the calendar.

**The parser fix changes what is measured, not just how.** After stripping comments it sees 2 `:root` blocks in clay-v3.css instead of 1. It stays green because the newly-visible block holds only `--rail-w`, a length. If a hidden block had held a failing colour, this would surface as a *new* failure — correct, but it would look like the palette caused it.

**Two tests now pin the palette, and one is new.** `bootVeil` fails on any `--surface-0` change (by design), and the extended `OXIDE` guard fails on any palette hex reaching JS. Both are the point, but a partial palette edit now breaks the suite in a place that does not obviously say "colour". The failure message names the token and the expected value, which is why it derives rather than re-pins.

**`table-layout: fixed` is a real constraint, not just a fix.** Percentages hold the columns still, which is what the render shows — but a column can no longer grow for its content. Below ~640px panel width the cells begin to ellipsise (measured: all six clip at 375px). That is correct degradation for a six-column table on a phone, but it is a behaviour change, not only a width change.

**Changing RISK STATE to red is a judgement call.** `app.js:10407` passes tone `1`, so AT HIGHS paints **green** today. Being at equity highs is genuinely good news; the render paints it red. The rename to RISK STATE is what makes red coherent — a warning about sizing after a run-up. If the owner wants the label but not the colour, keep tone 1 — but then the render is not matched. **Ask.**

**Two calendar changes reverse recorded decisions.** `clay-v3.css:3200-3203` argues in prose that the month **is** the panel title; `:3238-3241` records that the fully-boxed grid was **deliberately** reversed to floating tiles. Both are being undone to match the render. Neither is wrong today — they were made against a different reference. Worth one line to the owner so this does not get reverted by whoever wrote those comments.

**Fixing REASON makes the repetition more visible, not less.** Rows that all read `Trend Continua…` become rows that all read `Trend Continuation`. That is the owner's data — four of six columns are constant by construction for a Topstep Orders import — and it is honest. The import dedup is sound: `isLikelyDuplicateTrade` (`app.js:5208`), `topstepOrdersDuplicateKey`, and the open-position supersede filter (`app.js:4619-4633`) all work.

**The landing page is not in the render and will look half-converted** until the ten `styles.css` leaks in 2e land. Lowest priority of the set, and the most obvious to anyone who scrolls.

---

## BUILD ORDER

| # | Step | Independently shippable | Gate |
|---|---|---|---|
| 1 | Review Queue (1a–1g) | yes — no palette dependency | `journalQueue` · `reviewFilters` · `reviewMobile` · `landingTape` |
| 2 | Palette, one token block (2a–2g) | yes — value edits + 4 test changes, atomic | `clayV3Contrast` **152** · `bootVeil` · full suite |
| 3 | Symmetric depth axis (3a–3h) | yes — local to `drawLineChart` | `charts.smoke` with the new assertions |
| 4 | Regions (4a–4f) | yes, and each sub-region alone | VERIFY block + full suite |

Steps 2 and 3 both touch `--chart-track`. Land 2 first; 3h is the calibration pass on the alpha, done on the real canvas.