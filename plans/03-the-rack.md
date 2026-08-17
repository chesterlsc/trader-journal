# Plan 03 — The Rack: left rail, customizable dashboard, the add control

STATUS: fully specified, NOT built. Swept all three judges.

A 56px left icon rail, the dashboard as a 12 column grid of cells whose order,
span and presence persist per journal, and a single plus that opens a
searchable drawer (also Shift+Cmd+K, the sibling of the shipped Cmd+K capture).
No drag and drop, no library, keyboard reachable throughout.

Section 1 is the correction pass against the real files; section 3 is the
persistence schema and its migration path; section 5 is an explicit list of
what this deliberately does NOT do, so scope is not assumed later.

# THE RACK — BUILD SPEC

Repo `/Users/macbookairm3/Documents/Trader-Journal`, branch `renovation/v2`. Every line number below was re-read today; where the design brief drifted, the correction is in §1 and the rest of the doc uses the corrected fact.

---

## 1. CORRECTIONS TO THE DESIGN BRIEF

**C1 — The density pass is already partly built.** `clay-v3.css` ends with a live block `THE DESK COMES UPSTAIRS — dashboard density pass` (clay-v3.css:501-606), PHASE 1 only: `#dashboard .panel-grid-analytics` gap/padding/head compression, inside `@media (min-width:1025px)`. The deck, quad, rail and status strip are still untouched. So this work does not wait on density; it lands beside a block that already exists and already declares the 1025px seam and the by-hand 11px floor. Put all rack/rail CSS in that same file, in that same media block where desktop-only.

**C2 — 38 tests, not 36.** `ls tests/*.mjs | wc -l` = 38. All green today (`npm test`).

**C3 — `tests/mobileFloors.check.mjs` does NOT read `clay-v3.css`.** Line 64: `const rules = [...parse("styles.css"), ...parse("clay-v2.css")];`. Anything written in clay-v3.css is invisible to the 11px/44px enforcement. I verified that adding `...parse("clay-v3.css")` to that array passes today (2682 rules scanned, exit 0). Phase 4 makes that one-line change, because the drawer is phone-visible.

**C4 — `--radius-clay-lg` is 34px in clay-v2.css:47, and `--radius-xl: var(--radius-clay-lg)` at clay-v2.css:52.** styles.css:145 also declares `--radius-clay-lg: 26px` but clay-v2 loads later and wins. Both are `:root`, so a new `--radius-cell` at `:root` in clay-v3.css is the correct home (matches the no-element-scoped-token-pins memory).

**C5 — every `.topnav-*` CHILD rule is a standalone class selector, never descendant-scoped under `.topnav`.** Confirmed by grep: clay-v2.css:613-795 are all bare `.topnav-mark`, `.topnav-btn`, `.topnav-label`, `.topnav-menu`, etc. Only three rules name the container: clay-v2.css:589 (`.topnav`), :603 (the `min-width:1025px` display:flex), :609 (`body.auth-locked .topnav`). **Therefore: change ONLY the root element's class from `topnav` to `rail`, keep every child class verbatim.** The rail inherits the entire existing icon/label/menu/badge/focus-ring skin for free and needs geometry overrides only. Do not rename `topnav-btn` etc. — `tests/mobileFloors.check.mjs:32` `OFF_PHONE` whitelists `.topnav-label` and `.topnav-badge` by exact string, and renaming them re-opens a 9px type failure.

**C6 — `syncChromeHeight` builds its bar list ONCE, and dropping `.topnav` breaks it in the opposite direction from the brief's fear.** app.js:15034-15046: `[document.querySelector(".topnav"), #sidebar, #demoBanner, .tabbar]`. With the topnav gone, at ≥1025 the sidebar is `display:none` (styles.css:3886), the demo banner is usually hidden, the tabbar is `display:none` — so `bottom === 0` and app.js:15062 runs `root.style.removeProperty("--chrome-h")`, which drops every consumer to its **86px fallback**. That is an 86px dead band above every pinned view on desktop, not a blank app. The rail must never be added to that list, AND the else-branch needs the fix in Phase 1.

**C7 — `.view.is-active` is ALREADY `display: grid`** (styles.css:2620-2623, with `.view { gap: 14px }` at 2615). The rack is a `grid-template-columns` override on `#dashboard.is-active`, not a new display mode.

**C8 — the widget count is 18, not 16.** The seven analytics panels are `<article class="panel panel-chart panel-span-N">` with **no ids** (index.html:1844, 1882, 1895, 1923, 1940, 1953, 1966) — only their canvases have ids. Same for the two bottom panels (index.html:1982 `panel-span-5`, index.html:2016 `panel-span-7`). Every one of these needs a `data-w` attribute added; there is no existing selector to address them by.

**C9 — the Risk Controls panel has no id** (index.html:2060, bare `<section class="panel">`). Add `id="riskPanel"`. `#riskRulesBtn` jumps to `ui.rulesPanel`, not to this (app.js:1654-1657), so nothing depends on it today.

**C10 — the `display:contents` risk is one rule, not a family.** Grep of app.js + src/modules for the wrapper classes returns exactly three hits: app.js:8528 and 8546 (`closest(".dash-quad-card")` — a child, unaffected) and app.js:8913 (`querySelectorAll("#dashboard .panel-grid-analytics > .panel, ...")` — a descendant selector, unaffected by `display:contents`). **No code reads `offsetWidth`/`getBoundingClientRect` on any dissolved wrapper.** The only wrapper a renderer toggles is `#dashboardMetricGrid` (`ui.metricGrid.hidden = !hasTrades`, app.js:8556-8557). So one guard rule is required, not a guard-rule family. Judge 3's graft (flatten the HTML statically) is over-engineering against a hazard that measures one line — skipped.

**C11 — `.dash-quad` and `.dash-rail` are NOT dissolved.** They are single cells whose internal `repeat(4)` / `repeat(7)` grid is the cell's own layout. Dissolve list is exactly five: `#dashboardMetricGrid`, `.dash-deck`, `.dash-boards`, `.panel-grid-analytics`, `.panel-grid-bottom`.

**C12 — the `<=1239px` order block must be deleted, not left inert.** styles.css:10199-10217 writes `#dashboard.is-active > * { order: 3 }` etc. Inline `style.order` beats it, but non-widget children (`.dash-head`) would keep CSS order 0 while the rack wants -3, and the block's whole premise (edge-mini is column 2 above 1240) dies with styles.css:10163-10186.

**C13 — `body.auth-locked` and `body.is-authenticated`/`.is-preview`/`.is-guest` are mutually exclusive** (app.js:2603-2613: `locked = !previewMode && !guestMode && checked && !isAuthenticated`). So the rail's visibility gate needs no `:not(.auth-locked)` — the positive three-class gate the tabbar already uses (styles.css:8437 region) is sufficient and `body.auth-locked .rail { display:none !important }` is belt-and-braces only.

**C14 — `state.dashboard` already exists** (app.js:~274, holds `balanceRange`). Any per-session rack state (the undo slot, edit mode) goes there or in a function-scoped variable — no new module-level `const` anywhere.

**C15 — the drawer has an established pattern to copy.** Nine `<dialog>` elements already ship (index.html:3050, 3183, 3203, 3234, 3472, 3502, 3636) and `showModal()` is used at eight call sites. Copy `#accountDialog` (index.html:3502) for markup shape and app.js:10907 for the open/close idiom.

**C16 — tests can drive real app.js functions.** `tests/journalQueue.check.mjs` slices a named function out of app.js source and evals it (`takeFunction(src, name)`). The rack's persistence test uses that pattern, not a text-match.

---

## 2. PHASES

