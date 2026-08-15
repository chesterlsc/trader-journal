# Plan 01 — The new landing hero ("THE AIM") and the release edge video wall

Branch `renovation/v2`. Vanilla HTML/CSS, no build step. Every phase is self-contained and ends with a check that proves it landed.

**Design provenance.** Four Phase 0 discovery agents, three designers on different lenses, three judges on different axes. THE AIM won 3–0 (43 / 40 / 41). Full specs are cached at
`/private/tmp/claude-501/-Users-macbookairm3-Documents-Trader-Journal/e645e9dd-10d5-4b0d-8a52-6f538fa1bdad/scratchpad/` as `AIM-hero.html`, `AIM-hero.css`, `AIM-wall.html`, `AIM-wall.css`, plus `designs.json`, `judges.json`, `discovery.json`. Read the cache, do not re-derive.

**User decisions, closed.** The four news panels are designed mock screens, not YouTube embeds. The capture lens retires entirely, but the typing motion survives into the new hero.

---

## Phase 0 — Discovery findings (done; this is the consolidated output)

### Allowed APIs and patterns, with sources

| Fact | Source |
|---|---|
| Terminal ramp `--term-*` lives at `:root` in clay-v3.css so it survives both themes | clay-v3.css:1-499; measured by tests/clayV3Contrast.check.mjs:385-418 |
| `.lnd-tp-frame` is the one scope allowed to hard-reference dark surfaces, via the `--tp-*` pin | styles.css:1345-2278 |
| Real F7 wall to copy: `.bb-wall`, `.bb-mon`, `.bb-mon-h`, `.bb-mon-dot`, `.bb-mon-screen`, `.bb-mon-scan` | styles.css:10598-10727 |
| `.dem-tv` is the precedent for reusing `.bb-mon` rather than cloning it | styles.css:9055 (comment states this explicitly) |
| Global reduced-motion kill zeroes duration, delay and iteration-count with `!important` | styles.css:448-470 |
| Staggered entrance idiom: `--tok-i`, `--f-i`, `--d`, `--line-i`, `--i` | styles.css:8414-8440, 1979-2013 |
| Row classes the hero reuses: `.lnd-tp-row.is-you`, `.lnd-tp-s.is-you`, `.lnd-tp-x.is-pos` | styles.css:1706, 1727, 1753 |
| `.lnd-tp-h` is already `nowrap` + ellipsis, so a typed headline cannot wrap | styles.css (verified by judge:build) |

### Do NOT rename — ids and hooks JS reads

`#heroEmailForm`, `#recentTradesList`, `#lndTapeNote`, `#lndTapeCount`, `#heroLoginBtn`, `[data-start-demo]`, `[data-ticker-strip]`, `[data-landing-reveal]`, `#terminalPro`. `renderHeroRecentTrades` writes into `#recentTradesList`.

### Anti-patterns (things that do NOT exist, or must not be done)

- Do **not** invent a second monitor implementation. `.bb-mon` exists; wear it.
- Do **not** write single-class overrides of `.bb-*`. The real wall's rules are at styles.css:10601-10727, below any sane paste point, so a single-class override loses on source order and fails **silently**. Always compound: `.lnd-mon .bb-mon-h`.
- Do **not** add `animation-delay` to an infinite animation without accounting for the loop seam (project has been bitten before).
- Do **not** declare new module-level `const`/`let` in app.js below `init()` (~line 1138). tests/bootOrder.check.mjs fails at boot; this trap has shipped four times.
- `copyDashes.check.mjs` has an entity blind spot; it does not match `&minus;` (U+2212). Hand-grep new copy.

---

## Phase 1 — Scope the nine bare selectors (PREREQUISITE, ships alone)

**Why first.** styles.css:1979-2013, inside `@media (prefers-reduced-motion: no-preference)` (opens at :1954), carries nine **unscoped** selectors on a 26s infinite replay:

`.lnd-tp-row`, `.lnd-tp-stat`, `.lnd-tp-entry`, `.lnd-tp-saved`, `.lnd-tp-chip`, `.lnd-tp-verdict`, `.lnd-tp-row.is-flash::after`, `.lnd-tp-lockbar i`, `.lnd-tp-armed`, `.lnd-tp-tilt`

Their blank phase is hidden **only** by the `lndTpCut` curtain on `.lnd-tp-screen` (styles.css:1972). The new hero reuses these class names outside that curtain, so without this edit every reused row blinks out for ~470ms per cycle with nothing to hide it.

**Implement.** Prefix `.lnd-tp ` onto each of the nine. No other change.

**Verify.**
- `node tests/*.check.mjs` all green (36/36).
- The Release edge teaser renders byte-identical: screenshot before and after at 1280.
- `grep -n '^\s*\.lnd-tp-\(row\|stat\|entry\|saved\|chip\|verdict\|armed\|tilt\)' styles.css` returns nothing unscoped inside the motion block.

**Guard.** This must be its own commit. If it rides along with the hero paste, a teaser regression is indistinguishable from a hero bug.

---

## Phase 2 — Retire the capture lens, preserving four rules that are not lens

**Implement.** Delete `.lnd-lens-*` markup at index.html:234-287 and its CSS in styles.css:5981-6289.

**The trap.** That CSS range is **not** all lens. All three judges flagged that the winning spec's own deletion plan loses these. Reprint verbatim:

