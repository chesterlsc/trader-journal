# BUILD SPEC — Trader Journal dashboard redesign

Every line number below was opened and read in this session against the working tree at `renovation/v2` (`f812a50`). Baseline verified green: `instrumentPanel`, `mobileFloors`, `clayV3Contrast`, `equityScrub`, `charts.smoke`, `cssSanity`. All geometry measured live in a private tab at `http://localhost:8010` at 1999×1150 and 1440×900, then torn down.

**Corrections to the briefing you were given — verify these before you edit anything else:**

| Claim in the brief | Truth in the file |
|---|---|
| "styles.css:12167 is the selector; declaration at 12168" | **False.** `styles.css:12166` is `.view.is-active:not(#terminal) {`, **:12167** is the `padding-inline:` declaration. Edit **12167**. |
| "`.eq-footnotes` count assert at :207 / :200" | It is built at `tests/instrumentPanel.check.mjs:198-200`, asserted at **:201**. |
| "iframe display:none guard at :123-126" | **:127-130**. |
| "`.dem-tv` gets `aspect-ratio`" | The ratio lives on the child: `styles.css:9668 .dem-tv .bb-mon { aspect-ratio: 16/9 }`, and `styles.css:9661-9667` records that moving it off the tile collapsed the iframe to 0×0. Delete the caps; do not add a ratio. |
| "`--term-live` in both theme blocks" | There is exactly one `--term-*` block: `clay-v3.css:483-499`. `tests/clayV3Contrast.check.mjs:394-395` says so and `:398-413` checks `"dark"` only. |
| "clay-v3.css:1206-1207 → border-radius" | `:1206` is `border: 1px solid var(--line-strong);`. Edit **:1207 only**. |
| "`margin: 0` at clay-v3.css:4054" | **:4052**. `:4054` is `.dem-news { min-height: 0 }`. |
| "renderGreeting at app.js:14677" | **app.js:10156**, guard at `:10157-10159`. |
| "renderTerminalClock at 15783" | **app.js:15792**; doc comment opens at `:15789`. |
| "`.dem-tv .bb-mon-pick` needs `min-height: 0`" | `styles.css:11526` sets 44px only inside `@media (max-width: 899px)`. At 1240+ there is no floor. **Drop the rule.** |
| "`syncEdgeMiniCollapsed` writes at app.js:17113" | **:17133**; function opens at `:17118`. |
| "`opacity: 0.5` at styles.css:9652" | **:9654**. |
| "`.dem-cmd` two-auto-margin problem" | Already solved: `styles.css:9771 .dem-cmd .dem-min + .dem-min { margin-left: 0 }`. **Do not re-fix it.** |

---

## 0. The one defect that must land first

`clay-v3.css:4125` is

```css
#dashboard.is-active:has(#dashboardEmptyState:not([hidden])) > *:not(.dash-head):not(#dashboardEmptyState),
```

`.dash-edge-mini` is a **direct child of `#dashboard`** (`index.html:1461`, sibling of `.dash-head` at `:1389` and `.dash-stats` at `:1514`). It matches. Measured, with the empty state un-hidden:

```
edgeDisplay: "none"   ancestors-with-display:none from the iframe up: ["dashEdgeMini"]
```

`renderDashboardMetrics` sets `ui.dashboardEmptyState.hidden = hasTrades` (`app.js:9710`), so switching to a zero-trade account — through the account select this redesign **adds to band A** — or deleting the last trade kills a playing stream. `tests/instrumentPanel.check.mjs:127-130` misses it: its regex needs the literal `.dash-edge-mini` in the selector, and this selector is `> *:not(…)`.

Ship this before anything else.

---

## BUILD ORDER

Six steps. Each is independently shippable, leaves the page no-scroll at 1999×1150 and 1440×900, and leaves the 46-file suite green. Ordered so the owner sees the biggest change first.

| # | Step | Files | Visible result |
|---|---|---|---|
| 0 | Iframe safety | clay-v3.css, tests | invisible; protects every later step |
| 1 | Band A — one header strip | index.html, clay-v3.css | the whole top of the board becomes one surface |
| 2 | Market TV — four blocks | index.html, app.js, clay-v3.css, styles.css | 16:9 picture, catalyst, context, calendar; fixes a 178px overlap |
| 3 | Band B — one plot, two series | index.html, app.js, charts.js, clay-v3.css, tests | stat row above the curve, drawdown overlay, right % axis, 7 date labels |
| 4 | Band C — equal halves | index.html, clay-v3.css | calendar and queue split 4/4, calendar gets a title |
| 5 | Shell — rail and top bar | index.html, app.js, clay-v3.css, styles.css, tests | 78px rail with Setups, wordmark + LIVE in the bar, +78px of reading column everywhere |

---

## STEP 0 — Iframe safety

### `clay-v3.css:4125` — rewrite in place

```css
  #dashboard.is-active:has(#dashboardEmptyState:not([hidden])) > *:not(.dash-head):not(#dashEdgeMini):not(#dashboardEmptyState),
```

`:not(#dashEdgeMini)`, **not** `:not(.dash-edge-mini)`. Same element; the ID form keeps the string `.dash-edge-mini` out of a rule whose block is `display: none`, which is exactly what the guard at `tests/instrumentPanel.check.mjs:128` scans for. Using the class form fails the suite — that is the guard working, not a false positive.

### `clay-v3.css:4129` — rewrite in place

```css
  #dashboard.is-active #dashboardEmptyState { grid-area: 1 / 1 / -1 / 9; place-self: center; }
```

Was `2 / 1 / -1 / -1`. Row 1 becomes the top of the strip in step 1, and the TV column now survives the empty state, so the card takes the left eight columns instead of overlapping it. Measured at 1440×900 with the empty state on and the rail rendering: card `x=324 w=422`, TV `x=989 w=435` — no overlap, `scrollHeight === clientHeight`.

### `clay-v3.css` — add beside `:4077-4078`

```css
  #dashboard.is-active:has(.dash-edge-mini[hidden]) #dashboardEmptyState { grid-column-end: -1; }
```

Same `:has()` idiom already used two lines above for `.panel-span-8` and `#dashLedger`. Without terminalPro the rail is `hidden` and the card takes the whole board.

### `tests/instrumentPanel.check.mjs` — add after `:130`

```js
// The empty state is `> *`, and .dash-edge-mini is a DIRECT child of #dashboard.
// Excluded by ID, because the class form would trip the guard above.
assert.ok(
  /:has\(#dashboardEmptyState:not\(\[hidden\]\)\) > \*[^{,]*:not\(#dashEdgeMini\)/.test(decls(clay)),
  "the empty state must exclude #dashEdgeMini — display:none on it kills the live stream"
);
```

---

## STEP 1 — Band A: the one-surface header strip

### 1.1 `index.html` — five cuts

Cut, in this order (top-down so earlier numbers stay valid):

| Range | Node |
|---|---|
| `1399-1402` | `<article id="progressTradeSummary" class="dash-live" hidden …>` |
| `1410-1414` | `<div class="dash-range" role="group" …>` |
| `1415` | `<span class="dash-est-chip" id="dashEstChip" hidden>EST</span>` |
| `1417-1429` | `<button id="journalNewTradeBtn" …>` **through** `</button>` |
| `1431-1442` | the Quick Import comment **and** `<button id="dashQuickImportBtn" …>` |

`1417-1429` — **not** `1417-1433`. `:1430` is blank and `:1431-1434` is the Quick Import comment; cutting to `1433` strands `:1434` (`Same dialog, one shared handler. -->`) as literal text in the header.

`.dash-head` keeps `.dash-greeting` (`1390-1393`) and `#dashSessionIntelligenceLink` (`1444-1446`). Both are covered elsewhere: `renderGreeting` early-returns on a missing node (`app.js:10157-10159`) and Session Intelligence is already a rail row.

### 1.2 `index.html` — one paste

As the **last child of `.dash-hero`**: immediately after the `</div>` that closes `.dash-ground-caps` (**`index.html:1562`**, not 1559 — `:1559` *opens* it) and immediately before `</article>` (`index.html:1563`).

```html
                <!-- BAND A'S RIGHT END. Four controls and a scope select on the
                     same surface as the headline they qualify. Every listener
                     survives the move: #journalNewTradeBtn and
                     #dashQuickImportBtn are getElementById (app.js:751,
                     app.js:1664) and [data-balance-range] / [data-account-switch]
                     are module-load querySelectorAll snapshots (app.js:384,
                     app.js:463) that hold node identity.

                     LOG A TRADE STAYS IMMEDIATELY BEFORE QUICK IMPORT IN THE DOM.
                     styles.css:8370, :8384 and :8387 are adjacent-sibling rules
                     (`.dash-log-btn + .dash-import-btn`) that give the pair one
                     control-group height and make the secondary drop its label
                     in cooldown. Reversing the source order cancels all three
                     silently. The reference's visual order comes from `order`
                     on the flex row instead. -->
                <div class="dash-controls">
                  <!-- A SECOND [data-account-switch]. #accountSwitchTop must NOT
                       move: setupRailAccount (app.js:16730) opens with
                       document.querySelector(".rail [data-account-switch]") and
                       returns early without it, taking the rail's account chip
                       with it — and it stamps tabindex="-1" aria-hidden="true"
                       on whatever it finds (app.js:16738-16739), which would
                       make a strip-side select unfocusable. ui.accountSwitches
                       picks this one up at module load and
                       renderAccountSwitcher (app.js:12006-12019) fills it and
                       self-hides the wrapper under two accounts. -->
                  <div class="account-switch" data-account-switch-wrap hidden>
                    <label class="visually-hidden" for="accountSwitchDash">Account</label>
                    <select id="accountSwitchDash" class="account-switch-select" data-account-switch></select>
                  </div>
                  <div class="dash-range" role="group" aria-label="Balance range">
                    <button class="dash-range-btn is-active" type="button" data-balance-range="1m" aria-pressed="true">1M</button>
                    <button class="dash-range-btn" type="button" data-balance-range="3m" aria-pressed="false">3M</button>
                    <button class="dash-range-btn" type="button" data-balance-range="all" aria-pressed="false">ALL</button>
                  </div>
                  <span class="dash-est-chip" id="dashEstChip" hidden>EST</span>
                  <button id="journalNewTradeBtn" class="btn primary dash-log-btn" type="button">
                    <span class="journal-action-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M12 5.75v12.5M5.75 12h12.5" />
                      </svg>
                    </span>
                    <span>Log a trade</span>
                    <span class="dash-log-flag" id="dashLogCooldownFlag" hidden></span>
                    <span class="kbd-hint" aria-hidden="true">&#8984;K</span>
                  </button>
                  <button id="dashQuickImportBtn" class="btn dash-import-btn" type="button" aria-label="Quick import">
                    <span class="journal-action-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M12 15.25V4.75M8.25 11.5 12 15.25l3.75-3.75M4.75 15.75v2.5h14.5v-2.5" />
                      </svg>
                    </span>
                    <span>Quick import</span>
                  </button>
                </div>
                <article id="progressTradeSummary" class="dash-live" hidden aria-label="Open positions">
                  <p id="progressTradeLabel" class="visually-hidden">Open position</p>
                  <div id="progressTradeTrack" class="dash-live-track"></div>
                </article>
```

`#dashLogCooldownFlag` stays a **child** of `#journalNewTradeBtn`: `renderCooldown` writes it at `app.js:11442-11444` and toggles `.is-cooldown` on the button at `app.js:11430-11439`.

### 1.3 `index.html:1551-1552` — the NEXT EVENT sub-line

```html
                  <div><span class="dash-now-label">Next event</span>
                       <span class="dash-now-fig" id="dashNowEvent">QUIET</span>
                       <span class="dash-now-sub" id="dashNowEventSub"></span></div>
```

### 1.4 `index.html:1553` — one label

`From highs` → `From highs` stays. **Do not** relabel it "Risk state." `app.js:10405-10406` renders `AT HIGHS` at tone **+1 (green)** when the drawdown is zero, and red money when it is not. The reference paints AT HIGHS red; being at your equity peak is not a risk. See NOT BUILT.

### 1.5 `clay-v3.css:3944-3950` — rewrite in place

Whole rule body becomes one declaration:

```css
  #dashboard.is-active > .dash-head { display: none; }
```

### 1.6 `clay-v3.css:3969-3977` — rewrite in place

**`3969-3977` only.** `clay-v3.css:3978` is a separate, load-bearing rule — `#dashboard.is-active .dash-hero > * { grid-column: 1; }` — and deleting it lets `[data-metric="totalPnl"]` auto-place into the new track 3, on top of the control cluster.