Five phases. Each is independently verifiable in a browser and each leaves the app shippable if the next never lands.

---

### PHASE 1 — THE RAIL

**Value: the user's ask #1, delivered whole. Risk: the chrome math (C6). Ships alone.**

#### 1.1 `app.js` — fix the chrome fallback FIRST

File `app.js`, function `syncChromeHeight` (starts line 15022). Anchor: the `else` branch at lines 15059-15065.

```js
    if (bottom > 0) {
      root.style.setProperty("--chrome-h", `${bottom}px`);
    } else if (document.querySelector(".rail")?.getBoundingClientRect().width > 0) {
      // THE RAIL IS SIDE CHROME AND MEASURES ZERO AT THE TOP, ON PURPOSE.
      // It is deliberately absent from the bar list above: its bottom edge is
      // the bottom of the window, and this function publishes a bar's BOTTOM,
      // so listing it would pin every view's top to ~100vh. With the topnav
      // gone there is genuinely nothing above the page on desktop, and the old
      // else-branch's removeProperty() would drop --chrome-h to its 86px
      // stylesheet fallback -- an 86px dead band above every pinned view.
      // Zero, explicitly. The width test is what separates "the rail is on
      // screen" from the locked-session screen, where it is display:none.
      root.style.setProperty("--chrome-h", "0px");
    } else {
      // Both hidden: the locked-session screen, where nothing is pinned.
      root.style.removeProperty("--chrome-h");
    }
```

No other JS change in this phase. `ui.navButtons` (app.js:305) is `querySelectorAll(".nav-btn")` at module eval, `app.js` is `<script type="module">` at index.html:3690 (deferred, DOM complete), and every rail button keeps `.nav-btn` + `data-target`. `switchView` (app.js:1923), the hash router, `updateAccessGate` (app.js:2619), `#navUnjournalledBadge`, `#topnavMore` (app.js:1758-1773), `#riskRulesBtn` (app.js:1654) all keep working with zero edits.

#### 1.2 `index.html` — move the element, rename one class

Cut the whole block `index.html:1292-1372` (`<nav class="topnav" …>` through `</nav>`, plus its comment at 1286-1291) out of `<main class="content">`, and paste it as a **direct child of `<body>`**, immediately before `<nav class="tabbar" id="tabBar">` (index.html:2975). Change exactly one attribute:

```html
<!-- THE RACK'S SPINE. Desktop chrome, >=1025px, replacing .topnav one for one.
     A BODY child, not a .content child, and class="rail" not class="topnav":
     app.js syncChromeHeight() measures a bar's BOTTOM edge from the list
     [.topnav, #sidebar, #demoBanner, .tabbar], and a full-height left rail's
     bottom edge is the bottom of the window. Matching that selector would pin
     every view's top to ~100vh. Every child class stays topnav-* verbatim so
     the shipped icon, label, badge, menu and focus-ring rules apply unchanged
     (clay-v2.css:613-795 are all bare class selectors, never descendant
     scoped), and tests/mobileFloors OFF_PHONE keeps matching by name. -->
<nav class="rail" aria-label="Main sections">
```

Everything from `<button class="topnav-mark nav-btn" …>` to `</nav>` is byte-identical. Do not touch ids, `data-target`, `data-nav-silent`, `data-terminal-nav`, `data-theme-toggle`, `data-account-switch-wrap`, `#topnavMore`, `#exportCsvBtn`, `#desktopLogoutBtn`, `#previewLandingBtnDesktop`.

Then add a flexible spacer before `<div class="topnav-actions">` (index.html:1339) so the bottom cluster sinks:

```html
          <span class="rail-spacer" aria-hidden="true"></span>
```

#### 1.3 `clay-v2.css` — retire the three container rules

Delete clay-v2.css:589-611 (`.topnav { … }`, the `@media (min-width:1025px) { .topnav { display:flex } }`, and `body.auth-locked .topnav`). Nothing else in any sheet references `.topnav` as a container.

#### 1.4 `clay-v3.css` — the rail, at the end of the file, inside a new block

```css
/* ==========================================================================
   THE RACK, PART 1: THE SPINE.

   The nav stops being a bar and becomes a 56px fixed left rail of numbered
   instrument keys, collapsed by default, expanding as an OVERLAY on hover or
   keyboard focus. Overlay is the whole point: the layout only ever reserves
   56px, so expanding costs the dashboard nothing and reflows nothing.

   --rail-w is 0px everywhere by default and 56px only where the rail actually
   renders. That is what lets every fixed-position consumer below write
   left: var(--rail-w) with no media fork: on tablet, on a phone, and on the
   locked landing the token is 0 and the arithmetic is today's, verbatim.

   Desktop only, so the 9px mono index chips are genuinely unreachable on a
   phone -- the same standing the .topnav-label they reuse already had.
   ========================================================================== */
:root {
  --rail-w: 0px;
  /* One radius for every terminal cell, the rail's keys, the add slot and the
     drawer rows. --radius-clay-lg is 34px (clay-v2.css:47) and a 34px corner
     cannot read small; this is the density pass's fix, declared once at :root
     rather than pinned per element. */
  --radius-cell: 10px;
}

.rail { display: none; }

@media (min-width: 1025px) {
  /* Same three-class gate the .tabbar and .app-layout already use for "the
     app shell is on screen". body.auth-locked never carries any of them
     (app.js updateAccessGate), so the landing keeps a rail-free full width. */
  body.is-authenticated,
  body.is-preview,
  body.is-guest:not(.demo-signup) { --rail-w: 56px; }

  body.is-authenticated .rail,
  body.is-preview .rail,
  body.is-guest:not(.demo-signup) .rail {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    position: fixed;
    /* Hangs off the measured chrome so a demo banner pushes it down instead
       of sitting under it; 0px because on desktop the rail IS the chrome. */
    top: var(--chrome-h, 0px);
    left: 0;
    bottom: 0;
    width: var(--rail-w);
    padding: 10px 4px;
    /* Above the pinned views (z:20) and level with the dock's ladder. */
    z-index: var(--z-nav);
    background: var(--surface-2);
    border-right: 1px solid var(--line);
    border-radius: 0;
    overflow: hidden;
    transition: width var(--dur-base, 180ms) var(--ease-out, ease);
  }

  body.auth-locked .rail { display: none !important; }

  /* EXPANSION IS PURE CSS, AND :focus-within IS THE KEYBOARD HALF OF IT.
     Tab into the rail and it opens exactly as hover opens it: full parity,
     zero JS, nothing to forget on a new code path. */
  .rail:hover,
  .rail:focus-within { width: 208px; }

  .rail-spacer { flex: 1 1 auto; }

  /* The keys. .topnav-btn ships as a 62x52 column (clay-v2.css:652); in the
     rail it is a 48x48 square that grows a label beside the icon. 48 is over
     the 44px floor and the rail is desktop only either way. */
  .rail .topnav-links,
  .rail .topnav-actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    width: auto;
  }

  .rail .topnav-mark,
  .rail .topnav-btn,
  .rail .topnav-icon-btn {
    flex-direction: row;
    justify-content: flex-start;
    gap: 10px;
    min-width: 0;
    width: 100%;
    height: 48px;
    padding: 0 12px;
    border-radius: var(--radius-cell);
    white-space: nowrap;
  }

  .rail .topnav-icon { flex: 0 0 24px; }

  /* Labels are clipped, not display:none: a screen reader must still read
     them collapsed, and opacity/width animate where display cannot. */
  .rail .topnav-label {
    font-size: 11px;
    opacity: 0;
    transition: opacity 120ms var(--ease-out, ease);
  }
  .rail:hover .topnav-label,
  .rail:focus-within .topnav-label { opacity: 1; }

  /* Active view: an indicator light on the rail's own edge, not a pill. */
  .rail .topnav-btn.is-active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 2px;
    background: var(--accent);
  }
  .rail .topnav-btn { position: relative; }

  .rail .topnav-rule {
    width: auto;
    height: 1px;
    margin: 6px 8px;
    background: var(--line);
  }

  /* The overflow menu pops RIGHT of the rail, not below a bar. */
  .rail .topnav-menu {
    top: auto;
    right: auto;
    bottom: 0;
    left: calc(100% + 6px);
  }

  .rail .account-switch { padding: 0 6px; }
}
```