| Line | Rule | Why it matters |
|---|---|---|
| 6172 | `.lnd-lens-cap` | The new figcaption still wears this class |
| 6185 | `.lnd-hero-tape .lnd-tape-list` | 218px spool, `overflow-y:auto`, `overscroll-contain`, `scrollbar-width:thin`, **both** `mask-image` lines |
| 6244 | `.lnd-hero-lede { max-width: 54ch }` | at the 1080 breakpoint |
| 6278 | 176px phone cap | at 760 |
| 6285-6290 | `.lnd-hero` grid at `min-width:1600px` | `minmax(0,560px) minmax(0,880px)` |

Leave the `.lnd-tp-frame, .lnd-lens` alias at styles.css:1491 alone; the new figure joins it by wearing `.lnd-tp-frame`.

**Verify.** Hero tape still caps at 218px and still fades at top and bottom; lede still clamps at 54ch at 1080; hero still goes two-column at 1600. Check each at its own width.

---

## Phase 3 — The hero desk

**Signature moment, named: THE STAMP THAT HAD TO BE EARNED.** The reckoning pane counts out 14 prints and draws a 95% Wilson band from 8% to 48%. A white tick then drops at 51% — **outside** the band, to the right. That tick is the trader's own baseline, not 50%. `STAND DOWN` punches in over it at scale 1.45, 3° off, and settles. The whole argument is that one gap.

Drawn from `bbReckHtml` (app.js:14356-14369), which really does draw `--lo`/`--span`/`--base` with the trader's baseline as the tick and withholds the block entirely under 5 prints.

**The typing flow that survives.** Two typings, sequenced:
1. The command line types `> edge --link journal`.
2. The trader's own fill types into a `.lnd-tp-row.is-you` **between two calendar rows of the same row type**, using the shipped `.lnd-tp-s.is-you` / `.lnd-tp-x.is-pos`. Typing is a `::after` curtain painting `var(--tp-s0)` — which is correct because `.lnd-tp-pane` is also `--tp-s0` and `.lnd-tp-row.is-you` adds only an inset box-shadow.

**Release edge capabilities shown as panes with real figures** (all from discovery, all true of the code):
- The YOU column: `no file` at 0 samples, else `14` `3W/11L` with the REL glyph that exists only at 10+ prints.
- Wilson band `Rate range (95%)` → `8% to 48%`, tick at the trader's own baseline.
- The no-news rule priced: 5 skipped = **−$140.00**, 11 ticked = **+$1,400.00**.
- The approach rail weighted 34/20/20/26 with buckets `before · 0-15m · 15-60m · 60m+`.
- The stance gate that mostly refuses: `no call issued` is the honest common case.

**Verify.** 1440, 1280, 860, 375, both themes. The dark screen stays dark in light mode. Reduced motion lands on a fully composed desk (every entrance is finite with `backwards` fill).

---

## Phase 4 — The four news panels, built on `.bb-mon`

**Implement.** Delete the spec's `.lnd-vw*` tree (~16 classes, ~300 lines, and it re-types `.bb-mon-scan`'s gradient verbatim). Rebuild on the shipped wall:

```
.lnd-mon .bb-mon-screen { display: block; cursor: default; }
```
neutralises the shipped `cursor:pointer` and `place-items:center`. `.bb-mon-dot` brings its live pulse free (already killed by the reduce block at styles.css:10725). `.bb-mon-scan` already ships the scanline.

**Every override is a two-class compound** (`.lnd-mon .bb-mon-h`, never `.lnd-mon-h` alone) — the real rules sit at styles.css:10601-10727, far below the paste point.

Use one `<symbol>`/`<use>` defs block for the four pictures rather than eight inline gradient scenes.

**The fourth panel says nothing.** It reads `NO AIM / no read`, chyron: *the ratio comes from the wire, never from the picture*. The same refusal the hero is built on, and it inoculates the wall against reading as decoration.

**Verify.** All four panels render at 1280 and 375. Confirm the compound overrides actually win (computed style, not eyeball).

---

## Phase 5 — Mobile, in priority order

1. Drop `.lnd-desk-wall` from the hero below 700px. Biggest single win: removes 16 infinite animations, ~230px of scroll, and the two-nearly-identical-walls problem. Wrap in `@media (min-width: 701px)` rather than deleting markup.
2. At ≤700, hide the four non-live F keys so the rail is one row not three. Same idiom as the shipped `.lnd-tp-fkeys`.
3. `@media (max-width: 700px) { .lnd-vw-crawl { display: none } }` — the crawl is illegible at phone width and is 8 of the remaining infinite animations.
4. Swap the static clock for a clamped T-minus at `clamp(2rem, 4.4vw, 3.1rem)` so 375 gets one large legible element. Static text — **not** the rival's digit drums, whose minutes reel is arithmetically wrong once every ten minutes.

**Verify.** Measure `document.scrollWidth === 375`. Count simultaneous infinite animations. No text under 11px, no target under 44px.

---

## Phase 6 — Reconcile the two sample journals (correctness, not polish)

The concept judge caught this: the hero would print **14 prints and an earned STAND DOWN** while the teaser below honestly shows the demo journal at **0 / no file**. Both say "sample". Two different numbers for the same product on one page reads as fabrication.

**Decide one and apply it to both**, then state the source in the figcaption.

---

## Phase 7 — Final verification

- All 36 checks green.
- **Hand-grep** the new copy for `&mdash;`, `&ndash;`, `—`, `–`, and `&minus;` — `copyDashes` has an entity blind spot.
- Open 1440 / 1280 / 860 / 375 in **both** themes. The user screenshots in light mode and flags washout.
- Confirm `#heroEmailForm` submits and `#recentTradesList` still populates.
- `prefers-reduced-motion: reduce` shows a composed desk, not a blank one.