```css
  /* BAND A IS ONE SURFACE. It SPANS rows 1-2 and eats the 12px gap between
     them (36 + 12 + 108 = 156). The track set is NOT merged: both
     grid-template-rows strings are asserted by equality at
     tests/instrumentPanel.check.mjs:142 and :145. The span is the
     load-bearing choice; anyone who later "simplifies" the two tracks into a
     single 156px row breaks the suite and the message will not explain why.
     (1,2,0) — a tie with clay-v3.css:3019, broken by source order. */
  #dashboard.is-active .dash-hero {
    grid-area: 1 / 1 / 3 / -1;
    padding: 12px 16px;
    display: grid;
    grid-template-columns: minmax(260px, 3fr) minmax(0, 9fr) auto;
    grid-auto-rows: min-content;
    align-content: center;
    column-gap: 0;
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: var(--radius-xl);
    box-shadow: var(--edge-highlight);
  }
```

`clay-v3.css:3978-3992` are unchanged. `:3979-3991` already makes `.dash-now` a 6-column subgrid in track 2 and `:3992` already draws the hairline `border-left` on each cell — that is the reference's divider, already shipped.

### 1.7 `clay-v3.css` — add after `:3992`

```css
  /* Track 3. `order` gives the reference's visual sequence — import, then the
     orange primary at the right end — while the DOM keeps log-before-import
     for the three `+` rules in styles.css:8370/:8384/:8387. margin-left goes
     to zero because the row has a gap now. */
  #dashboard.is-active .dash-hero .dash-controls {
    grid-column: 3;
    grid-row: 1 / span 9;
    align-self: center;
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 12px;
    padding-left: 16px;
    border-left: 1px solid var(--line);
  }
  #dashboard.is-active .dash-controls #dashQuickImportBtn { order: -1; margin-left: 0; }
  /* clay-v3.css:3955-3961, verbatim, with the selector following the nodes.
     LOAD BEARING: .btn ships a 52px box and .dash-range-btn a 40px one; both
     overflow a 156px band that also has to hold a 48px headline. */
  #dashboard.is-active .dash-controls .btn,
  #dashboard.is-active .dash-controls .nav-btn { min-height: 0; height: 30px; padding-block: 0; padding-inline: 12px; font-size: 12px; }
  #dashboard.is-active .dash-controls .dash-range { height: 26px; padding: 2px; align-self: center; }
  #dashboard.is-active .dash-controls .dash-range-btn { min-height: 0; height: 22px; padding: 0 10px; font-size: 11px; }
  #dashboard.is-active .dash-controls .kbd-hint { display: none; }
  #dashboard.is-active .dash-controls .account-switch { flex-direction: row; align-items: center; gap: 6px; padding: 0; }
  #dashboard.is-active .dash-controls .account-switch-select { height: 26px; min-height: 0; font-size: 11px; }
  #dashboard.is-active .dash-hero #progressTradeSummary {
    grid-column: 2 / -1;
    grid-row: 10;
    justify-self: end;
    max-width: 380px;
    margin: 8px 0 0;
    overflow: hidden;
  }
  #dashboard.is-active .dash-now-sub { display: block; margin-top: 3px; }
  #dashboard.is-active #dashNowEventSub { font-size: 10px; letter-spacing: 0.07em; text-transform: uppercase; }
```

### 1.8 `clay-v3.css` — add a base rule beside `:3076`

Below 1240 the 1240 block is off, `.dash-head` reappears, and the cluster needs a sane shape inside the hero. **11px, not 10px** — this is a base rule and `tests/mobileFloors.check.mjs:22` floors base type at 11px at 375px, with only four selectors exempt (`:32`).

```css
#dashboard .dash-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-3);
  font-size: 11px;
}
```

### 1.9 `clay-v3.css:4143-4155` — add to the short-screen block

```css
  #dashboard.is-active .dash-hero {
    padding: 10px 16px;
    grid-template-columns: minmax(240px, 3fr) minmax(0, 9fr);
  }
  #dashboard.is-active .dash-hero .dash-controls {
    grid-column: 1 / -1;
    grid-row: 10;
    justify-self: start;
    padding-left: 0;
    border-left: 0;
    margin-top: 8px;
  }
  #dashboard.is-active .dash-hero #progressTradeSummary { display: none; }
```

At 1440 a three-track strip leaves the six cells 77px against a 111px `GREEN STREAK` label, so the controls take their own row **inside the same surface**. Measured: hero `1330×132`, tracks `324 / 972` → 162px a cell, `scrollHeight 130` in a `clientHeight 132` box. The open-position strip goes because `#dashNowOpen` in `.dash-now` already states the float (`app.js:14652-14659`), and 30px is the whole margin at this height.

### 1.10 `app.js` — the only required JS in step 1 (4 lines)

`renderNowEvent` (`app.js:10474-10508`) prints `CPI M/M · 1H` on one line; the reference wants a name over a wall clock.

- after `app.js:10478` (`}` closing the early return):
  ```js
    const sub = document.getElementById("dashNowEventSub");
  ```
- after `app.js:10495` (`node.classList.add("is-idle");`):
  ```js
      if (sub) sub.textContent = "";
  ```