#### 1.5 The hardcoded `left: 0` stragglers — the grep is mandatory

Run `grep -n "position: *fixed" styles.css clay-v2.css clay-v3.css` and audit every hit against the rail. The six sites the recon named, verified today:

| file:line | today | becomes |
|---|---|---|
| styles.css:12294 | `inset: var(--chrome-h, 86px) 0 0 0;` | `inset: var(--chrome-h, 86px) 0 0 var(--rail-w, 0px);` |
| styles.css:11480 | `inset: var(--chrome-h, 86px) 0 0 0;` | `inset: var(--chrome-h, 86px) 0 0 var(--rail-w, 0px);` |
| styles.css:11496 | `inset: var(--chrome-h, 64px) 0 var(--dock-h, 76px) 0;` | last `0` → `var(--rail-w, 0px)` |
| styles.css:12021 | `inset: calc(var(--chrome-h, 86px) + var(--tape-h, 34px)) 0 0 0;` | last `0` → `var(--rail-w, 0px)` |
| styles.css:12027 | `.bb-wall[data-size="max"] { inset: … 0 var(--dock-clear-h, 112px) 0; }` | last `0` → `var(--rail-w, 0px)` |
| styles.css:12188 | `inset: var(--chrome-h, 86px) 0 0 auto;` | unchanged — `left:auto`, right-anchored, already correct |
| styles.css:9314-9315 | `.dash-ticker-dock { … left: 50%; }` | `left: calc(var(--rail-w, 0px) + (100% - var(--rail-w, 0px)) / 2);` |

`.bb-tape` (styles.css:12036, 12044) is `top: var(--chrome-h)` with no left — check its `left` in situ; if it is `0`, apply the same substitution.

#### 1.6 `--shell-w` re-centres on the true content column

styles.css:3877-3880:

```css
  :root {
    /* 96vw of the window minus the rail, not 96vw of the window: the pinned
       views are inset by --rail-w now, so the centering calc at line 12315
       resolves 100% against a box that is already rail-width narrower. Below
       1025 --rail-w is 0 and this is the shipped number, character for
       character. */
    --shell-w: min(1480px, calc((100vw - var(--rail-w, 0px)) * 0.96));
  }
```

Leave `.app-layout { width: var(--shell-w) }` (styles.css:3882-3885) alone: on desktop `.app-layout` holds only the now-empty `.content` (all views are `position:fixed` at ≥900px), and below 1025 `--rail-w` is 0.

#### 1.7 CHECK — Phase 1

1. `npm test` → 38 green.
2. Browser at 1440x900, logged in: rail on the left at 56px; dashboard content starts at x≈56 with no left overlap and no 86px band at the top. Console: `getComputedStyle(document.documentElement).getPropertyValue("--chrome-h")` must read `0px` — **if it reads empty or 86px, §1.1 did not land.**
3. Hover the rail → it widens to 208px over the dashboard and **the dashboard does not move**. Tab from the address bar → the rail expands on first focus.
4. Click every key: view switches, `location.hash` updates, the active key's left indicator moves, `aria-current` follows.
5. Open the Edge tab: `#terminal` and `.bb-wall` start right of the rail, not under it.
6. Resize to 1024 → rail vanishes, sidebar top rail returns, `--chrome-h` goes back to ~52px. Resize to 899 → tabbar + FAB unchanged.
7. Log out → landing page renders full-bleed, no rail, `--rail-w` resolves to `0px`.

---

### PHASE 2 — THE RACK GRID

**Value: makes the dashboard addressable. Risk: low, CSS + attributes only. Ships alone (the page looks like today, in 12 columns).**

#### 2.1 `index.html` — 19 attributes, one id, one new element

Add `data-w="<id>"` to exactly these nodes (nothing else changes on any of them):

| line | element | `data-w` |
|---|---|---|
| 1554 (child `<article class="metric-card metric-card-balance dash-hero …">`) | balance hero | `hero` |
| 1586 | `#riskStrip` | `risk` |
| 1637 | `#propTracker` | `prop` |
| 1699 | `<section class="dash-quad">` | `quad` |
| 1727 | `#dashPlaybook` | `playbook` |
| 1742 | `#dashUnjournalled` | `unjournalled` |
| 1773 | `<section class="dash-rail …">` | `stats` |
| 1513 | `#dashEdgeMini` | `edgeMini` |
| 1821 | `#dashLeonTape` | `leon` |
| 1844 | `<article class="panel panel-chart panel-span-8">` (equity) | `equity` |
| 1882 | `<article class="panel panel-chart panel-span-4">` (drawdown) | `drawdown` |
| 1895 | strategy performance | `strategy` |
| 1923 | trader score | `traderScore` |
| 1940 | psychology | `psychology` |
| 1953 | session | `session` |
| 1966 | r-multiple | `rMultiple` |
| 1982 | `<section class="panel panel-span-5">` (discipline) | `discipline` |
| 2016 | `<section class="panel panel-span-7">` (edge detection) | `edgeTable` |

Add `id="riskPanel"` to `<section class="panel">` at index.html:2060.

Add the add slot as the LAST child of `#dashboard`, after `#adminPanelsMount` (index.html:2147):

```html
          <!-- THE PLUS IS THE ONE SLOT NOTHING IS BOLTED INTO. A permanent
               cell of the rack, drawn in hairline dashes, never a button
               floating over the page -- and nothing like the phone FAB's
               filled circle, so the log a trade reflex is never retrained. -->
          <button id="rackAddSlot" class="rack-add" type="button" aria-haspopup="dialog">
            <span class="rack-add-plus" aria-hidden="true">+</span>
            <span class="rack-add-label">Add cell</span>
            <span class="rack-add-count" id="rackAddCount"></span>
          </button>
```

#### 2.2 `styles.css` — delete the two-column special case

Delete styles.css:10162-10187 (the `@media (min-width:1240px)` `#dashboard.is-active` grid, the `#dashboard > *:not(.dash-edge-mini)` blanket, and the `.dash-edge-mini` `grid-row: 1/30` sticky block) and styles.css:10199-10217 (the `@media (max-width:1239px)` order reshuffle, including `.dash-edge-mini { grid-column: 1 / -1 }`). Keep `.dash-edge-mini[hidden] { display: none }` (styles.css:~10219) and keep the `@media (max-width:899px) { .dash-leon { display: none } }` block (styles.css:10190-10196) — that data gate outranks user preference by design.

#### 2.3 `clay-v3.css` — the rack, appended after the Phase 1 block

```css
/* ==========================================================================
   THE RACK, PART 2: THE GRID.

   #dashboard.is-active is already display:grid (styles.css:2620). This makes
   it TWELVE columns and dissolves the five intermediate wrappers with
   display:contents, so every widget node becomes a direct grid item WITHOUT
   A SINGLE DOM MOVE. That is the load-bearing part: #dashEdgeMiniTv hosts a
   live stream iframe, the 5s poll patches [data-live-field] and
   [data-ticker-price] nodes in place, and every ui.* reference was collected
   once at boot (app.js:305-440). Reparenting any of them restarts a stream or
   orphans a binding. Nothing here reparents anything, ever.

   NOT dissolved: .dash-quad and .dash-rail. Each is ONE cell whose internal
   repeat(4) / repeat(7) is its own layout, not the rack's.
   ========================================================================== */
@media (min-width: 900px) {
  #dashboard.is-active {
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 8px;
    align-content: start;
  }

  #dashboard .dash-stats,
  #dashboard .dash-deck,
  #dashboard .dash-boards,
  #dashboard .panel-grid-analytics,
  #dashboard .panel-grid-bottom { display: contents; }

  /* THE ONE GUARD THE DISSOLUTION NEEDS. A display:contents box has no box,
     so .dash-stats[hidden]{display:none} (styles.css:4756) stops hiding
     anything -- and #dashboardMetricGrid is toggled by a renderer
     (app.js:8557, the empty-state swap). Audited: this is the only wrapper
     any renderer touches, and no code reads offsetWidth off any of the five
     (the two #dashboard querySelectorAll calls at app.js:8913 and in
     setupScrollReveals use descendant selectors, which are unaffected). */
  #dashboard .dash-stats[hidden] > * { display: none; }

  /* FURNITURE, NOT CELLS. Fixed orders, full width, never customisable. */
  #dashboard > .dash-head            { order: -3; grid-column: 1 / -1; }
  #dashboard > #estimatedAnalyticsNotice { order: -2; grid-column: 1 / -1; }
  #dashboard > #dashboardEmptyState  { order: -1; grid-column: 1 / -1; }
  #dashboard > #rackAddSlot          { order: 899; grid-column: 1 / -1; }
  #dashboard > #accountsPanel,
  #dashboard > #riskPanel,
  #dashboard > #rulesPanel,
  #dashboard > #adminPanelsMount     { order: 900; grid-column: 1 / -1; }

  /* Edge mini keeps its periphery behaviour inside its own cell rather than
     losing it with the grid-row:1/30 column that just died. */
  #dashboard [data-w="edgeMini"] { position: sticky; top: 0; align-self: start; }
}

/* PRESENCE IS TWO CONDITIONS, AND CSS COMBINES THEM. .w-off is the trader's
   choice; [hidden] belongs to the renderer, which self-hides #propTracker,
   #dashPlaybook, #dashUnjournalled, #dashEdgeMini, #dashLeonTape and
   #riskStrip when they have nothing honest to print. Two mechanisms, one
   result -- never one attribute fought over by two writers. */
#dashboard .w-off,
#dashboard [data-w][hidden] { display: none !important; }

/* One column on a phone. The saved ORDER and PRESENCE still apply; only width
   collapses. The quad's internal 2x2 is the cell's business, not the rack's. */
@media (max-width: 899px) {
  #dashboard [data-w] { grid-column: 1 / -1 !important; }
}
```

#### 2.4 CHECK — Phase 2

1. `npm test` → 38 green (`cssSanity` covers the new selector syntax; it reads all three sheets, tests/cssSanity.check.mjs:23).
2. At 1440x900 the dashboard renders as one 12-column rack: hero 8 + risk 4 on a row, quad 12, playbook/unjournalled 6+6 (from the surviving `panel-span-*` and `.dash-hero { grid-column: span 8 }` declarations), analytics panels in their span classes. No wrapper gaps, no double gutters.
3. `document.querySelectorAll("#dashboard [data-w]").length` → **18**.
4. Delete all trades (or set `state.analytics.totalTrades = 0` and re-render): the empty state shows and **the metric cells disappear** — this is the one guard rule proving itself. If they stay visible, §2.3's `[hidden] > *` rule is missing or out-specificity'd.
5. `#dashEdgeMiniTv`: start a stream, resize the window across 1240 and 900 — it must never re-buffer.
6. At 375px: one column, the tabbar and FAB untouched, `#dashLeonTape` still gone.

---

### PHASE 3 — THE LAYOUT ENGINE AND ITS PERSISTENCE

**Value: nothing visible. Risk: the whitelist footgun. Ships alone — the default is today's page exactly, so a failed reload is indistinguishable from success, which is precisely why the check in 3.5 is mandatory.**

#### 3.1 `app.js` — `DEFAULT_SETTINGS`, line 122

```js
  accounts: [],
  activeAccountId: "",
  // THE RACK. null means "never customised", which rackLayout() answers with
  // the code default -- not an empty desk. Safely above the init() call at
  // line 1138 like every other module binding (tests/bootOrder.check.mjs).
  dashboardLayout: null
```

#### 3.2 `app.js` — `normalizeSettings`, inside the returned object at line 12399-12400

```js
    accounts: normalizeAccounts(value.accounts),
    activeAccountId: String(value.activeAccountId || ""),
    // THE RACK, AND THE WHITELIST IS THE POINT. This function REBUILDS the
    // settings object field by field, so a key that is not named here is
    // silently dropped on every load (app.js:12289) and on every server
    // roundtrip (app.js:7291, 7411) -- the layout would appear to work all
    // session and evaporate on reload. Same absent-vs-empty shape as
    // preTradeRules above: Array.isArray, not truthiness, because a trader who
    // ejects every cell must get an empty rack back rather than the default.
    // Ids and spans are validated at READ time in rackLayout(), against the
    // registry, so this only has to preserve shape.
    dashboardLayout: value.dashboardLayout && Array.isArray(value.dashboardLayout.cells)
      ? {
          v: 1,
          cells: value.dashboardLayout.cells
            .filter((cell) => cell && typeof cell.id === "string")
            .map((cell) => ({ id: cell.id, on: cell.on !== false, span: Number(cell.span) || 0 }))
        }
      : null
```

#### 3.3 `app.js` — the registry and the applier

Place immediately **above** `function switchView(id)` (app.js:1923). All four are `function` declarations — hoisted, so they are reachable from `init()` even though they sit below it in the file, and they add zero module-level bindings (tests/bootOrder.check.mjs scans for `const`/`let`/`var` only).