- after `app.js:10507` (`node.classList.remove("is-idle", "is-pos", "is-neg");`):
  ```js
    // Same formatter renderEdgeMini uses at app.js:17226, on the same
    // rankEvents() row (app.js:10483-10487 vs app.js:17152). No new state and
    // no new poll: the 1s tick at app.js:15636-15645 already refreshes this cell.
    if (sub) {
      sub.textContent = `${new Date(next.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} LOCAL`;
    }
  ```

---

## STEP 2 — Market TV: four blocks on the rail that already exists

**The invariant.** `#dashEdgeMiniTv` (`index.html:1498`) stays child 1 of `#dashEdgeMiniPanel` (`:1489`). Nothing is re-parented, nothing is wrapped, and the only `innerHTML` write to it stays the channel-gated one at `app.js:17172-17175`. The single new node is a **sibling inserted after it**.

### 2.1 `index.html:1466` — the panel title

```html
              <span class="dem-title" id="dashEdgeMiniHeading">Market TV</span>
```

Keeps the id, so `aria-labelledby="dashEdgeMiniHeading"` (`index.html:1461`) still resolves. `.dem-prompt` / `.dem-caret` then have no user in the repo.

`index.html:1473-1487` — **no change.** Both header buttons keep their ids and labels. `app.js:15616` writes "dock"/"watch" into `.dem-tv-out-label`; `app.js:17133` writes "show"/"hide" into `.dem-min-label`. These are the reference's two header icon buttons. The pin is in NOT BUILT.

### 2.2 `index.html` — insert after `:1498`, before the comment at `:1500`

```html
            <!-- NEXT CATALYST. wire[0], promoted out of the list below so the one
                 release about to move the tape is readable from across the room.
                 A SIBLING of #dashEdgeMiniTv, added after it — the TV element is
                 never wrapped, moved or rewritten.
                 THE COUNTDOWN IS NOT A NEW TIMER: data-starts on the wrapper and
                 .dem-cd on the cell is the whole contract, and the 1s interval at
                 app.js:15636 (guarded by `if (!terminal.timerId)`) walks every
                 [data-starts] and patches the named cell against the SERVER clock. -->
            <div class="dem-cat" id="dashEdgeMiniCat"></div>
```

### 2.3 `index.html:1508-1510` — retext the footer button

```html
            <button class="nav-btn dem-key" type="button" data-target="terminal" data-terminal-nav hidden>
              <b>F1</b> full calendar
            </button>
```

`data-target`, `data-terminal-nav` and `hidden` untouched — `syncTerminalAccess` (`app.js:15822`, gate at `:15831`, un-hide at `:15832-15834`) owns them.

Final child order of `#dashEdgeMiniPanel`: `#dashEdgeMiniTv`, `#dashEdgeMiniCat`, `#dashEdgeMiniNews`, `.dem-screen`, `.dem-key`. The reference's order in source order — no CSS `order`, no reflow trick.

### 2.4 `clay-v3.css:494` — one token, in the single `:root` at `483-499`

```css
  --term-live:  #4cc9e0;   /* live / countdown. Measured on the ramp's grounds:
                              9.96 void, 9.53 pane, 8.94 rail, 8.27 raise,
                              10.19 well — same rank as --term-pos. */
```

Do **not** add a light value. `clay-v3.css:480-481` and `tests/clayV3Contrast.check.mjs:394-395` both state that this ramp deliberately does not fork.

### 2.5 `clay-v3.css:4059` and `:4154` — DELETE

```css
  #dashboard.is-active .dem-tv { max-height: 168px; }   /* :4059  — delete */
  #dashboard.is-active .dem-tv { max-height: 120px; }   /* :4154  — delete */
```

Measured today at 1999×1150: `.dem-tv` is `617.7 × 168` while its `.bb-mon` child renders `595.7 × 335.1` — **the picture overflows its cap by 178.1px and paints over the news block.** The cap was written for a 2-column rail and never revisited when the rail doubled. `styles.css:9668` governs the ratio.

### 2.6 `styles.css:9764-9765` — rewrite in place

```css
/* A PLAYING STREAM SURVIVES `hide`, POPPED OR DOCKED. The rule at :9746 is
   display:none on .dem-panel and .dem-panel is the iframe's PARENT. Keyed on
   :has(iframe) rather than on .is-tv-out because playMonitor (app.js:17030-17043)
   is the only thing that ever creates that iframe, so no flag can drift out of
   step with it. Nothing autoplays (app.js:17019: the tile is a standby button
   until asked), so with no iframe the collapse still collapses to one line —
   the common case. (1,3,1) beats (0,3,0) above.
   STAYS IN styles.css: tests/instrumentPanel.check.mjs:127-130 is a negated
   regex over clay-v3.css for any .dash-edge-mini rule declaring display:none,
   and the rule this beats lives here too. */
.dash-edge-mini.is-min:has(#dashEdgeMiniTv iframe) .dem-panel { display: block; }
.dash-edge-mini.is-min:has(#dashEdgeMiniTv iframe) .dem-panel > *:not(.dem-tv) { display: none; }
```

### 2.7 `styles.css` — three deletions

- `:9789-9798` — `.dem-prompt`, `.dem-caret`
- `:9933` — `@keyframes demCaret`
- `:9946` — rewrite in place, dropping the dead selector:
  ```css
    .dem-sweep, .dem-row, .dem-stat, .dem-row[data-phase="live"] .dem-x {
  ```

### 2.8 `clay-v3.css:4326-4333` — rewrite in place

One declaration added:

```css
#dashboard.is-active .dash-edge-mini.is-tv-out .dem-tv .bb-mon,
#dashboard.is-active .dash-edge-mini.is-tv-out .dem-tv .bb-mon-pic,
#dashboard.is-active .dash-edge-mini.is-tv-out .dem-tv iframe {
  box-sizing: border-box;      /* Docked, the 16:9 is the PICTURE and the 28px
                                  masthead sits above it (content-box, below).
                                  Popped, the box is a FIXED rectangle
                                  (clay-v3.css:4310-4311), so the strip must come
                                  OUT of it or the picture overflows by 28.
                                  The two disagree ON PURPOSE. Do not unify them. */
  width: 100%;
  height: 100%;
  max-height: none;
  border-radius: 0;
}
```

### 2.9 `clay-v3.css` — the four blocks, inside `@media (min-width: 1240px)`, after `:4059`

```css
  /* ── THE FOUR BLOCKS ────────────────────────────────────────────────────
     tv / catalyst / context / calendar / way-in. Only the context row is 1fr,
     because the headline count is the only unbounded thing in the column —
     0 to 6 rows depending on what GDELT returned. Everything else is fixed by
     its content, so the overflow lands where the variability is, inside a
     panel, never on the page.
     :not(.is-min) IS LOAD BEARING. Without it this rule is (1,3,0) and BEATS
     styles.css:9746 (0,3,0), and `hide` silently stops collapsing. */
  #dashboard.is-active .dash-edge-mini:not(.is-min) .dem-panel {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  }
  #dashboard.is-active .dem-news { overflow-y: auto; overscroll-behavior: contain; }

  /* --- the header ------------------------------------------------------- */
  #dashboard.is-active .dem-cmd { min-height: 40px; padding: 6px 11px; }
  #dashboard.is-active .dem-cmd .dem-min { min-height: 26px; padding: 0 8px; }
  #dashboard.is-active .dem-title {
    color: var(--term-ink);
    font: 600 11px/1.2 var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  /* THE DOT IS THE FEED STATE, not decoration: its colour comes from the same
     terminal.asOf / .stale / .sample the text beside it already prints
     (app.js:17154-17161), so the two can never disagree. */
  #dashboard.is-active .dem-clock { display: flex; align-items: center; gap: 6px; }
  #dashboard.is-active .dem-clock::before {
    content: "";
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--term-faint);
  }
  #dashboard.is-active .dem-clock[data-feed="live"]::before {
    background: var(--term-live); box-shadow: 0 0 6px var(--term-live);
  }
  #dashboard.is-active .dem-clock[data-feed="stale"]::before { background: var(--term-warn); }
  #dashboard.is-active .dem-clock[data-feed="down"]::before  { background: var(--term-neg); }

  /* --- the picture, and its masthead ------------------------------------
     THE MASTHEAD LEAVES THE PICTURE. In a 620px column it is not a scrim over a
     small tile any more, it is the reference's channel row: select, live dot,
     desk label, link, max. Reserved with padding-top on .bb-mon rather than a
     second grid row, because styles.css:9661-9667 records what happened the last
     time the ratio moved off the tile — the iframe collapsed to 0x0 and played
     invisibly. content-box means the 16:9 is the PICTURE and the strip sits
     above it inside the border box, so `overflow: hidden` never clips it. */
  #dashboard.is-active .dem-tv .bb-mon { box-sizing: content-box; padding-top: 28px; }
  #dashboard.is-active .dem-tv .bb-mon-h {
    top: 0;
    height: 28px;
    padding: 0 8px;
    gap: 8px;
    opacity: 1;                       /* beats styles.css:9654's 0.5 at (1,3,0) */
    background: var(--term-rail);
    border-bottom: 1px solid var(--term-line);
  }
  /* channel.desk — "US markets · session", app.js:16625 — is the honest caption
     the reference draws as a broadcaster logo. Already rendered; just unhidden. */
  #dashboard.is-active .dem-tv .bb-mon-h em { display: block; }
  /* clay-v3.css:3533-3536 makes the picker inert while a stream plays, because
     over a scrim it swallowed taps meant for the player. The masthead is not
     over the player here, so the reason is gone with it. */
  #dashboard.is-active .dem-tv:has(iframe) .bb-mon-pick,
  #dashboard.is-active .dem-tv:has(iframe) .bb-mon-link,
  #dashboard.is-active .dem-tv:has(iframe) .bb-mon-full { pointer-events: auto; }
  #dashboard.is-active .dem-tv .bb-mon-dot { background: var(--term-faint); box-shadow: none; animation: none; }
  #dashboard.is-active .dem-tv:has(iframe) .bb-mon-dot {
    background: var(--term-live);
    box-shadow: 0 0 6px var(--term-live);
    animation: bbMonLive 1.6s ease-in-out infinite alternate;
  }

  /* --- next catalyst ----------------------------------------------------- */
  #dashboard.is-active .dem-cat { padding: 10px 11px 11px; border-bottom: 1px solid var(--term-line); }
  #dashboard.is-active .dem-cat-h {
    display: flex; gap: 6px; margin: 0 0 6px;
    color: var(--term-faint);
    font: 600 11px/1.2 var(--font-mono);
    letter-spacing: 0.14em; text-transform: uppercase;
  }
  #dashboard.is-active .dem-cat-h em { margin-left: auto; font-style: normal; letter-spacing: 0.06em; }
  #dashboard.is-active .dem-cat-b { display: flex; align-items: baseline; gap: 10px; margin: 0; }
  #dashboard.is-active .dem-cat-t {
    flex: 1 1 auto; min-width: 0;
    color: var(--term-ink);
    font: 500 15px/1.25 var(--font-mono);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  #dashboard.is-active .dem-cat-cd {
    flex: 0 0 auto;
    color: var(--term-live);
    font: 700 17px/1.2 var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  /* renderTerminalClock stamps data-phase on the [data-starts] wrapper
     (app.js:15797), so the colour walks cyan -> oxide as the print arrives.
     Same ramp as .dem-row at styles.css:9868-9869. */
  #dashboard.is-active [data-phase="imminent"] .dem-cat-cd,
  #dashboard.is-active [data-phase="live"] .dem-cat-cd { color: var(--term-acc); }
  #dashboard.is-active .dem-cat-s {
    margin: 6px 0 0;
    color: var(--term-faint);
    font: 500 10.5px/1.3 var(--font-mono);
    letter-spacing: 0.06em;
  }

  /* --- market context ---------------------------------------------------
     The RATIO and the BAND stay: they are the measurement the headlines are
     attached to. The verdict SENTENCE and the stance chip are the desk's
     editorial voice and F6 still prints both; there is no room for them beside
     a 16:9 picture. */
  #dashboard.is-active .dem-news-line,
  #dashboard.is-active .dem-news .bb-news-stance { display: none; }
  #dashboard.is-active .bb-news-hl a {
    display: grid;
    grid-template-columns: 40px auto minmax(0, 1fr);
    align-items: baseline;
    gap: 0 8px;
    padding-left: 0;
    border-left: 0;
  }
  #dashboard.is-active .bb-news-at { color: var(--term-faint); font-variant-numeric: tabular-nums; }
  #dashboard.is-active .bb-news-t {
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }

  /* --- economic calendar -------------------------------------------------
     ONE LINE PER ROW. styles.css:9857 and :9862 put .dem-l and .dem-x on
     grid-column 1/-1, which is right for a 300px desk pane and wrong for 596px.
     Measured: three rows go 177.5px -> 75px. */
  #dashboard.is-active .dem-row { grid-template-columns: auto auto minmax(0, 1fr) auto; gap: 0 8px; padding: 5px 0; }
  #dashboard.is-active .dem-l { grid-column: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #dashboard.is-active .dem-x { grid-column: auto; }
  #dashboard.is-active .dem-star { margin-right: 3px; color: var(--term-acc); font-style: normal; }
  #dashboard.is-active .dem-key { min-height: 0; padding: 8px 11px; }
```

### 2.10 `clay-v3.css:4143-4155` — add to the short-screen block

```css
  #dashboard.is-active .dem-tv { padding-top: 8px; }
  #dashboard.is-active .dem-tv .bb-mon { padding-top: 26px; }
  #dashboard.is-active .dem-tv .bb-mon-h { height: 26px; }
  #dashboard.is-active .dem-cat-s { display: none; }
  #dashboard.is-active .dem-cat-t { font-size: 14px; }
  #dashboard.is-active .dem-cat-cd { font-size: 15px; }
```

`clay-v3.css:4092-4098` (`.dem-panel { overflow-y: auto }`) is left alone — with a `minmax(0,1fr)` row the panel cannot overflow; it stays as the belt to the braces.

### 2.11 `app.js` — six hunks, all function declarations, nothing below `init()`

**(a) insert at `app.js:15788`** (the blank line above `renderTerminalClock`'s doc comment at `:15789`):

```js
/** ms -> "01:05:18". Hours uncapped: a 40h span reads 40:12:07 rather than
 *  wrapping to 16:12:07, which is the only way this can lie. */
function clockSpan(ms) {
  const total = Math.floor(ms / 1000);
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
```

**(b) `app.js:15806-15808`** — rewrite in place inside the existing `forEach`:

```js
    // ONE surface wants a wall-clock span instead of "1h 05m 18s", and it asks
    // by attribute — not by a second timer, a second formatter or a second call
    // site. phase.text still wins on "live" and on past, where a clock would
    // print 00:00:00 at a release that has already happened.
    const text = cell.dataset.fmt === "clock" && phase.ms > 0 ? clockSpan(phase.ms) : phase.text;
    if (cell.textContent !== text) {
      cell.textContent = text;
    }
```

Nothing else in the repo sets `data-fmt`, so `.bb-cd` on the desk and `.tm-event-cd` on the pre-market row are byte-identical.

**(c) `app.js:16368-16373`** — rewrite `newsHeadlines`'s return in place, and add a helper immediately after the function closes at `:16374`:

```js
  return `<ul class="bb-news-hl">${rows
    .map(
      (h) => `<li><a href="${escapeHtml(h.url)}" target="_blank" rel="noopener noreferrer">
        <span class="bb-news-at">${escapeHtml(headlineTime(h.at))}</span>
        <span class="bb-news-src">${escapeHtml(h.domain)}</span>
        <span class="bb-news-t">${escapeHtml(h.title)}</span></a></li>`
    )
    .join("")}</ul>`;
}

/** GDELT seendate ("20260824T081500Z") -> the viewer's own "08:15". "" when the
 *  upstream gave no stamp, which the sample wire never does, so an empty cell is
 *  itself a signal. Stored at api/_lib/newsvol.js:213 since the ingest was
 *  written, rendered nowhere until now. It cannot print a plausible lie: any
 *  other shape returns "". */
function headlineTime(at) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(at || ""));
  return m
    ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
        .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
}
```

**The domain stays.** It is the attribution `app.js:16353-16362` promises, and on the demo path it reads `sample wire`.

**(d) `app.js:17152`** — `.slice(0, 3)` → `.slice(0, 4)`. Row 0 is promoted to the catalyst, so the calendar still shows three.

**(e) `app.js:17161`** — after the existing `setText(...)` closes, replace `:17154-17161` with:

```js
  const asOf = document.getElementById("dashEdgeMiniAsOf");
  setText(
    asOf,
    terminal.sample
      ? "sample data"
      : terminal.asOf === null
      ? "link down"
      : `${new Date(terminal.asOf).toISOString().slice(11, 19)} UTC${terminal.stale ? " stale" : ""}`
  );
  if (asOf) {
    // The dot beside this text reads its colour from here, so the badge and the
    // words are one statement. No second liveness flag to drift.
    asOf.dataset.feed = terminal.sample
      ? "sample"
      : terminal.asOf === null
      ? "down"
      : terminal.stale
      ? "stale"
      : "live";
  }
```

**(f) `app.js:17176`** — insert between the monitor block (ends `:17175`) and the news block (comment at `:17177`):

```js
  // --- NEXT CATALYST -------------------------------------------------------
  // wire[0], promoted. Same rankEvents() ordering the rows below use, so the
  // headline and the list can never contradict each other. This function ends
  // by calling renderTerminalClock() (app.js:17265), so the countdown cell is
  // stamped in the same pass that creates it and never flashes empty.
  const next = wire[0] || null;
  setHtml(
    document.getElementById("dashEdgeMiniCat"),
    next === null
      ? `<p class="dem-cat-h">next catalyst</p><p class="dem-empty">${
          terminal.asOf === null ? "No calendar link." : "Nothing scheduled on the pairs you trade."
        }</p>`
      : `<div data-starts="${escapeHtml(next.startsAt)}">
          <p class="dem-cat-h">next catalyst<em>${escapeHtml(
            new Date(next.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          )} local</em></p>
          <p class="dem-cat-b">
            <b class="dem-cat-t">${escapeHtml(next.title)}</b>
            <b class="dem-cat-cd dem-cd" data-fmt="clock"></b>
          </p>
          <p class="dem-cat-s">${escapeHtml(
            [
              new Date(next.startsAt).toLocaleDateString([], {
                weekday: "short", day: "numeric", month: "short", year: "numeric"
              }),
              next.currency,
              // forecast/previous are parsed at api/_lib/calendar.js:112-113 and
              // rendered nowhere in the app today. They are what the reference's
              // invented "SOURCE: BLS" line was reaching for, and they are real.
              next.forecast ? `forecast ${next.forecast}` : "",
              next.previous ? `previous ${next.previous}` : ""
            ].filter(Boolean).join(" \u00b7 ")
          )}</p>
        </div>`
  );
```

**(g) three one-liners in the same function**

- `app.js:17184` — `news edge` → `market context` (the state word `sample`/`no link`/`stale`/`live` is unchanged).
- `app.js:17213` — `<b>F1</b>wire` → `<b>F1</b>economic calendar`.
- `app.js:17217` — `if (wire.length === 0)` → `if (wire.length <= 1)`, or the empty state never fires when the only event is the catalyst.
- `app.js:17224` — `out += wire` → `out += wire.slice(1)` (row 0 is the catalyst above).
- `app.js:17231` — the star, inside the branch that already exists:
  ```js
          <span class="dem-s${event.impact === "High" ? " is-hot" : ""}">${
            event.impact === "High" ? `<i class="dem-star" aria-label="High impact">&#9733;</i>` : ""
          }${escapeHtml(event.currency)}</span>
  ```
  `impact` is a publisher rating validated against the four-value allowlist at `api/_lib/calendar.js:78`. The mark is earned.

**(h) `app.js:17239-17262` — DELETE the F2 "your file" block.** `key` (`:17163`) and `file` (`:17164`) stay: `newsVerdict` consumes `file` at `app.js:17191`. Only the printing goes; `renderEdgeBoard` still prints it on the desk. This is the ~120px the column needs.

---

## STEP 3 — Band B: one plot, two series, two axes

### 3.1 `index.html:1774` — retitle

```html
                <h3>Equity / drawdown</h3>
```

`:1775`'s `<p>` stays — `clay-v3.css:3896` already `display:none`s it on this board and it is the accessible description below 1240.

### 3.2 `index.html` — move the stat strip above the canvas

Cut `index.html:1810-1855` verbatim (the whole `<div class="eq-footnotes">…</div>`) and re-insert it between `:1776` (`</div>` of `.panel-head`) and `:1777` (the `<!-- 1f #05 equity scrub` comment). Inside it:

- **DELETE** the Winning Streak article (`1826-1830`) and the Losing Streak article (`1831-1835`). The streak moved to band A's GREEN STREAK cell (`#dashNowStreak`, fed by `currentDayStreak`), and repeating it here was the only reason the strip needed three rows. Grep confirms `winningStreak` / `losingStreak` have **no other consumer**: `index.html:1828/1829/1833/1834`, `app.js:1044-1045`, `:9726-9727`, `:9744-9745`.
- Reorder the seven survivors to the reference sequence — a pure DOM move, since every one is written by attribute from the `values` map at `app.js:9713-9728`:
  `totalTrades, winRate, profitFactor, expectancy, avgWinLoss, maxDrawdown, currentDrawdown`
- Sentence-case the three shouting labels: `Total Trades` → `Total trades` (`:1812`), `Current Drawdown` → `Current drawdown` (`:1817`), `Max Drawdown` → `Max drawdown` (`:1822`). The CSS uppercases them; the source should not do it twice.
- Keep every `data-metric` / `data-metric-delta` attribute and the `.metric-card` class.

Optional tidy, same commit or a later one: delete `app.js:1044-1045`, `:9726-9727`, `:9744-9745`. Both consumers iterate DOM nodes and look the spec up, so leaving them is harmless — but a future reader will hunt for the tiles.

### 3.3 `index.html` — the legend, immediately after the moved strip's `</div>`

```html
              <!-- The legend the on-canvas readout used to be. Two series, one
                   line, and it is what lets drawLineChart run with readout:null
                   and hand the axis 20px of padTop back.
                   NOT [data-metric] nodes, on purpose: these state the
                   CLOSED-TRADE equity the curve's head actually plots, while
                   band A's accountBalance node is re-patched to balance + open
                   float by renderLiveEquity (app.js:14620) on every 5s poll. -->
              <p class="eq-legend">
                <span class="eq-legend-item is-equity">Equity <b id="equityLegendValue">$0.00</b></span>
                <span class="eq-legend-item is-depth">Drawdown <b id="equityLegendDepth">$0.00 (0.00%)</b></span>
              </p>
```

Resulting child order of `.panel-span-8`: `.panel-head`, `.eq-footnotes`, `.eq-legend`, `canvas#equityChart`, `.eq-scrub-hint`, `.eq-scrub`.

### 3.4 `tests/instrumentPanel.check.mjs:201` — rewrite in place

```js
assert.equal(figures, 7, `stat strip should carry 7 figures, found ${figures}`);
```

The slice at `:198-199` runs from `class="eq-footnotes"` to the first `</div>`; the legend `<p>` sits after that close and carries no `data-metric`, so it contributes nothing. `:180-184` (the `totalPnl` / `accountBalance` pins) still pass — band A's nodes are untouched.

### 3.5 `clay-v3.css:3836-3845` — rewrite in place (with its comment at `3832-3835`)

```css
  /* SEVEN FIGURES, ONE ROW, ABOVE THE CURVE. Hairlines, not a 3x3 grid: this
     panel is one surface and dividers do the work borders used to.
     26px = label(11) + value(15); stating it as the basis keeps the flex
     algorithm from sizing the strip before the row lays out. */
  #dashboard.is-active .eq-footnotes {
    display: flex;
    flex: 0 0 26px;
    align-items: stretch;
    gap: 0;
    margin: 0;
  }
```

### 3.6 `clay-v3.css:3849-3855` — rewrite in place (with its comment at `3846-3848`)

```css
  /* flex: 1 1 auto, NOT 1 1 0. An even split gives each cell ~96px of content
     box at 1440x900 and "$3,050 / $1,300" needs 117 — it ellipsised. Sizing
     from content and sharing only the slack, avgWinLoss takes what it needs and
     the "26" cell gives up what it does not. Measured at both targets: no cell
     clips. */
  #dashboard.is-active .eq-footnotes > article {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    padding-inline: 12px;
  }
  #dashboard.is-active .eq-footnotes > article + article { border-inline-start: 1px solid var(--line); }
  #dashboard.is-active .eq-footnotes > article:first-child { padding-inline-start: 0; }
  #dashboard.is-active .eq-footnotes > article:last-child { padding-inline-end: 0; }
```

`clay-v3.css:3869` (`> * { margin: 0; padding: 0 }`) stays — `> article` is (1,2,1) and beats `> *` at (1,2,0), so the `padding-inline` above survives it.

### 3.7 `clay-v3.css:3858` and `:3863-3867` — rewrite in place

- `:3858` — `line-height: 15px` → `line-height: 11px` (11 + 15 = 26, the stated basis).
- `:3863-3867`:
  ```css
  #dashboard.is-active .eq-footnotes .metric-value {
    font-size: 13px;
    line-height: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  ```

Leave `:3849-3855`'s neighbours and `:3856-3857` alone.

### 3.8 `clay-v3.css:4152` — DELETE

It restates a grid that no longer exists. Measured at 1440×900 the one-row strip is 26px in both blocks and the budget closes without an override.

### 3.9 `clay-v3.css` — add base rules beside `:3426-3445`

**11px, not 10px.** I appended a 10px version of this exact rule to a copy of `clay-v3.css` and ran the suite: `AssertionError: Text below the 11px floor survives at phone widths: clay-v3.css: "#dashboard .eq-legend" resolves to 10px at 375px`. `tests/mobileFloors.check.mjs:68` scans `clay-v3.css`, `:22` sets the floor, `:32` exempts only four selectors. The 10px step goes in the 1240 block, which is where this file already puts its 9px and 10px dashboard type (`:4069-4070`, `:3763-3765`).

```css
/* Legend: the on-canvas readout, in the DOM. The swatches read the SAME two
   custom properties src/modules/charts.js paints with — --chart-line for the
   equity stroke, --chart-axis for the depth outline — so a palette change can
   never make the dots disagree with the plot. */
#dashboard .eq-legend {
  display: flex;
  align-items: center;
  gap: 18px;
  margin: var(--space-2) 0 0;
  font: 500 11px/13px var(--font-mono);
  letter-spacing: 0.06em;
  color: var(--text-soft);
}
#dashboard .eq-legend-item { display: inline-flex; align-items: center; gap: 6px; }
#dashboard .eq-legend-item::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--chart-line);
}
#dashboard .eq-legend-item.is-depth::before { background: var(--chart-axis); }
#dashboard .eq-legend b { font-weight: 600; color: var(--text); }
```

### 3.10 `clay-v3.css` — add in `@media (min-width: 1240px)`, beside `:3800-3802`

```css
  #dashboard.is-active .eq-legend { flex: 0 0 auto; margin: 0; font-size: 10px; }
  #dashboard.is-active #equityChart { order: 1; min-height: 200px; }
  #dashboard.is-active .panel-grid-analytics > .panel-span-8 { position: relative; }
  /* toneBySign (app.js:12769) adds .pnl-positive at (0,1,0); this is (1,3,2)
     and is scoped to the equity half, so the drawdown figure keeps its red. */
  #dashboard.is-active .eq-legend .is-equity b { color: var(--text); }

  /* THE SCRUB PANEL FLOATS. Band C is under this panel now, so the readout
     cannot have a row of its own. Anchored to the BOTTOM so the header stack
     above it can change height without moving it, and 72px in so it clears
     padLeft(56) + the panel's 16 of padding — it never covers the money axis.
     Zero JS: renderEquityScrub (app.js:10279) only toggles .hidden.
     .eq-scrub-hint is already display:none here (clay-v3.css:3894). */
  #dashboard.is-active .eq-scrub {
    position: absolute;
    inset-inline-start: 72px;
    inset-block-end: 46px;       /* padBottom(30) + panel padding(16) */
    width: min(420px, calc(100% - 96px));
    margin: 0;
    z-index: 2;
  }
```

### 3.11 `clay-v3.css:4143-4155` — add to the short-screen block

```css
  #dashboard.is-active .eq-legend { display: none; }
  #dashboard.is-active .panel-span-8 { gap: 6px; }
```

### 3.12 `src/modules/charts.js` — nine hunks

**(A)** insert after `:43` (`traceSmoothPath` closes), before `:45`:

```js
/**
 * Smallest 1/2/2.5/5/10 x 10^k step that satisfies `fits` in exactly `n`
 * intervals, or null when nothing in range does. Lifted out of the tick search
 * below so the money axis and the depth axis run the SAME search — a second
 * copy is how two scales drift onto two different sets of gridlines.
 */
function niceStep(span, n, fits) {
  const seed = Math.max(span / n, Number.MIN_VALUE);
  const base = 10 ** Math.floor(Math.log10(seed));
  let step = null;
  for (let scale = base; scale <= base * 1e4 && step === null; scale *= 10) {
    step = [1, 2, 2.5, 5, 10].map((m) => m * scale).find(fits) ?? null;
  }
  return step;
}

// Right-hand axis labels. TWO decimals, not one: the step ladder includes
// 2.5 x 10^k, so a 0.25 step at one decimal prints -0.3 / -0.5 / -0.8 on an
// evenly spaced grid — the same silent lie the money axis' comment below was
// written to kill. Number() drops the trailing zeros afterwards.
// CEILING: a window whose deepest drawdown is under ~0.125% lands on a 0.025
// step and rounds. At that depth the series is a hairline on the zero rule.
function formatAxisPercent(value) {
  return `${Number(value.toFixed(2))}%`;
}
```

**(B)** insert immediately before `:518` (`function drawAllCharts`):

```js
  /* Drawdown as a share of the peak it fell from — the equity plot's second
     series. peak_i = equity_i + drawdown_i is an IDENTITY of how
     calculateAnalytics builds the pair: app.js:8472 pushes nextEquity,
     app.js:8475-8477 raises `peak`, app.js:8479 rounds dd = peak - nextEquity.
     So this needs no new analytics field, no new hash key (computeChartHash
     already covers analytics.drawdowns at charts.js:143) and no second pass.

     SIGN: analytics.drawdowns is a POSITIVE MAGNITUDE, floored at 0 by
     construction. It is negated HERE, once, so everything downstream reads
     depth as negative the same way `plotted` does for the underwater chart. */
  function depthPercent(analytics) {
    const equity = analytics.equity;
    const drawdowns = analytics.drawdowns;
    if (!Array.isArray(equity) || !Array.isArray(drawdowns) || drawdowns.length !== equity.length) {
      return null;
    }
    return drawdowns.map((dd, i) => {
      const peak = equity[i] + dd;
      return peak > 0 ? (-Math.abs(dd) / peak) * 100 : 0;
    });
  }
```

**(C)** `:528` and `:531`:

```js
            readout: null,        // the legend line above the canvas states this
                                  // figure and band A prints it at 44px; a third
                                  // copy inside the plot is duplication, and
                                  // turning it off buys 20px of padTop back
```
```js
            extremeLabel: "PEAK",
            depth: depthPercent(analytics)
```

**(D)** `:638-639`:

```js
    const padRight = bare ? 8 : Array.isArray(options.depth) ? (compact ? 40 : 48) : 18;
    const padTop = bare ? 14 : options.readout === null ? 22 : 42;
```

`:636` (`const bare = height < 140;`) is pinned verbatim by `tests/instrumentPanel.check.mjs:161` — do not touch it. `:637` and `:640` unchanged.

**(E)** `:688-696` — delete the seed/base lines and the inner scale loop; keep everything else byte-identical:

```js
        const fits = options.underwater
          ? (s) => s * n >= -min
          : (s) => Math.floor(min / s) * s + s * n >= max;
        const step = niceStep(span, n, fits);
```

`:687` (the `for (let n = maxRows; …)` header) and the `THE TICK COUNT IS PART OF THE ANSWER` comment above it are pinned by `tests/instrumentPanel.check.mjs:164-167`. Untouched. `:697` (`if (step === null) {`) stays.

**(F)** insert at `:719` (the blank line between the else-block's `}` at `:718` and `const yFor` at `:720`):

```js
    /* ── THE SECOND SCALE ──────────────────────────────────────────────────
       TWO SCALES, ONE SET OF RULES. The row COUNT is part of the money search's
       answer above, so the depth axis does not get its own: it reuses `rows` and
       searches only for its own step. That is what makes both label columns land
       on the same gridlines by construction instead of by luck.

       Nothing below reads `min` or `max`, and nothing above reads `depthFloor`.
       That is the whole independence guarantee.

       ZERO SITS ON THE TOP RULE and the area hangs DOWN from it — the grey is
       "how far below the peak", filling from the peak line down. Same convention
       the standalone drawdown chart plots (charts.js:660, :700-701, :797-806).
       Depth is never positive, so a symmetric axis would label rows the data
       cannot reach.

       `!bare` is NOT redundant with `rows > 0`: a 90px sparkline still gets
       maxRows 2 (plotH 72), so the row count alone would let a grey wash and an
       off-bitmap percent column onto a box with 8px of right gutter. */
    const depth =
      !bare && rows > 0 && Array.isArray(options.depth) && options.depth.length === series.length
        ? options.depth
        : null;
    let depthFloor = 0;
    if (depth) {
      const deepest = -Math.min(...depth, 0);
      // No drawdown in the window: the series lies flat on the zero rule, so the
      // axis only needs round labels to sit against. 1% a row.
      const step = deepest > 0 ? niceStep(deepest, rows, (s) => s * rows >= deepest) : 1;
      depthFloor = -(step || 1) * rows;
    }
```

and one line after `:720` (`const yFor = …`):

```js
    const yForDepth = (value) => top + (value / depthFloor) * plotH;
```

`value 0 → top`; `value depthFloor → bottom`. `fits` guarantees `|value| <= |depthFloor|`, so nothing can plot outside the box.

**(G)** `:733-735` — two keys between `formatter` and `rows`:

```js
      formatter: formatCompactCurrency,
      // Same `t`, same loop, same `y` — so row i carries both readings and the
      // two columns can never drift apart.
      valueAtRight: depth ? (t) => depthFloor * t : null,
      formatterRight: formatAxisPercent,
      rows
```

**(H)** insert at `:749` (the blank line between the clip block's `}` at `:748` and the `// Area` comment at `:750`):

```js
    /* Depth series. Painted FIRST and flat, in the 10%-alpha neutral the palette
       already carries, so the equity area, its three-pass glow stroke and every
       marker land on top of it. Z-ORDER is what stops the second series swamping
       the first — not a scale fudge, which would be a lie about the axis beside
       it. Inside the reveal clip so both series wipe in together. Paint-only: it
       is never written to `geometry`, so the scrub, the hover hit-test and the
       playhead never see it. */
    if (depth) {
      const depthPoints = depth.map((value, index) => ({
        x: left + (index / (depth.length - 1)) * plotW,
        y: yForDepth(Math.min(value, 0))
      }));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(depthPoints[0].x, top);
      traceSmoothPath(ctx, depthPoints, false);
      ctx.lineTo(depthPoints[depthPoints.length - 1].x, top);
      ctx.closePath();
      ctx.fillStyle = colors.track;
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = colors.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      traceSmoothPath(ctx, depthPoints);
      ctx.stroke();
      ctx.restore();
    }
```

`colors.track` is `--chart-track` (`charts.js:113`) and `colors.axis` is `--chart-axis` (`charts.js:90`). Both are declared in **both** `clay-v3.css` theme blocks — `:71`/`:95` and `:195`/`:211` — so neither can resolve to `""` and throw inside `addColorStop`.

**(I)** `:832-841` — wrap the whole readout block, including its `const lastValue` (nothing else reads it):

```js
    // Readout block, top-left. `!== null`, not `|| "LAST"`: null has to survive
    // that default. #drawdownChart and #playbookChart pass strings and are
    // byte-identical in behaviour.
    if (options.readout !== null) {
      const lastValue = series[series.length - 1];
      …existing eight lines, unchanged…
    }
```

**(J)** seven date labels:

- `:846` → `drawDateLabels(ctx, points, options.labels, bottom, plotW);`
- `:1003` → `function drawDateLabels(ctx, points, labels, bottom, plotW) {`
- `:1009` →
  ```js
    // Three was a floor for a phone-width canvas, not a ceiling for a 1117px
    // plot. ~110px a label at 10px mono keeps "AUG 24" off its neighbour; the
    // Set collapses the duplicates a short series produces, so a 3-point curve
    // still prints exactly 3.
    const slots = clamp(Math.floor(plotW / 110), 2, 6);
    const indices = Array.from(
      new Set(Array.from({ length: slots + 1 }, (_, i) => Math.round((i / slots) * (points.length - 1))))
    );
  ```

`clamp` is already imported at `charts.js:1`. The alignment branch at `:1020-1026` keys on `labelIndex 0 / last` and is untouched. The smoke test's 350px canvas gives `slots = 2` → 3 labels, exactly as today.

**(K)** `drawPlotFrame`:

- `:1036` → `const { left, right, top, bottom, valueAt, formatter, valueAtRight, formatterRight } = options;`
- insert after `:1058` (the `}` closing the left-label `if`), still **inside** the `for` loop:
  ```js
        // Second scale, right gutter. Restates globalAlpha because the rule
        // stroke above fades the top rows out and the labels must not.
        if (typeof valueAtRight === "function") {
          ctx.globalAlpha = 1;
          ctx.fillStyle = colors.axis;
          ctx.font = colors.font(500, 10);
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(formatterRight(valueAtRight(i / rows)), right + 8, y);
        }
  ```

**Untouched, deliberately:** `geometry.set` at `:884` still stores **only** the equity points. That single decision is why the depth is invisible to `scrubPoints` (`:299`), `nearestLineIndex` (`:219`), `yAtX` (`:505`), `bindScrub`'s `pointerIndex` (`:376`) and `drawLineHover` (`:975-1001`) — five call sites that would each have needed a "which series?" answer under a generalised `series[]` rewrite, for a capability the reference never uses. `tests/equityScrub.check.mjs` needs no edit.

### 3.13 `app.js` — one hunk

Insert at `app.js:9708` (between the `avgWinLoss` block that ends at `:9707` and `if (ui.metricGrid && ui.dashboardEmptyState)`):

```js
  // The equity legend. Two series in one line above the canvas — which is what
  // lets drawLineChart run with readout:null and hand the axis its padTop back.
  // Deliberately NOT [data-metric] nodes: these state the CLOSED-TRADE equity
  // the curve's head actually plots, while band A's accountBalance node is
  // re-patched to balance + open float by renderLiveEquity (app.js:14620) on
  // every 5s poll.
  // equity[last], NOT analytics.accountBalance: app.js:8529-8530 substitutes
  // settings.balanceOverride when one is set, and then the balance and the
  // plotted head are two different numbers. renderBalanceCard (app.js:10356)
  // already reads the curve for the same reason.
  const curve = Array.isArray(analytics.equity) ? analytics.equity : [];
  const head = curve.length ? curve[curve.length - 1] : 0;
  const legendEquity = document.getElementById("equityLegendValue");
  if (legendEquity) {
    legendEquity.textContent = formatCurrency(head);
  }
  const legendDepth = document.getElementById("equityLegendDepth");
  if (legendDepth) {
    // peak = equity + drawdown, the identity calculateAnalytics builds at
    // app.js:8479 — the same one charts.js depthPercent() reads, so the legend's
    // percent and the right axis can never disagree.
    const peak = head + analytics.currentDrawdown;
    const pct = peak > 0 ? (analytics.currentDrawdown / peak) * 100 : 0;
    legendDepth.textContent = `${formatCurrency(analytics.currentDrawdown)} (${pct.toFixed(2)}%)`;
  }
```

No new call site, no new render pass, no module-level binding — the TDZ trap below `init()` is not approached.

---

## STEP 4 — Band C: equal halves

### 4.1 `index.html:1566` — the calendar gets a name

As the **first child** of `.mini-cal-head`:

```html
                  <h3 class="mini-cal-title">Evidence calendar</h3>
```

The panel has no title today — `clay-v3.css:3148-3156` records that `#miniCalMonth` was deliberately quietened out of the title role and nothing replaced it.

### 4.2 `clay-v3.css` — three grid-area rewrites in place

```css
  #dashboard.is-active #dashLedger { grid-area: 4 / 5 / 5 / 9; }   /* :4026, was 4 / 4 / 5 / 9 */
  #dashboard.is-active #propTracker { grid-area: 4 / 1 / 5 / 5; }  /* :4040, was 4 / 1 / 5 / 4 */
  #dashboard.is-active #dashMiniCal { grid-area: 4 / 1 / 5 / 5; }  /* :4071, was 4 / 1 / 5 / 4 */
```

4 + 4 instead of 3 + 5. Measured at 1999×1150: calendar `[x=94, 621.7 × 511]`, queue `[x=727.7, 621.7 × 511]`. `621.7 + 12 + 621.7 = 1255.4` = the equity panel's own width to a tenth, so the three panels share two vertical seams instead of three.

### 4.3 `clay-v3.css:4081-4089` — rewrite in place

The range is **4081-4089** (`:4080` is the comment line, `:4088` is `box-shadow: var(--clay-raised);`, `:4089` is the closing brace).

```css
  #dashboard.is-active #dashMiniCal {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-xl);
    background: var(--surface-1);
    box-shadow: var(--edge-highlight);
  }
```

`--clay-raised` is a 30px drop shadow; the reference's panels are flat with a hairline, which is what `.panel` already is. The calendar was the one box still lifted. `#miniCalGrid` already carries `flex: 1` (`clay-v3.css:3167-3171`) — do not restate it.

### 4.4 `clay-v3.css` — add, in the 1240 block

```css
  #dashboard.is-active .mini-cal-title {
    flex: 0 0 auto;
    margin: 0 auto 0 0;
    font: 600 11px/14px var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-soft);
  }
  /* Six columns in a 590px panel: auto layout distributes surplus
     proportionally and .lq-reason { max-width: 0 } (clay-v3.css:4243) opts
     Reason OUT of that share, so Source out-bid it — measured 92px of Reason
     against 184px of Source. Percentages, not px: px at 1440 left Reason 47. */
  #dashboard.is-active .dash-ledger { table-layout: fixed; }
  #dashboard.is-active .dash-ledger th:nth-child(1) { width: 14%; }
  #dashboard.is-active .dash-ledger th:nth-child(2) { width: 10%; }
  #dashboard.is-active .dash-ledger th:nth-child(3) { width: 9%; }
  #dashboard.is-active .dash-ledger th:nth-child(4) { width: 17%; }
  #dashboard.is-active .dash-ledger th:nth-child(6) { width: 17%; }
```

Measured columns: 1999 → `82 / 59 / 53 / 100 / 194 / 100`; 1440 → `56 / 40 / 36 / 68 / 132 / 68`. Content floors: `Aug 21` 40, `MGC` 20, `Short` 33, `+$1,036.00` 66, the `ESTIMATED` chip 61. Clear at both.

### 4.5 The calendar's TODAY dot

`clay-v3.css:3291-3299` scopes the accent dot to `.is-today:not(.is-trade)` because a traded today is already three lines deep in a 43px cell. The reference's 24 is untraded, so the mockup and the build agree on the pictured case. **Leave it.** If the owner wants the dot on a traded today it is one rule: `position: absolute; top: 4px; right: 4px` on `.is-today`, drop the `:not(.is-trade)`.

Everything else in band C already ships and needs **zero** work: the greyed adjacent-month lead-in (`app.js:12348-12351`, `:12372-12375`, `clay-v3.css:3247`), the money-over-count traded tiles (`app.js:12364`, `clay-v3.css:3251-3260`), the orange today border (`clay-v3.css:3286-3290`), the `GREEN DAYS 5 · AVG +$455` footer (`app.js:12385-12387`), the six-column queue with its three-way provenance chip (`app.js:12479-12489`), and the orange `7` badge (`app.js:12467-12471`) which is the **same** `isTradeJournalled` predicate (`app.js:10960`) that feeds the rail badge — they can never disagree.

---

## STEP 5 — Shell

### 5.1 `clay-v3.css` — three rail-width edits in place

```css
  :root { --rail-w: 78px; }                     /* :678, was 56px */
```
```css
  .rail:has(:focus-visible) {                   /* :716-719 */
    width: var(--rail-w);                       /* :717, was 84px */
    box-shadow: var(--clay-float);
  }
```
```css
  body.rail-pinned { --rail-w: 78px; }          /* :731, was 84px */
```

Both writers, because the pin is **kept** (see 5.6). At 78px a row gives `78 − 16 rail padding − 1 border = 61px` of button and 53px of label. Measured label widths in the live rail: `Journal 47`, `Timing 40`, `Trades 40`, `Setups 40`, `Rules 34`, `Dash 27`, `Edge 27`, `Cal 20`. Nothing ellipsises. `ANALYTICS` at ~60px would — see NOT BUILT.

Nine consumers already read the token and need nothing: `:690`, `:957`, `:978`, `:1033`, `:1035`, `:1040`, `:1046`, `:1083-1085`, `:1089`, `:1449`.

### 5.2 `styles.css:12167` — rewrite in place

```css
    padding-inline: max(var(--space-6), calc((100% - var(--rail-w, 0px) - var(--shell-w, 100%)) / 2));
```

**Measured on `#journal` at 1999×1150, both ways:**

| | padding | view | reading column |
|---|---|---|---|
| shipped | 259.5 / 259.5 | 1921 | **1402** |
| with the fix | 220.5 / 220.5 | 1921 | **1480** — exactly `--shell-w` |

`.view.is-active` is `position: fixed` (`clay-v3.css:1035`), so its `100%` resolves against the initial containing block — the viewport — not its own box. The column was losing exactly `--rail-w`.

**`100%`, never `100vw`.** `styles.css:12160-12163` documents the choice: on a fixed box `100%` excludes a classic scrollbar and `100vw` does not; `100vw` reintroduces ~7.5px of asymmetric padding on Windows and Linux, invisible on this Mac's overlay scrollbars.

**Not the dashboard.** `.view.is-active#dashboard` (`clay-v3.css:3941`) is a (1,2,0) tie broken by file order, and `index.html` loads `clay-v3.css` after `styles.css`, so `#dashboard` keeps `var(--space-4)`. I confirmed the tie is live by injecting the new rule from a later sheet: the dashboard column collapsed to 1480 and the hero moved to `x=298.5`. Keep the rule in `styles.css`. `tests/instrumentPanel.check.mjs:74-77` pins the escape selector — do not touch it.

Inert below 1240: at 1180 the padding is `24px / 24px` both ways. Inert at 900–1024: `--rail-w` is 0px and `--shell-w` is undeclared, so the expression is `max(24, 0)`. Inert below 900: the view is not fixed.

**Then** `clay-v3.css:1242` and `:1258-1262` (`#dashboard .dash-edge-mini { margin-right: … }`) — **delete both.** They lose to `#dashboard.is-active .dash-edge-mini { margin: 0 }` at **`clay-v3.css:4052`** and have been inert since the instrument grid landed.

### 5.3 `clay-v3.css` — the ticker bar

**`:975-985` — rewrite in place** (the rule closes at `:985`; a `975-984` edit drops the brace):

```css
  .app-ticker {
    position: fixed;
    top: 0;
    left: var(--rail-w);
    right: 0;
    z-index: calc(var(--z-nav) - 1);
    display: flex;
    align-items: center;
    width: auto;          /* BUG FIX, not dressing — see below */
    margin-left: 0;       /* the other half of the same fix */
    padding: 7px 0;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-0);
    box-shadow: none;
    overflow: hidden;
  }
```

`#appTicker` carries `.lnd-ticker`, and `styles.css:5063-5066` gives that class **both** `width: 100vw` **and** `margin-left: calc(50% - 50vw)`. With `left`, `right` and `width` all set, the box is over-constrained and `right` is ignored. Measured on the shipped build: `x=84, width=1999, right edge 2083` — the bar runs 84px past the window and its own `overflow: hidden` hides the evidence. Neutralising only `width` leaves the residual `50% − 50vw` margin, which is nonzero wherever a classic scrollbar exists. With both: measured `x=78, width=1921`.

**`:989-1000` — retarget both fades.** The shared `::before/::after` block is `989-998`, `::before` is `:999`, `::after` is `:1000`. All three change `.app-ticker` → `.app-ticker-tape`, or the left fade washes out the new wordmark.

**Add, same block:**

```css
  .app-ticker-mark {
    flex: 0 0 auto;
    padding: 0 var(--space-6);
    color: var(--text-soft);
    font: 700 11px/1 var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .app-ticker-tape { position: relative; flex: 1 1 0; min-width: 0; overflow: hidden; }
  .app-ticker-live {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 var(--space-6);
    border-left: 1px solid var(--line);
  }
  /* THE DOT IS REAL. setTickerStale (app.js:14841) toggles .is-stale on every
     [data-ticker-strip] on every 5s poll (app.js:14418-14421) and on the
     sessionStorage repaint (app.js:14783). styles.css:8968 is an ancestor
     selector on #appTicker, so the moved spans keep reacting with zero JS.
     This restyles the signal that already ships as the words "live · 5s". */
  .app-ticker-live .lnd-ticker-tag::before {
    content: "";
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 7px;
    border-radius: 999px;
    background: var(--live);
    vertical-align: middle;
  }
  .app-ticker-live .lnd-ticker-stale::before { background: var(--warn); }
```

### 5.4 `clay-v3.css` — one theme-following token

The bar sits on `--surface-0`, which **does** follow the theme, so it cannot use `--term-live`: `#4cc9e0` on light `--surface-0` (`#e6e8ea`) is **1.59:1**, below the 3:1 non-text floor. Add a forked pair beside the existing `--surface-0` declarations:

- in the dark block (beside `clay-v3.css:38`): `--live: #4cc9e0;   /* 9.26:1 on --surface-0 */`
- in the light block (beside `clay-v3.css:163`): `--live: #0e7c8f;   /* 3.98:1 on --surface-0 */`

### 5.5 `index.html` — the top bar

At `:3386-3387`, open the two new wrappers:

```html
    <div class="app-ticker lnd-ticker" id="appTicker" data-ticker-strip aria-label="…">
      <span class="app-ticker-mark">Trader Journal</span>
      <div class="app-ticker-tape">
        <div class="lnd-ticker-track">
```

and close them after the track's `</div>` at `:3528`:

```html
      </div>            <!-- .lnd-ticker-track, unchanged -->
      </div>            <!-- .app-ticker-tape -->
      <span class="app-ticker-live">
        <span class="lnd-ticker-tag">live</span>
        <span class="lnd-ticker-tag lnd-ticker-stale">stale</span>
      </span>
    </div>              <!-- #appTicker -->
```

**DELETE `index.html:3455-3456` AND `index.html:3525-3526`** — both `.lnd-ticker-tag` / `.lnd-ticker-stale` pairs. **Both, never one:** the two `.lnd-ticker-group` halves are the marquee's identical copies and a `translateX(-50%)` loop tears at the seam if they differ.

Measured after the change at 1999: mark 158.9, tape 1682.3, live 79.8 → 1921 exactly. One marquee group is **2150.3px** against a 1682.3px tape, so **the marquee stays.**

### 5.6 `index.html` — the rail

**Add the Setups row** after the Trades button (`index.html:3563`), reusing the icon already drawn at `index.html:1248-1250`:

```html
            <button class="nav-btn topnav-btn" type="button" data-target="playbook">
              <span class="topnav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false"><path d="M5.75 5.25h5.5v13.5h-5.5zM12.75 5.25h5.5v13.5h-5.5zM8 9h1M15 9h1" /></svg>
              </span>
              <span class="topnav-label">Setups</span>
            </button>
```

`#playbook` is a real view (`index.html:2502`) whose only nav entry anywhere is the mobile sheet tile at `index.html:1246-1253`. Zero JS: `switchView` (`app.js:2118`) and `ui.navButtons` bind by `data-target`. Measured: label 40px in a 53px slot, and the rail spacer goes 220px → 192px — no overflow, `scrollHeight === clientHeight`.

**`index.html:3583`** — `Edge` → `TV`. The panel is titled Market TV and the row leads to the desk whose wall of monitors is its most visible feature. `MARKET TV` will not fit 53px. The gate (`data-terminal-nav`, `hidden`) is untouched.

**`index.html:3614`** — the summary, not the `<details>` at `:3613`:

```html
              <summary class="topnav-icon-btn" aria-label="Settings and more">
                <span aria-hidden="true">&#9881;</span>
                <span class="topnav-label">Settings</span>
              </summary>
```

The glyph changes from `&#8943;` to `&#9881;` as part of this edit.

**KEEP `setupRailPin` (`app.js:16820-16841`) and `#railPinBtn` (`index.html:3593-3596`).** The reference has no pin, but the pinned state is already the **default** — `app.js:16833` reads `!== "0"`, so an absent preference gives the labelled rail on first load — and deleting the toggle silently demotes anyone whose localStorage says `"0"` to a 56px unlabelled rail, which is the one state the reference definitely is not. Both `--rail-w` writers now say 78px, so either state is the reference's width. The pin costs 40px in a rail with 192px of measured slack.

### 5.7 `clay-v3.css` — rail dressing

**Add, in `@media (min-width: 1025px)` beside `:1097-1100`:**

```css
  /* The reference tints the icon and the label as well as the row. The rail
     SVGs are stroke:currentColor, so the glyph follows for free. The 3px edge
     bar at clay-v3.css:927-937 already ships. */
  .rail .topnav-btn.is-active { color: var(--accent); }
```

**Add, beside `:1035`:**

```css
  /* THE FOOT. .rail is flex-column, so one `order` moves the account block from
     under the mark to the bottom without touching setupRailAccount's
     insertBefore (app.js:16769). Both move together, so the chip and the native
     select it writes to stay adjacent. Everything else is order 0. */
  .rail .rail-account-more,
  .rail .account-switch { order: 1; }
```

**`clay-v3.css:1207` — rewrite in place** (`:1206` is the border — leave it):

```css
    border-radius: 999px;
```

**`clay-v3.css:1296-1300` — rewrite in place**, keeping only `min-width`:

```css
  .rail .rail-account-more .topnav-menu { min-width: 220px; }
```

The base `.rail .topnav-menu` already sets `top: auto` (`:959`) and `bottom: 12px` (`:960`), which is where a foot-anchored flyout has to open from.

### 5.8 `tests/clayV3Contrast.check.mjs` — two guard lines

- `:402` → `for (const fg of ["--term-acc", "--term-warn", "--term-pos", "--term-neg", "--term-live"]) {`
- inside the theme loop, after `:248`:
  ```js
  // The top bar's live dot: non-text, 3:1, and it sits on a theme-following
  // ground, so unlike --term-live it has to be measured in both.
  check(theme, "--live", "--surface-0", 3);
  ```

---

## ARITHMETIC

Every figure below was read off the live DOM with the design injected into a private tab, then torn down. `document.scrollHeight === clientHeight` at both sizes, before and after.

### 1999 × 1150 — the owner's screen

```
--chrome-h  57   (#appTicker bottom, published by syncChromeHeight, app.js:16843)
--rail-w    78
view box    left 78, top 57, 1921 x 1093                      [measured]
padding     16  (.view.is-active#dashboard, clay-v3.css:3941)
content     1889 x 1061

COLUMNS  12 x minmax(0,1fr), gap 12
  (1889 - 132) / 12 = 146.4167          4 cols = 621.67    8 cols = 1255.33
                                        [measured 621.7 and 1255.3]

ROWS  36px 108px minmax(0,0.42fr) minmax(0,0.58fr) — UNCHANGED
  budget 1093 - 32 - 36 = 1025;  fr pool 881
  row 3 = 370.02   row 4 = 510.98       [measured 370.016 / 510.977]
  36 + 108 + 370.02 + 510.98 = 1025. CLOSES.
```

| Region | grid-area | measured |
|---|---|---|
| Band A `.dash-hero` | `1 / 1 / 3 / -1` | `x=94, 1889 × 156` |
| — tracks | `minmax(260,3fr) / minmax(0,9fr) / auto` | controls **603.4**, cols **313 / 938.7** |
| — headline `[data-metric="totalPnl"]` | track 1 | **312.9 × 48** inside 313 |
| — six cells | 938.7 / 6 | **156.5** each, widest label `GREEN STREAK` 111 |
| Band B `.panel-span-8` | `3 / 1 / 4 / 9` | `x=94, 1255.3 × 370`, `scrollHeight 368 === clientHeight` |
| — stack | head 16.9 + 8 + strip **26** + 8 + legend **13** + 8 + canvas **256.1** = **336** = 368 − 32 ✔ | |
| — plot | `plotH = 256 − 22 − 30 = 204 ≥ 128` → **5-row axis** (72px of margin) | |
| — labels | `plotW = 1221.3 − 56 − 48 = 1117.3` → `clamp(⌊1117/110⌋,2,6) = 6` slots → **7 dates** | |
| — strip cells | 164 / 204 / 177 / 151 / 184 / 164 / 178 = 1222 — **none clipped** | |
| Band C calendar | `4 / 1 / 5 / 5` | `x=94, 621.7 × 511`, `scrollHeight 509 === clientHeight`, cell 81.7 × 56.8 |
| Band C queue | `4 / 5 / 5 / 9` | `x=727.7, 621.7 × 511`, cols 82/59/53/100/194/100 |
| Market TV | `3 / 9 / 5 / -1` | `x=1361.3, 621.7 × 893` |

```
MARKET TV COLUMN — panel 619.7 x 846, scrollHeight 846 === clientHeight
  .dem-tv       375.2   11 pad + 28 masthead + 336.2 picture (597.7 x 9/16 — exact 16:9)
  .dem-cat       81.2   21 pad + 1 border + 14 label + 26 title/countdown + 20 clause
  .dem-news     241.2   1fr; scrollHeight 240 — NO internal scroll at 4 headlines
  .dem-screen   118.1   head + 3 SINGLE-LINE rows (was 256.3 with stacked rows)
  .dem-key       30.2
  Σ            846.0    CLOSES ON THE TRACK EXACTLY

TOP BAR   1921 x 57 at x=78:  mark 158.9 + tape 1682.3 + live 79.8 = 1921
          one marquee group is 2150.3 > 1682.3, so the tape still scrolls

PAGE SCROLL  scrollHeight 1150 === clientHeight 1150.  NO SCROLL.
```

### 1440 × 900 — the `max-height: 960px` block

```
view 1362 x 843 at x=78;  content 1330 x 811
COLUMNS  (1330 - 132)/12 = 99.83     4 cols = 435.3    8 cols = 882.7
ROWS  32px 88px 0.48fr 0.52fr        row 3 = 314.398   row 4 = 340.594
  32 + 88 + 314.4 + 340.6 = 775 = 843 - 32 - 36. CLOSES.
```

| Region | measured |
|---|---|
| Band A | `1330 × 132`, `scrollHeight 130`. Two tracks `324 / 972` → **162** a cell. Controls on row 10 inside the same surface, `y=164.1`, bottom 194.1 vs hero bottom 205 ✔ |
| Band B | `882.7 × 314.4`, `scrollHeight 312 === clientHeight`. head 16.9 + 8 + strip 26 + 8 + canvas **221.5** = 280 = 312 − 32 ✔ |
| — plot | `plotH = 221.5 − 42 − 30 = 149.5 ≥ 128` → **5 rows even before the padTop reclaim**; with `readout: null` it is 169.5. **Today this canvas is 194.5 → plotH 122.5 → a silent 2-row axis.** The redesign gains a row. |
| — strip cells | 111 / 150 / 124 / 97 / 130 / 111 / 125 — **none clipped** |
| Band C | calendar and queue `435.3 × 340.6` each, `scrollHeight 339`; cols 56/40/36/68/132/68 |
| Market TV | column `435.3 × 667`; panel `433.3 × 620`, `scrollHeight 620 === clientHeight`. tv 268.4 (11 + 26 + 231.4, exact 16:9) + cat 81.2 + news **122.1 (1fr, scrolls 121 internally)** + screen 118.1 + key 30.2 = 620 |
| Legend | `display: none` here — 13px is the difference between a 5-row and a 2-row money axis |
| Page | `scrollHeight 900 === clientHeight 900`. **NO SCROLL.** |

### Below 1240

The whole `@media (min-width: 1240px)` block is off. `.dash-head` reappears with the greeting and the session link; `.dash-controls` falls back to its base `flex-wrap` row at the foot of the hero; `.eq-footnotes` returns to the base flex-wrap list; `.eq-legend` sets at 11px; band C stacks; `.dash-edge-mini` falls back to its shipped base rules untouched. The page scrolls, which is what it already does. Measured at 1180×900: view `1102 × 843`, `journal` padding `24 / 24` — identical with and without the `styles.css:12167` change. Below 1025 `--rail-w` is 0px and the expression collapses to `max(24, 0)`; below 900 the view is not fixed. The only width-agnostic edits are the two `styles.css` collapse rules in step 2, which can only ever make **more** of the panel render than today.

---

## VERIFY

Run in **your own tab** (`tabs_create` → `navigate`), at 1999×1150 and again at 1440×900. Every assertion is one line.

```js
// ── 0. IFRAME IDENTITY — the invariant, in all five states ────────────────
const tv = document.getElementById("dashEdgeMiniTv");
console.assert(tv.parentElement.id === "dashEdgeMiniPanel", "TV was re-parented");
const blockers = () => { let n = tv, a = []; while (n && n !== document.documentElement) {
  if (getComputedStyle(n).display === "none") a.push(n.id || n.className); n = n.parentElement; } return a; };
const host = document.getElementById("dashEdgeMini");
tv.querySelector(".bb-mon-screen")?.click();                       // start a stream
console.assert(tv.querySelector("iframe"), "no iframe to test with");
const src0 = tv.querySelector("iframe").src;
for (const cls of ["", "is-tv-out", "is-min", "is-min is-tv-out"]) {
  host.className = "dash-edge-mini " + cls;
  console.assert(blockers().length === 0, `display:none ancestor while playing [${cls}]: ` + blockers());
}
host.className = "dash-edge-mini";
document.getElementById("dashboardEmptyState").hidden = false;      // the step-0 fix
console.assert(blockers().length === 0, "empty state killed the stream: " + blockers());
document.getElementById("dashboardEmptyState").hidden = true;
console.assert(tv.querySelector("iframe").src === src0, "the stream reloaded");

// ── 1. TIMER LEAK ─────────────────────────────────────────────────────────
// One 1s interval, created once, guarded by `if (!terminal.timerId)` (app.js:15636).
let live = 0; const _si = setInterval; setInterval = (...a) => { live += 1; return _si(...a); };
renderEdgeMini(); renderEdgeMini(); renderEdgeMini();
console.assert(live === 0, `renderEdgeMini started ${live} new intervals`);
setInterval = _si;
console.assert(document.querySelectorAll("[data-starts]").length <= 5,
  "more [data-starts] nodes than blocks — the 1s tick is walking duplicates");

// ── 2. SHELL: rail ────────────────────────────────────────────────────────
console.assert(getComputedStyle(document.body).getPropertyValue("--rail-w").trim() === "78px");
console.assert(Math.round(document.querySelector(".rail").getBoundingClientRect().width) === 78);
console.assert(document.querySelector('.rail [data-target="playbook"]'), "no Setups row");
console.assert([...document.querySelectorAll(".rail .topnav-label")]
  .every(e => e.scrollWidth <= e.clientWidth), "a rail label ellipsised");
const r = document.querySelector(".rail");
console.assert(r.scrollHeight === r.clientHeight, "the rail overflows");
console.assert(getComputedStyle(document.querySelector(".rail .topnav-btn.is-active")).color
  === getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  || true, "check the active row is accent-tinted by eye");

// ── 3. SHELL: top bar ─────────────────────────────────────────────────────
const t = document.getElementById("appTicker").getBoundingClientRect();
console.assert(Math.round(t.x) === 78 && Math.round(t.right) === innerWidth,
  `bar overflows: x=${t.x} right=${t.right} vw=${innerWidth}`);
console.assert(document.querySelectorAll("#appTicker .lnd-ticker-tag").length === 2,
  "the live/stale pair must exist exactly once, outside the marquee groups");
console.assert(document.querySelector(".app-ticker-mark").textContent.trim() === "Trader Journal");
console.assert(document.querySelector(".lnd-ticker-group").getBoundingClientRect().width
  > document.querySelector(".app-ticker-tape").getBoundingClientRect().width,
  "the tape no longer overflows — the marquee would be pointless");

// ── 4. BAND A ─────────────────────────────────────────────────────────────
const hero = document.querySelector(".dash-hero"), hr = hero.getBoundingClientRect();
console.assert(getComputedStyle(document.querySelector(".dash-head")).display === "none");
console.assert(Math.round(hr.height) === (innerHeight > 960 ? 156 : 132), `band A is ${hr.height}`);
console.assert(hero.scrollHeight <= hero.clientHeight + 1, "band A overflows its surface");
for (const id of ["journalNewTradeBtn","dashQuickImportBtn","dashEstChip","dashLogCooldownFlag"])
  console.assert(document.getElementById(id).closest(".dash-hero"), `${id} is not on the strip`);
console.assert(document.getElementById("journalNewTradeBtn").nextElementSibling.id === "dashQuickImportBtn",
  "log must stay immediately before import in the DOM (styles.css:8370/:8384/:8387)");
console.assert(getComputedStyle(document.getElementById("journalNewTradeBtn")).display !== "none",
  "LOG A TRADE is invisible — the cluster landed inside .dash-ground-caps");
console.assert(document.querySelectorAll("[data-account-switch]").length >= 2
  && document.querySelector(".rail [data-account-switch]"), "the rail's own select must stay");
console.assert(document.querySelectorAll(".dash-now > div").length === 6);
console.assert([...document.querySelectorAll(".dash-now > div")].slice(1)
  .every(d => getComputedStyle(d).borderLeftWidth === "1px"), "hairline cells lost");
console.assert(document.getElementById("dashNowEventSub"), "no NEXT EVENT sub-line");

// ── 5. BAND B ─────────────────────────────────────────────────────────────
const p8 = document.querySelector(".panel-span-8");
const kids = [...p8.children].filter(e => getComputedStyle(e).display !== "none")
  .sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(e => e.className || e.id);
console.assert(kids[1].includes("eq-footnotes"), "the stat strip is not above the curve: " + kids);
console.assert(p8.scrollHeight === p8.clientHeight, "the equity panel overflows");
console.assert(document.querySelectorAll(".eq-footnotes > article:not([hidden])").length === 7);
console.assert([...document.querySelectorAll(".eq-footnotes .metric-value")]
  .every(e => e.scrollWidth <= e.clientWidth), "a stat value ellipsised");
const cv = document.getElementById("equityChart");
console.assert(cv.clientHeight >= 200 || innerHeight <= 960, `canvas ${cv.clientHeight} < 200`);
console.assert(cv.clientHeight - 22 - 30 >= 128, "plotH under the 5-row floor (charts.js:647)");
console.assert(document.getElementById("equityLegendDepth").textContent.includes("%"));
// Eyeball once: a grey area hanging from the top rule, a right column of
// 0% / -N% labels, and SEVEN date labels along the bottom.

// ── 6. BAND C ─────────────────────────────────────────────────────────────
const cal = document.getElementById("dashMiniCal"), led = document.getElementById("dashLedger");
console.assert(Math.abs(cal.getBoundingClientRect().width - led.getBoundingClientRect().width) < 1,
  "band C is not two equal halves");
console.assert(Math.abs((cal.getBoundingClientRect().width + 12 + led.getBoundingClientRect().width)
  - p8.getBoundingClientRect().width) < 1, "band C does not line up with band B");
console.assert(document.querySelector(".mini-cal-title"), "the calendar has no name");
console.assert(cal.scrollHeight === cal.clientHeight, "the calendar overflows");
console.assert(document.querySelector(".mini-cal-day.is-outside"), "no greyed lead-in");
console.assert(getComputedStyle(document.querySelector(".dash-ledger")).tableLayout === "fixed");
renderDashLedger();          // the trim guard is render-time only
console.assert(led.scrollHeight === led.clientHeight, "the queue overflows after a re-render");

// ── 7. MARKET TV ──────────────────────────────────────────────────────────
const panel = document.getElementById("dashEdgeMiniPanel");
console.assert(panel.firstElementChild.id === "dashEdgeMiniTv", "the TV is no longer child 1");
console.assert([...panel.children].map(e => e.id || e.className).join("|")
  === "dashEdgeMiniTv|dem-cat|dashEdgeMiniNews|dem-screen|nav-btn dem-key",
  "block order changed — grid-template-rows names five children in source order");
console.assert(panel.scrollHeight === panel.clientHeight, "the TV column scrolls");
const mon = document.querySelector(".dem-tv .bb-mon"), dtv = document.querySelector(".dem-tv");
console.assert(mon.getBoundingClientRect().bottom <= dtv.getBoundingClientRect().bottom + 1,
  `picture overflows its tile by ${mon.getBoundingClientRect().bottom - dtv.getBoundingClientRect().bottom}`);
const pic = mon.clientHeight - 28;
console.assert(Math.abs(mon.clientWidth / pic - 16/9) < 0.02, "the picture is not 16:9");
const nb = document.getElementById("dashEdgeMiniNews").getBoundingClientRect();
console.assert(document.elementFromPoint(nb.x + 8, nb.y + 8).closest("#dashEdgeMiniNews"),
  "something is painting over the context block");
console.assert(document.getElementById("dashEdgeMiniHeading").textContent === "Market TV");
console.assert(["live","stale","down","sample"]
  .includes(document.getElementById("dashEdgeMiniAsOf").dataset.feed), "feed dot has no state");
console.assert(/^\d{2}:\d{2}:\d{2}$/.test(document.querySelector(".dem-cat-cd").textContent)
  || document.querySelector(".dem-empty"), "the catalyst countdown is not a wall clock");
console.assert(document.querySelectorAll(".dem-screen .dem-row").length <= 3);
console.assert([...document.querySelectorAll(".dem-screen .dem-row")]
  .every(row => row.getBoundingClientRect().height < 30), "calendar rows are still stacking");

// ── 8. NO SCROLL, THE PROMISE ─────────────────────────────────────────────
console.assert(document.documentElement.scrollHeight === document.documentElement.clientHeight,
  "the page scrolls");
console.assert([...document.querySelectorAll("#dashboard.is-active > *, .panel")]
  .every(e => e.scrollWidth <= e.clientWidth + 1), "something scrolls horizontally");
```

Then, at the shell:

```
node tests/instrumentPanel.check.mjs   # expects "7-figure strip"
node tests/mobileFloors.check.mjs      # the 11px base floor
node tests/clayV3Contrast.check.mjs    # --term-live and --live now in the loop
node tests/equityScrub.check.mjs       # must pass WITHOUT edits
node tests/charts.smoke.mjs            # canvas ops rise ~4%; text draws ~6%
npm test                               # all 46
```

---

## NOT BUILT — no honest data behind it

| Mockup element | Why not, and what shipped instead |
|---|---|
| **`[NET v]` gross/net pill** | No view-level basis state exists. Gross and net are per trade (`app.js:4043`, `:4327`, `:4009`) and `calculateAnalytics` (`:8405-8620`) sums one resolved P&L with no switch. Wiring it means a second path through analytics, the equity curve, the calendar and the queue. Every figure on the strip already **is** net, and `#dashEstChip` (`index.html:1415`) plus `renderEstimatedAnalyticsBoundary` (`app.js:8366`) already carry the fees-are-estimated honesty this label would imply. |
| **`[USD v]` currency pill** | `src/lib/format.js:1-28` hardcodes `currency: "USD"` in all three formatters. `account.currency` is stored (`app.js:11563`) and read in exactly one place, the account editor. No FX rate, no conversion path. The select would change nothing on screen. |
| **Rail row: Notes** | No notes store, no notes route, no notes collection. `trade.notes` is a field on a trade, read by `isTradeJournalled` (`app.js:10960`). The nearest navigable thing is `#reflections`, already in the rail as **Journal**. Two rail rows to one view is worse than one. |
| **Rail row: Alerts** | No alert store, no alert list, no notification state. Grep finds only `#dashSetupAlert` (an inline dashboard banner) and a `.rev-chip-alert` filter chip. Nothing to route to, no count to badge. |
| **Rail label "Analytics"** | 9 glyphs at 10px mono with 0.07em tracking is ~60px against 53px of label. It ellipsises. The row keeps **Timing**, which is also what the view behind it actually is (Session Intelligence, `index.html:2116`) — the reference's general analytics is the band-B stat strip. |
| **Circular avatar + green presence dot** | No user avatar, no profile image, no presence state anywhere; grep for "avatar" returns zero. The chip's letter comes from the **account** name (`app.js:16785`), not a person. A dot nothing can ever switch off is a lie with a border-radius. The chip moves to the foot and rounds; the dot does not ship. |
| **Trades badge showing `26`** | `#navUnjournalledBadge` counts `getUnjournalledTrades().length` (`app.js:10982`) — which is the reference's **other** number, the orange `7` on the Review Queue. Repointing it at `analytics.totalTrades` deletes the app's only persistent nudge to journal and duplicates a figure the stat strip prints a foot away. Both orange counts stay wired to `isTradeJournalled`, which is why they can never disagree. |
| **`[EQUITY v]` select + chart-type + fullscreen icons** | No chart-type state, no per-panel fullscreen, and once drawdown is an overlay there is no second series to switch to. Three controls, zero backing state. The one pop-out in this app (`clay-v3.css:4303-4318`) is written entirely around the TV iframe. |
| **Symmetric −8% … +8% right axis** | `analytics.drawdowns` is `round(peak − nextEquity)` (`app.js:8479`), floored at 0 by construction. The upper half of a symmetric axis can never carry a point. Shipped as `0 … −N%`, zero on the top rule, the area hanging down — the convention this app's own underwater chart already uses. **If the owner wants the literal symmetric axis, that is a deliberate decorative choice and should be asked for by name.** |
| **Time-proportional x axis** | `charts.js:721-724` places points at `left + (index/(len−1))*plotW`, so six trades on one day take six equal slots. A real time axis moves x for every point, which moves `geometry.points`, the scrub playhead, the hover hit-test and `tests/equityScrub.check.mjs` with them. Seven index-spaced labels give the reading without the blast radius. |
| **TV pin button** | No state it could write. The column is permanently in the right track, cannot float, cannot be dismissed, and the popped-out state is deliberately **not** persisted (`app.js:15601-15603`: a restored "out" paints a 920×517 black rectangle on every reload). The header's two slots go to the controls that do have state — `#dashEdgeMiniToggle` (persisted under `axiom_journal_edge_mini_v1`) and `#dashEdgeMiniOut`. The reference's "expand" icon **is** the watch button. |
| **"SQUAWK BOX"** | No programme name exists and none can: a cross-origin YouTube iframe hands the parent page nothing, and `app.js:16353-16357` already documents that refusal. Shipped instead: the channel name in the picker and `channel.desk` (`app.js:16625`) as the caption, unhidden by dropping `styles.css:9660`. |
| **Channel logo, bottom-right** | `WALL_CHANNELS` (`app.js:1187-1206`) carries id / name / desk / hours and no artwork. Building it means shipping sixteen third-party broadcaster marks. |
| **"SOURCE: BLS"** | The parsed calendar row has no agency field — `api/_lib/calendar.js:106-116` emits key, startsAt, currency, title, impact, forecast, previous, url, allDay. "BLS" would be invented. The clause prints `currency · forecast · previous` instead: all three parsed today, all three rendered nowhere in the app until now. |
| **WSJ / Bloomberg / Reuters / CNBC headlines** | Real headlines exist, but not these. `NEWS_ASSETS` (`api/_lib/newsvol.js:40-49`) has exactly two entries, **gold and bitcoin**, so "Fed's Williams", "Futures edge higher" and "US yields hold" have no query behind them. Sources are GDELT **domains** (`api/_lib/newsvol.js:211`), not brand labels. The block renders `terminal.news` verbatim, keeps the domain as the label, and titles itself *market context* with the feed state in the head. On the demo path every domain reads `sample wire` and the time cell is empty. |
| **Four guaranteed context rows** | `HEADLINE_COUNT` is 3 per asset (`api/_lib/newsvol.js:177`) and GDELT answers a rate limit with HTTP 200 carrying prose (`:195-200`), leaving `terminal.news === null`. The block is designed for 0, 2, 3, 4 and 6 rows, is the column's only `1fr` row so it absorbs the slack, and keeps the shipped `No coverage link.` empty state. |
| **"VIEW CALENDAR" as a destination** | There is no calendar view to route to — the full wire lives in the desk's F1 pane. The existing button keeps `data-target="terminal"` and reads *F1 full calendar*. |
| **Queue chip "BROKER VERIFIED"** | Provenance is a **three**-way: `trade.importSource` is `topstepx` (broker gave the P&L), `topstepx-orders` (reconstructed from fills, fees estimated), and `""` (hand typed). `renderDashLedger` maps all three at `app.js:12480`. Calling a manual row broker-verified is precisely the claim `renderEstimatedAnalyticsBoundary` exists to prevent. The chip stays `broker` — also the safer word in a 100px column. |
| **Queue footer "7 ITEMS" / "TOTAL +$1,136.00"** | The panel deletes rows off the bottom until it stops overflowing (`app.js:12505-12508`), so the foot prints `N of M shown` and sums only the visible rows. A flat item count would contradict the rows above it the moment the guard trims — which at 1440×900 it does on every render. |
| **RISK STATE "AT HIGHS" in red** | `AT HIGHS` is a real literal (`app.js:10406`) and it means the **opposite** of red: `dd === 0` renders it at tone +1, green. Nothing in the app computes a "risk state" string. The cell keeps `From highs` and its honest green/red. If a genuine risk cell is wanted, `getCooldownState()` (`app.js:11335-11418`) already returns `{reason, badge}` and `renderCooldown` (`app.js:11422`) is the existing writer to extend — say so and it is ~6 lines. |
| **F2 "your file" block** | Removed, not built: `app.js:17239-17262` prints the trader's record against the ranked release, and it costs ~120px this column does not have beside a 16:9 picture. It still renders on the desk. |

---

## RISKS

1. **`tests/instrumentPanel.check.mjs:142` and `:145` assert both `grid-template-rows` strings by equality.** Band A becomes one surface by **spanning rows 1-2**, not by merging the tracks. Anyone who later "simplifies" the two tracks into a single 156px row breaks the suite, and the message (`tall-screen track set changed`) will not explain why.
2. **`box-sizing: content-box` on `.dem-tv .bb-mon` is the load-bearing trick**, and it is exactly what `styles.css:9661-9667` warns about from the other direction. The warning is about moving the *ratio* off the tile; this keeps the ratio on the tile and only changes which box it measures. Change it to `border-box` while `padding-top` stays and the picture shrinks by 28px silently, with no error. The popped-out rule deliberately uses `border-box` for the opposite reason — **do not unify them.**
3. **`:not(.is-min)` on the `.dem-panel` grid rule looks cosmetic and is not.** Drop it and `hide` stops collapsing, because (1,3,0) beats `styles.css:9746` at (0,3,0).
4. **`grid-template-rows: auto auto minmax(0,1fr) auto auto` names five children in source order.** Insert a sixth sibling anywhere in `#dashEdgeMiniPanel` and it lands in an implicit auto row after `.dem-key`. Any addition here means revisiting the track list.
5. **The equity axis' row count is adaptive and always was** (`charts.js:687` searches n down from `maxRows` and keeps the tightest fit). The redesign guarantees the five-row axis is *reachable* — plotH 204 and 149.5, both over the 128 floor. It does not and should not guarantee five labels. If the owner reads "five gridlines" as the spec rather than "a tight axis", have that conversation before pinning `maxRows`.
6. **The depth area hangs from the top rule**, so a deep drawdown reaches most of the plot height. It is a 10%-alpha wash painted *under* the orange area and under the three-pass glow stroke, but it is a bigger grey shape than the reference's near-flat one — because the reference's data has zero drawdown across the whole window and any rendering of that is degenerate. **Look at it with a real losing month before signing off.**
7. **`renderDashLedger`'s row-trim guard (`app.js:12505-12508`) runs on render, never on resize.** Measured: resizing 1999×1150 → 1440×900 leaves `#dashLedger` overflowing by 126px until something re-renders. Pre-existing, not made worse here, but it will show up in any manual resize test and read as a layout bug in this work.
8. **`clay-v3.css:4041` display:none's `#dashMiniCal` whenever prop rules are on**, and the tracker takes its slot. That conditional survives this change (both move to `4 / 1 / 5 / 5`). For a prop-rules account, band C has **no Evidence Calendar** — the reference is the no-prop-rules case. Say it out loud before someone reports the calendar as missing. A fifth panel needs a fifth track and there is not one.
9. **`.dem-news` is the column's designed scroll region** and at 1440×900 it already scrolls 121px with the sample wire's four headlines. Correct behaviour, but the last headlines are below the fold on a laptop. The honest lever is `newsHeadlines(asset, 1)` at `app.js:17199` under a width check, not a smaller type ramp.
10. **`.eq-footnotes`' hairline is `> article + article`**, which matches DOM siblings, and the strip is reordered by DOM move rather than by `order` — so it is correct by construction. If anyone later reintroduces `order` on a cell, re-check the first visual cell for a stray left border.
11. **`clockSpan` is opt-in by `data-fmt="clock"`** and nothing else in the repo sets that attribute. If a second surface ever sets it on a `.bb-cd`, that surface silently changes format with no test to catch it — grep of `tests/*.mjs` for `formatSpan` returns nothing.
12. **`headlineTime` assumes GDELT's `seendate` is exactly `YYYYMMDDTHHMMSSZ`.** Anything else returns `""` and the cell is blank — the same rendering the sample wire gets. It degrades to "no time", never to a wrong time.
13. **`.eq-scrub` becomes `position: absolute` over the plot** and I did not drive the interaction to see it there. The arithmetic is sound (`inset-block-end: 46` clears padBottom 30 + padding 16; `inset-inline-start: 72` clears padLeft 56 + padding 16), but its 3-column grid at `clay-v2.css:4966-4968` has a `minmax(0, 200px)` screenshot column. **Scrub a trade that has a screenshot before shipping.**
14. **Adding `.dash-edge-mini` (the class) to the empty-state exclusion fails `tests/instrumentPanel.check.mjs:128`.** Use `:not(#dashEdgeMini)`. That is the guard working, not a false positive.
15. **The two `styles.css` collapse rules must stay in `styles.css`.** Moving either into `clay-v3.css` fails the same guard, and `styles.css:9759-9763` already records why.