```js
/* ===========================================================================
   THE RACK. The dashboard is a rack of 18 units; the trader chooses which are
   mounted, in what order, at what width.

   Function declarations, not a module const: app.js calls init() at line 1138
   and a module-level binding below that line is in the temporal dead zone
   during the first render. That has shipped four times
   (tests/bootOrder.check.mjs). A hoisted function has no such window.

   applyRackLayout() writes THREE things and nothing else: style.order,
   style.gridColumn and one class. No node is ever moved, created or destroyed,
   so the edge mini's live iframe, the 5s poll's in-place patch targets and
   every ui.* reference collected at boot survive arbitrary rearranging BY
   CONSTRUCTION rather than by discipline.
   =========================================================================== */

/* id, the selector that finds the node already in the HTML, the drawer's copy,
   the spans that produce an honest cell for THIS widget (not one global set:
   a reading row at 3 columns is a lie), the default, and whether it holds a
   canvas that has to be repainted when it gains layout width. `on` is the
   CODE DEFAULT -- what a trader with no saved layout sees. */
function rackRegistry() {
  return [
    { id: "hero",         sel: ".dash-hero",              label: "Balance",             desc: "Account equity, the range toggle and the curve", spans: [8, 12],     span: 8,  on: true,  chart: false, keys: "equity money account" },
    { id: "risk",         sel: "#riskStrip",              label: "Risk left",           desc: "What is left of today and this week",            spans: [4, 6],      span: 4,  on: true,  chart: false, keys: "loss limit budget dial" },
    { id: "prop",         sel: "#propTracker",            label: "Prop tracker",        desc: "Evaluation targets and the trailing drawdown",   spans: [6, 8, 12],  span: 12, on: true,  chart: false, keys: "evaluation firm funded payout" },
    { id: "quad",         sel: ".dash-quad",              label: "Edge quad",           desc: "Win rate, profit factor, expectancy, average RR", spans: [12],       span: 12, on: true,  chart: false, keys: "win rate profit factor expectancy rr edge" },
    { id: "playbook",     sel: "#dashPlaybook",           label: "Playbook",            desc: "Expectancy per setup, best and worst",           spans: [4, 6, 8],   span: 6,  on: true,  chart: false, keys: "setup strategy" },
    { id: "unjournalled", sel: "#dashUnjournalled",       label: "To journal",          desc: "Trades with no note yet, and the streak",        spans: [4, 6, 8],   span: 6,  on: true,  chart: false, keys: "queue notes streak review" },
    { id: "stats",        sel: ".dash-rail",              label: "Stat strip",          desc: "Trades, drawdown, best and worst day, streaks",  spans: [12],        span: 12, on: true,  chart: false, keys: "drawdown streak total best worst" },
    { id: "edgeMini",     sel: "#dashEdgeMini",           label: "Edge desk",           desc: "The monitor, the news verdict and the countdown", spans: [4, 6],     span: 4,  on: true,  chart: false, keys: "terminal news monitor calendar" },
    { id: "leon",         sel: "#dashLeonTape",           label: "Leon tape",           desc: "The public feed of verified trades",             spans: [12],        span: 12, on: true,  chart: false, keys: "feed public tape" },
    { id: "equity",       sel: "[data-w='equity']",       label: "Equity curve",        desc: "Cumulative profit and loss over time",           spans: [6, 8, 12],  span: 8,  on: true,  chart: true,  keys: "curve pnl growth" },
    { id: "drawdown",     sel: "[data-w='drawdown']",     label: "Drawdown",            desc: "Distance below the running high",                spans: [4, 6],      span: 4,  on: true,  chart: true,  keys: "underwater risk" },
    { id: "strategy",     sel: "[data-w='strategy']",     label: "Strategy performance", desc: "Every setup compared on one metric",            spans: [6, 8, 12],  span: 8,  on: false, chart: true,  keys: "setup compare dimension" },
    { id: "traderScore",  sel: "[data-w='traderScore']",  label: "Trader score",        desc: "One number for process, not for profit",         spans: [4, 6],      span: 4,  on: false, chart: true,  keys: "discipline grade" },
    { id: "psychology",   sel: "[data-w='psychology']",   label: "Psychology",          desc: "Results grouped by the mood you logged",         spans: [4, 6],      span: 4,  on: false, chart: true,  keys: "mood emotion tilt" },
    { id: "session",      sel: "[data-w='session']",      label: "Session",             desc: "Results by the hours you traded",                spans: [4, 6],      span: 4,  on: false, chart: true,  keys: "time london new york asia" },
    { id: "rMultiple",    sel: "[data-w='rMultiple']",    label: "R multiple",          desc: "The shape of your wins against your risk",       spans: [4, 6],      span: 4,  on: false, chart: true,  keys: "r distribution histogram" },
    { id: "discipline",   sel: "[data-w='discipline']",   label: "Discipline monitor",  desc: "Rule cost, goal progress and risk violations",   spans: [5, 6, 12],  span: 5,  on: false, chart: false, keys: "rules violations goal" },
    { id: "edgeTable",    sel: "[data-w='edgeTable']",    label: "Edge detection",      desc: "Where the money actually comes from",            spans: [7, 8, 12],  span: 7,  on: false, chart: false, keys: "table breakdown" }
  ];
}

/* The saved layout reconciled against the registry on every read. Array order
   IS display order, so there is no separate order field that can drift out of
   step with it. An id the registry no longer knows is dropped; an id the
   registry has GAINED is appended as on:false, so a widget shipped after a
   trader saved their desk turns up in the drawer instead of never existing. */
function rackLayout() {
  const registry = rackRegistry();
  const saved = state.settings.dashboardLayout;
  const savedCells = saved && Array.isArray(saved.cells) ? saved.cells : null;
  const cells = [];
  const seen = new Set();
  (savedCells || []).forEach((cell) => {
    const spec = registry.find((item) => item.id === cell.id);
    if (!spec || seen.has(spec.id)) return;
    seen.add(spec.id);
    cells.push({
      id: spec.id,
      on: cell.on !== false,
      span: spec.spans.includes(cell.span) ? cell.span : spec.span
    });
  });
  registry.forEach((spec) => {
    if (seen.has(spec.id)) return;
    // NO saved layout at all -> the code default, which is the density page.
    // A saved layout that simply predates this widget -> unmounted, waiting.
    cells.push({ id: spec.id, on: savedCells ? false : spec.on, span: spec.span });
  });
  return cells;
}

function rackNode(spec) {
  return document.querySelector(`#dashboard ${spec.sel}`);
}

/* repaint: pass true from every path that mounts a cell, widens a cell or
   leaves edit mode. A canvas that gets layout while display:none paints at its
   900px attribute fallback -- the same bug switchView() already forces around
   for the playbook page (app.js:1946-1955). One argument on one function is
   the whole guarantee; there is no second path that can forget it. */
function applyRackLayout(repaint) {
  const registry = rackRegistry();
  rackLayout().forEach((cell, index) => {
    const spec = registry.find((item) => item.id === cell.id);
    const node = spec && rackNode(spec);
    if (!node) return;
    node.style.order = String(index);
    node.style.gridColumn = `span ${cell.span}`;
    node.classList.toggle("w-off", !cell.on);
  });
  syncRackAddSlot();
  if (repaint && state.analytics) {
    renderCharts(state.analytics, { force: true });
  }
}

/* Mutations ride the shipped idiom exactly: mutate state.settings, persist,
   re-apply. persistState() buys demo scoping via journalStore()/journalKey(),
   the 900ms debounced server autosave and cross-device sync for free -- the
   settings blob is opaque to the API, so there is no server change at all.
   renderAll() is deliberately NOT called: no analytic changed, only geometry.
   One level of session undo, held in a closure, because eject is one tap. */
function rackSave(cells) {
  rackUndo(state.settings.dashboardLayout);
  state.settings.dashboardLayout = { v: 1, cells };
  persistState();
  applyRackLayout(true);
}

function rackUndo(store) {
  if (arguments.length) {
    rackUndo.previous = store;
    return undefined;
  }
  return rackUndo.previous;
}
```

#### 3.4 `app.js` — call it once at boot

In `init()` (app.js:1140), immediately after `renderAll();` (app.js:1186 region):

```js
  renderAll();
  // false: renderAll() has just painted every chart at its real width.
  applyRackLayout(false);
```

#### 3.5 CHECK — Phase 3

New file `tests/rackLayout.check.mjs`, using the `takeFunction` slicing pattern from `tests/journalQueue.check.mjs`. It must assert, driving the real `rackLayout` sliced out of app.js with a stubbed `state`:

1. `dashboardLayout: null` → every registry id present, `on` matching the registry default.
2. A saved `{v:1, cells:[{id:"equity",on:true,span:6}]}` → `equity` first with span 6, and **every other registry id present as `on:false`** (the new-widget path).
3. A saved layout naming a dead id (`{id:"ghost"}`) → dropped, no throw.
4. A saved span outside the widget's own `spans` (`{id:"stats",span:3}`) → clamped to the registry default 12.
5. **The whitelist round trip**: slice `normalizeSettings` and assert `normalizeSettings({dashboardLayout:{v:1,cells:[{id:"hero",on:false,span:8}]}}).dashboardLayout.cells.length === 1`, and that `normalizeSettings({dashboardLayout:{v:1,cells:[]}}).dashboardLayout` is an object with an empty `cells` array (present and empty survives), and that `normalizeSettings({}).dashboardLayout === null`.

Browser: the dashboard is pixel-identical to Phase 2. In the console run
`state.settings.dashboardLayout = {v:1,cells:[{id:"quad",on:true,span:12},{id:"hero",on:true,span:12}]}; persistState(); applyRackLayout(true);`
→ the quad moves above the hero, both full width, **and after a hard reload it is still that way**. That reload is the whitelist proving itself; skip it and the bug is invisible until a user reports it.

---

### PHASE 4 — THE PLUS, THE DRAWER, AND THE LEAN DEFAULT

**Value: the user's asks #2 and #3, delivered. Risk: copy and floors. Ships alone.**

The lean default and the drawer ship in the **same release**, with the one-time notice. Shipping the lean default without the drawer is data loss; shipping the drawer without the lean default gives it nothing to do.

#### 4.1 `index.html` — the drawer, beside the other dialogs

After `#accountDialog` (index.html:3502 block ends), copying its shape:

```html
    <!-- THE PARTS DRAWER. A native <dialog>: focus trap, Escape, backdrop and
         inert background, none of it written by hand. -->
    <dialog id="rackDrawer" class="rack-drawer" aria-labelledby="rackDrawerTitle">
      <form method="dialog" class="rack-drawer-form">
        <div class="rack-drawer-cmd">
          <span class="rack-drawer-prompt" id="rackDrawerTitle">&gt; add cell</span>
          <button class="rack-drawer-close" type="submit" value="close" aria-label="Close">&times;</button>
        </div>
        <input
          id="rackDrawerFilter"
          class="rack-drawer-filter"
          type="search"
          placeholder="Filter cells"
          aria-label="Filter cells"
          autocomplete="off"
        />
        <div id="rackDrawerList" class="rack-drawer-list"></div>
        <button id="rackArrangeBtn" class="rack-drawer-row rack-drawer-arrange" type="button">
          <span class="rack-drawer-name">Arrange cells</span>
          <span class="rack-drawer-tag">move, size, eject</span>
        </button>
      </form>
    </dialog>
```

Under the dash head, the one-time line (index.html, right after `</header>` at 1498):

```html
          <!-- ONE TIME, FOR EXISTING TRADERS. The lean default hides seven
               panels people checked yesterday; without this line the drawer
               reads as data loss and generates tickets. Dismissal is stored
               with the layout, so it never comes back. -->
          <p id="rackHint" class="rack-hint" hidden>
            <span>Seven cells are in the drawer. Press Add cell to mount them.</span>
            <button id="rackHintDismiss" class="rack-hint-dismiss" type="button">Got it</button>
          </p>
```

Copy check: no em or en dash, no `&mdash;`/`&ndash;`, in any of the new strings — `tests/copyDashes.check.mjs:31` matches the entity forms too.

#### 4.2 `app.js` — flip the registry defaults

In `rackRegistry()`, set `on: false` for `strategy`, `traderScore`, `psychology`, `session`, `rMultiple`, `discipline`, `edgeTable` (already written that way in §3.3). Everything else stays `on: true`. `prop` stays mounted and costs nothing: `renderPropTracker` self-hides it until an account has prop rules, and it appears the day that becomes true.

#### 4.3 `app.js` — the drawer, placed beside the rack block

```js
function rackAvailable() {
  return rackLayout().filter((cell) => !cell.on).length;
}

function syncRackAddSlot() {
  const count = document.getElementById("rackAddCount");
  if (!count) return;
  const available = rackAvailable();
  // Visible but quiet at zero: the slot is the rack's one empty bay, not a
  // button that comes and goes.
  count.textContent = available ? `${available} available` : "all mounted";
}

function openRackDrawer() {
  const dialog = document.getElementById("rackDrawer");
  if (!dialog) return;
  renderRackDrawer("");
  dialog.showModal();
  document.getElementById("rackDrawerFilter")?.focus();
}

function renderRackDrawer(filter) {
  const list = document.getElementById("rackDrawerList");
  if (!list) return;
  const registry = rackRegistry();
  const needle = String(filter || "").trim().toLowerCase();
  const rows = rackLayout()
    .map((cell) => ({ cell, spec: registry.find((item) => item.id === cell.id) }))
    .filter(({ spec }) => spec && (
      !needle ||
      spec.label.toLowerCase().includes(needle) ||
      spec.desc.toLowerCase().includes(needle) ||
      spec.keys.includes(needle)
    ));
  const off = rows.filter((row) => !row.cell.on);
  const on = rows.filter((row) => row.cell.on);
  list.innerHTML = "";
  off.forEach((row) => list.appendChild(rackDrawerRow(row, false)));
  if (off.length && on.length) {
    const rule = document.createElement("span");
    rule.className = "rack-drawer-rule";
    list.appendChild(rule);
  }
  on.forEach((row) => list.appendChild(rackDrawerRow(row, true)));
}

function rackDrawerRow({ cell, spec }, mounted) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `rack-drawer-row${mounted ? " is-mounted" : ""}`;
  button.dataset.rackMount = spec.id;
  button.disabled = mounted;
  const node = rackNode(spec);
  // "Mounting it is allowed, it just has nothing true to print yet" -- the
  // renderer's own self-hide keeps it invisible until it does, which is the
  // honesty rule doing its job rather than the drawer lying about state.
  const dataless = !mounted && node && node.hasAttribute("hidden");
  const fits = spec.id === "prop" && !mounted && Array.isArray(state.settings.accounts)
    && state.settings.accounts.some((account) => account && account.propRules);
  button.innerHTML = `
    <span class="rack-drawer-name">${escapeHtml(spec.label)}</span>
    <span class="rack-drawer-desc">${escapeHtml(spec.desc)}</span>
    <span class="rack-drawer-tag">${mounted ? "on" : (fits ? "fits this account" : (dataless ? "no data yet" : `span ${cell.span}`))}</span>`;
  return button;
}
```

Bindings, added at the end of `bindEvents()` (the function that owns app.js:1451-1780):

```js
  document.getElementById("rackAddSlot")?.addEventListener("click", openRackDrawer);
  document.getElementById("rackDrawerFilter")?.addEventListener("input", (event) => {
    renderRackDrawer(event.target.value);
  });
  document.getElementById("rackDrawerList")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-rack-mount]");
    if (!row || row.disabled) return;
    const id = row.dataset.rackMount;
    const cells = rackLayout().filter((cell) => cell.id !== id);
    const mounted = rackLayout().find((cell) => cell.id === id);
    cells.push({ ...mounted, on: true });     // lands at the end of the rack
    rackSave(cells);                          // persists + applyRackLayout(true)
    document.getElementById("rackDrawer")?.close();
    const spec = rackRegistry().find((item) => item.id === id);
    const node = spec && rackNode(spec);
    if (node) {
      node.classList.add("is-rack-landed");
      node.addEventListener("animationend", () => node.classList.remove("is-rack-landed"), { once: true });
      scrollDashboardTo(node);
      // Focus follows the cell, so a keyboard trader is standing where the
      // thing they just mounted actually is.
      node.setAttribute("tabindex", "-1");
      node.focus();
    }
  });
  // The deliberate sibling of the Cmd+K capture reflex the product already
  // trained: Shift+Cmd+K is the drawer.
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openRackDrawer();
    }
  });
```

The one-time hint: show it in `applyRackLayout` when `state.settings.dashboardLayout === null && rackAvailable() > 0 && state.trades.length > 0`; dismiss writes the current default layout to settings (`rackSave(rackLayout())`), which makes `dashboardLayout` non-null and retires the hint permanently with no extra storage key.

#### 4.4 `clay-v3.css` — add slot, drawer, hint

Every number below is a floor, not a preference. `#rackAddSlot`, every `.rack-drawer-row`, `.rack-drawer-close` and `.rack-hint-dismiss` get `min-height: 44px`; every label gets `font-size: 11px` or larger. The drawer is phone-visible, so it also gets `@media (max-width:640px) { #rackDrawer { width:100%; max-width:none; height:100%; max-height:none; margin:0; border-radius:0 } }`.

```css
#rackAddSlot {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 10px 14px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-cell);
  background: transparent;
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
}
#rackAddSlot:hover { border-color: var(--accent); color: var(--text); }
.rack-add-count { margin-left: auto; }
```

#### 4.5 `tests/mobileFloors.check.mjs` — line 64

```js
const rules = [...parse("styles.css"), ...parse("clay-v2.css"), ...parse("clay-v3.css")];
```

Verified green today against the file as it stands, so this change is a hardening, not a fix. Update the `OFF_PHONE` comment at line 29 from `.topnav is display:none below 1025px` to `.rail is display:none below 1025px`.

#### 4.6 CHECK — Phase 4

1. `npm test` → 39 green (the new rack test included), specifically `copyDashes` and `mobileFloors`.
2. Fresh journal (clear localStorage): the dashboard shows head, hero+risk, quad, playbook+unjournalled, stat strip, equity+drawdown, the gated cells, then the add slot reading **`7 available`**, then the config panels. Measure the dashboard's scroll height at 1440x900 — it should land near the density budget's third.
3. Press the add slot → drawer opens focused on the filter. Type `expectancy` → the edge quad row survives the filter. Clear it, press `Trader score` → it mounts at the end of the rack, flashes, scrolls into view, is focused, **and its canvas is drawn at the correct width, not 900px**. Reload → still mounted.
4. Shift+Cmd+K opens the same drawer.
5. Tab through the drawer: every row is reachable, Enter mounts, Escape closes.
6. Existing user (a journal saved before this ships): the hint line appears once, `Got it` dismisses it, reload → gone.
7. Guest/demo mode: mount a cell, open a new tab → the real account is unaffected (`journalStore()` returns sessionStorage under the `demo:` prefix).
8. 375px: the drawer is a full-screen sheet, every row ≥44px, the FAB is still the only floating plus.

---

### PHASE 5 — ARRANGE MODE

**Value: order and size. Risk: low. Ships alone.**

`ARRANGE CELLS` in the drawer (and Shift+click on the add slot) toggles `body.rack-edit`. In that state CSS reveals a header strip already present in each cell — **build the strip once, in `applyRackLayout`, appended to every `[data-w]` node, and never rebuild it**, so focus survives every reorder:

```js
function rackEditStrip(spec, cell, index, total) {
  // Built once per cell and then only relabelled. Rebuilding it on every
  // mutation would move focus off the button the trader is holding down.
  ...
}
```

Four real buttons per strip, each `min-height:44px`, each with an `aria-label` (`Move Equity curve earlier`), plus one visually hidden `aria-live="polite"` region on `#dashboard` announcing `Equity curve, position 5 of 9` and `Drawdown set to 4 columns`. Below 900px the move labels read `Move up` / `Move down`.

One delegated listener on `#dashboard`:

```js
  document.getElementById("dashboard")?.addEventListener("click", (event) => {
    const key = event.target.closest("[data-rack-op]");
    if (!key || !document.body.classList.contains("rack-edit")) return;
    const cells = rackLayout();
    const at = cells.findIndex((cell) => cell.id === key.dataset.rackCell);
    if (at < 0) return;
    const spec = rackRegistry().find((item) => item.id === cells[at].id);
    if (key.dataset.rackOp === "earlier" && at > 0) {
      [cells[at - 1], cells[at]] = [cells[at], cells[at - 1]];
    } else if (key.dataset.rackOp === "later" && at < cells.length - 1) {
      [cells[at + 1], cells[at]] = [cells[at], cells[at + 1]];
    } else if (key.dataset.rackOp === "size") {
      // Only the spans that produce an honest cell for THIS widget.
      const spans = spec.spans;
      cells[at].span = spans[(spans.indexOf(cells[at].span) + 1) % spans.length];
    } else if (key.dataset.rackOp === "eject") {
      cells[at].on = false;   // span and position are remembered, not lost
    } else {
      return;
    }
    rackSave(cells);
    rackAnnounce(cells, at);
  });
```

Exit: a fixed `DONE` chip (44px, bottom right, `z-index: calc(var(--z-nav) + 1)`) and one `Escape` check. Both call `applyRackLayout(true)` on the way out. A `Undo` chip beside it restores `rackUndo()` when it is non-null — one level, session scoped, covering eject.

**CHECK:** `npm test` green. Enter arrange mode, move a cell three positions with the keyboard alone, watch the live region announce each move and focus stay on the same button. Cycle a chart cell S→M→L and confirm the canvas repaints at each width, not at 900px. Eject a cell, press Undo, it comes back **at its original position with its original span**. Reload → the arrangement holds. At 375px the move keys read up/down and every control measures ≥44px.

---

## 3. THE PERSISTENCE SCHEMA, IN FULL

```
state.settings.dashboardLayout
  = null                                 // never customised
  | { v: 1, cells: Cell[] }              // customised

Cell = {
  id:   string   // registry id: hero risk prop quad playbook unjournalled stats
                 // edgeMini leon equity drawdown strategy traderScore
                 // psychology session rMultiple discipline edgeTable
  on:   boolean  // mounted in the rack, or waiting in the drawer
  span: number   // columns, validated against THAT widget's own spans set
}
```

- **Array order is display order.** There is no `order` field, so there is nothing that can drift out of step with the array.
- **`v: 1`** is the envelope. `normalizeSettings` writes `v: 1` on every read, so any future migration reads the incoming `v` and rewrites the array once. Nothing today branches on it.
- **Storage:** `axiom_journal_settings_v1` in localStorage (or sessionStorage under `demo:` for guests, via `journalStore()`/`journalKey()`, app.js:12279-12285). Cross-device via the existing 900ms debounced autosave (`saveToPhpStorage`, app.js:7319-7373) — settings is an opaque JSON blob to the API, so **there is no server change**.
- **Scope:** per journal, not per account. All sub-accounts share one desk, exactly like every other setting.
- **Deliberately NOT the device-local tier** (`EDGE_MINI_KEY` app.js:1102, `WALL_*` 1103-1106, `THEME_STORAGE_KEY` 173): a desk should follow the trader, not the machine.

### Migration path from "no saved layout"

There is no migration step, by construction. `rackLayout()` (§3.3) is the migration:

| incoming | result |
|---|---|
| `dashboardLayout` absent (every journal saved before this ships) | `null` → the code default: every `on:true` registry entry mounted at its default span, in registry order |
| `{v:1, cells:[...]}` complete | used verbatim, spans clamped to each widget's own `spans` set |
| `{v:1, cells:[]}` (trader ejected everything) | an empty rack, **preserved** — `Array.isArray`, not truthiness, is what makes present-and-empty survive |
| saved layout missing a registry id (a widget shipped after they saved) | appended `on:false` → it turns up in the drawer, never silently lost |
| saved layout naming an unknown id (a widget was retired) | dropped |
| saved span outside the widget's set | replaced with that widget's default |

`EDGE_MINI_KEY` is untouched: the edge desk's own collapse toggle keeps its device-local key, and mounting/unmounting the cell is a separate, orthogonal choice.

---

## 4. HAZARDS

**Measured chrome.** `syncChromeHeight` (app.js:15022) builds its bar list ONCE and observes those exact nodes. `.rail` must never match `.topnav`, `#sidebar`, `#demoBanner` or `.tabbar` — its bottom edge is the bottom of the window and every pinned view would be inset to ~100vh. The real failure without §1.1 is the opposite and quieter: `bottom === 0` → `removeProperty` → the 86px stylesheet fallback → an 86px dead band on every desktop page. Assert `--chrome-h === "0px"` in the browser after Phase 1. `--dock-h` / `--dock-clear-h` are measured off `.tabbar` and `.tabbar-fab` rects (app.js:15065-15084) — neither markup is touched by any phase here.

**Hardcoded `left: 0`.** Six sites listed in §1.5, found by `grep -n "position: *fixed"` across all three sheets. **Re-run that grep before shipping Phase 1** — one missed site slides content under the rail only at certain widths, which is the class of bug that reaches production.

**Sticky offsets.** `setupStickyDashTicker` (app.js:13214-13240) measures `#dashboard.getBoundingClientRect().top` and listens on **both** `window` and `#dashboard` — the rack introduces no new scroller, so nothing changes; if a later phase ever wraps the rack in its own `overflow` container, that listener pair must gain the new scroller or the docked ticker sticks forever. `.dash-ticker-dock` is `position:fixed; left:50%` of the **viewport** (styles.css:9314) and must re-centre on the content column (§1.5). `.dash-edge-mini` keeps `position:sticky; top:0` inside its own cell (§2.3) — the `0` is deliberate: sticky measures from the scroller's content box, which already carries the view's padding-top, and re-adding `--chrome-h` there double-counts (the story is written at styles.css:10176-10186).

**View switching.** `switchView` (app.js:1923) toggles `.is-active` on every `.view` and forces `renderCharts(…, {force:true})` for the playbook page because a canvas that had no layout width paints at its 900px attribute fallback. The rack has the same exposure on **mount, span change and edit-mode exit**; all three route through `applyRackLayout(true)`, which is the single place that can forget it. Never add a fourth path that writes `style.gridColumn` directly.

**11px and 44px.** `tests/mobileFloors.check.mjs` reads `styles.css` and `clay-v2.css` only (line 64) — everything written in `clay-v3.css` is currently unenforced. Phase 4 adds `clay-v3.css` to that array (verified green). The rail's 9px `.topnav-label` is legal because the rail is `display:none` below 1025px and `OFF_PHONE` (line 32) whitelists it **by exact selector string** — which is why §1.2 renames only the container class. Everything phone-visible (the drawer, the add slot, every arrange key) is ≥44px tall with ≥11px labels.

**Light theme.** `clay-v3.css` is the tested token ramp (`tests/clayV3Contrast.check.mjs` walks `:root`-level blocks only and requires every accent-derived token to be overridden in **both** theme blocks). `--rail-w` and `--radius-cell` are non-colour tokens at bare `:root` — no contrast obligation, no theme fork. Every colour in the rail, the add slot and the drawer must be an existing token (`--surface-2`, `--line`, `--line-strong`, `--text-soft`, `--accent`), never a literal, or light mode breaks silently and no test sees it.

**Copy.** `tests/copyDashes.check.mjs:31` bans a dash with a word on both sides, **entity forms included** (`&mdash;`, `&ndash;`). Every string in the drawer, the add slot, the hint and every `aria-label` must be written without them.

**TDZ.** `init()` is called at app.js:1138. `tests/bootOrder.check.mjs` fails on any new module-level `const`/`let`/`var` below that line. `DEFAULT_SETTINGS` (app.js:103) is safely above it. Everything else the rack adds is a **hoisted function declaration** (`rackRegistry`, `rackLayout`, `rackNode`, `applyRackLayout`, `rackSave`, `rackUndo`, `syncRackAddSlot`, `openRackDrawer`, `renderRackDrawer`, `rackDrawerRow`) or a property on an existing object (`state.dashboard`, `rackUndo.previous`). Zero new module bindings, at any position in the file. **This has shipped four times; do not be the fifth.**

**`display:contents`.** One guard rule (`#dashboard .dash-stats[hidden] > *`), because exactly one wrapper is renderer-toggled and no code measures any of the five. If a later change makes a renderer touch `.dash-deck`, `.dash-boards`, `.panel-grid-analytics` or `.panel-grid-bottom`, that wrapper needs the same guard or it needs to stop being dissolved.

**Live things.** `#dashEdgeMiniTv` hosts a stream iframe; `[data-live-field]` and `[data-ticker-price]` nodes are patched in place by the 5s poll; `ui.*` is collected once at boot (app.js:305-440). `applyRackLayout` writes `style.order`, `style.gridColumn` and one class and touches nothing else. Any future code that sets `innerHTML` on `#dashboard` or moves a `[data-w]` node in the DOM breaks all three at once.

**Renderer-owned `hidden`.** `#propTracker`, `#dashPlaybook`, `#dashUnjournalled`, `#dashEdgeMini`, `#dashLeonTape`, `#riskStrip` and `#dashboardMetricGrid` all have their `hidden` attribute written by a renderer inside `renderAll()`. The rack **never** writes `hidden`; it writes `.w-off`, and CSS combines the two. A mounted-but-empty widget still self-hides, which is the honesty rule surviving customisation.

---

## 5. WHAT THIS DOES NOT DO

- **No drag and drop.** Move is a pair of buttons. There is no drag physics, no long-press, no drop target, no library.
- **No height control.** Cells are content-height. The density pass makes them short; a user height knob is speculative.
- **No per-account layouts.** Settings are per journal; all sub-accounts share one desk. The `v` envelope leaves room, nothing implements it.
- **No presets.** No Prop/Scalp/Swing desk. The only data-driven touch is a `fits this account` tag on the prop row, which is an offer, never a switch.
- **No customisation of the config furniture.** `.dash-head`, `#accountsPanel`, `#riskPanel`, `#rulesPanel`, `#adminPanelsMount`, `#estimatedAnalyticsNotice` and `#dashboardEmptyState` have fixed orders and are not units.
- **No splitting the quad or the stat strip into 11 micro widgets.** The four edge metrics are one cell; the seven rail metrics are one cell.
- **No customisation outside the dashboard.** Journal, calendar, reflections, monthly and the Edge desk are untouched.
- **No mobile chrome change of any kind.** No breakpoint literal moves. The 899/900, 1024/1025 and 1239/1240 seams stay exactly where they are (the 1240 seam simply loses its only tenant). The sidebar rail, the drawer, the tabbar and the FAB are byte-identical after all five phases.
- **No server change.** `trade_handler.php` and the API see one more key inside an opaque settings blob.
- **No new storage key.** No new localStorage entry, no new `STORAGE_KEYS` member.
- **No fuzzy search, no command palette, no `GO TO` scope.** The drawer's filter is a plain case-insensitive substring match over label, description and keywords.
- **No multi-level undo.** One level, session scoped, lost on reload.
- **The density skin is not in scope here.** The rack contributes placement (order, span, presence) and zero cell styling. `--radius-cell` is the one shared token it lands, at `:root`, for the density pass to use.

---

**Files touched, all phases:** `/Users/macbookairm3/Documents/Trader-Journal/index.html`, `/Users/macbookairm3/Documents/Trader-Journal/app.js`, `/Users/macbookairm3/Documents/Trader-Journal/styles.css`, `/Users/macbookairm3/Documents/Trader-Journal/clay-v2.css`, `/Users/macbookairm3/Documents/Trader-Journal/clay-v3.css`, `/Users/macbookairm3/Documents/Trader-Journal/tests/mobileFloors.check.mjs`, and one new `/Users/macbookairm3/Documents/Trader-Journal/tests/rackLayout.check.mjs`.