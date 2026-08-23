# BUILD SPEC — Boot Veil "The Mark Draws Itself"

One developer, one day. Two files touched: `index.html`, `app.js`. No new assets, no build step.

**Deltas from the winning concept, decided against the real code:**

| Change | Why |
|---|---|
| Light-theme variant folded in, non-optional | `index.html:93` sets `data-theme="light"` before paint; `clay-v3.css:163` makes `--surface-0` `#e6e8ea`. A hardcoded `#14161a` veil is the same flash, inverted. |
| Markup carries the **finished** mark; only the keyframe `from` block hides it | Every failure mode degrades toward *complete*. Reduced motion costs one rule. |
| Signature ring **dropped**; three oxide ticks do both jobs (invert spark + hold shimmer) | One element type, two jobs, one fewer keyframe. |
| `stroke-width 2.5→3.5` weight-gain **dropped** | Round-capped curve weight shifts the J bowl's optical center at 84–108px. The plate carries the weight. |
| Lift implementation lives in the **inline non-module script**, not `app.js` | Kills the TDZ landmine outright: `window.__liftBootVeil` exists before the module parses. `app.js` gets two one-liners. |
| Elapsed-time branch **dropped**; lift snaps `animation:none` then fades | The finished-state-in-markup trick makes the snap the *complete* mark for free. Optional sprint in step 6. |
| `transitionend` **dropped**; one `setTimeout` removes the node | Two removal paths racing is a bug you have to reason about. One timer plus a node-presence guard is not. |

---

## 1. THE MARKUP

### 1a. Inline `<style>` — paste into `<head>` immediately after the theme FOUC guard (`index.html`, after line 105, **before** the `<link rel="stylesheet">` tags)

```html
    <!-- BOOT VEIL — covers the boot so the landing→app swap is never seen.
         Geometry mirrors favicon.svg (?v=20260822-desknow2) and .topnav-mark.
         If the mark changes, change BOTH files. Inline on purpose: this must
         paint before styles.css finishes and before app.js parses. -->
    <style>
      #tjv {
        position: fixed;
        inset: 0;
        z-index: 2147482000; /* under the desk app's #tjGate (2147483000) */
        display: flex;
        align-items: center;
        justify-content: center;
        background: #14161a; /* --surface-0, dark */
        --tjv-ink: #e9edf1;    /* wireframe stroke */
        --tjv-plate: #e9edf1;  /* tile fill + where the outline dissolves to */
        --tjv-type: #14161a;   /* letters, once solid */
        --tjv-accent: #f0763d;
      }
      [data-theme="light"] #tjv {
        background: #e6e8ea; /* --surface-0, light (clay-v3.css:163) */
        --tjv-ink: #14161a;
        --tjv-plate: #f7f8fa;
        --tjv-type: #14161a;
      }
      html:has(#tjv) { overflow: hidden; }
      #tjv svg { width: clamp(84px, 11vh, 108px); height: auto; display: block; }

      /* The DEFAULT state of every element below is the FINISHED mark.
         Only the keyframes' `from` block hides anything, so animation:none
         (reduced motion, lift snap, an unsupported browser) shows a whole
         logo, never a blank box. */
      #tjv .s {
        fill: none;
        stroke-width: 2.5;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-dasharray: 101; /* > pathLength 100, so undashed when idle */
      }
      #tjv .l { stroke: var(--tjv-type); }        /* T and J */
      #tjv #tjv-o { stroke: var(--tjv-plate); }   /* tile outline, dissolved */
      #tjv .t { stroke: var(--tjv-accent); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 101; }
      #tjv #tjv-p { fill: var(--tjv-plate); }

      #tjv #tjv-o { animation: tjv-trace 380ms cubic-bezier(.32,0,.18,1) both,
                               tjv-vanish 160ms 850ms ease-out both; }
      #tjv #tjv-c { animation: tjv-trace 150ms 320ms cubic-bezier(.4,0,.2,1) both,
                               tjv-ink 160ms 850ms ease-out both; }
      #tjv #tjv-s { animation: tjv-trace 180ms 430ms cubic-bezier(.36,0,.14,1) both,
                               tjv-ink 160ms 850ms ease-out both; }
      #tjv #tjv-j { animation: tjv-trace 240ms 570ms cubic-bezier(.32,0,.12,1) both,
                               tjv-ink 160ms 850ms ease-out both; }
      #tjv #tjv-p { animation: tjv-plate 160ms 850ms ease-out both; }
      #tjv #tjv-t1 { animation: tjv-trace 90ms 850ms cubic-bezier(.2,0,.3,1) both,
                                tjv-shim 1600ms 1450ms ease-in-out infinite; }
      #tjv #tjv-t2 { animation: tjv-trace 90ms 890ms cubic-bezier(.2,0,.3,1) both,
                                tjv-shim 1600ms 1560ms ease-in-out infinite; }
      #tjv #tjv-t3 { animation: tjv-trace 90ms 930ms cubic-bezier(.2,0,.3,1) both,
                                tjv-shim 1600ms 1670ms ease-in-out infinite; }

      @keyframes tjv-trace  { from { stroke-dashoffset: 101 } to { stroke-dashoffset: 0 } }
      @keyframes tjv-plate  { from { opacity: 0 } to { opacity: 1 } }
      @keyframes tjv-ink    { from { stroke: var(--tjv-ink) } to { stroke: var(--tjv-type) } }
      @keyframes tjv-vanish { from { stroke: var(--tjv-ink) } to { stroke: var(--tjv-plate) } }
      @keyframes tjv-shim   { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

      /* LIFT. Frame one: every animation dies, which snaps the mark to its
         finished default. Then the ground dissolves and the tile follows it
         out, handing the eye to the topnav TJ tile in the same place. */
      #tjv.out { pointer-events: none; opacity: 0;
                 transition: opacity 220ms cubic-bezier(.33,0,.2,1) 60ms; }
      #tjv.out * { animation: none !important; }
      #tjv.out svg { opacity: 0; transform: translateY(-4px) scale(.97);
                     transition: opacity 200ms cubic-bezier(.4,0,1,1) 140ms,
                                 transform 200ms cubic-bezier(.4,0,1,1) 140ms; }

      @media (prefers-reduced-motion: reduce) {
        #tjv, #tjv * { animation: none !important; }
        #tjv.out { transition: opacity 160ms linear; }
        #tjv.out svg { transition: none; opacity: 1; transform: none; }
      }
    </style>
```

### 1b. Veil markup — **first child of `<body>`** (`index.html` line 124, above the landing comment block)

```html
    <div id="tjv" aria-hidden="true">
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <rect id="tjv-p" x="1.25" y="1.25" width="61.5" height="61.5" rx="12.75"/>
        <path id="tjv-o" class="s" pathLength="100"
              d="M32 1.25 H50 A12.75 12.75 0 0 1 62.75 14 V50 A12.75 12.75 0 0 1 50 62.75 H14 A12.75 12.75 0 0 1 1.25 50 V14 A12.75 12.75 0 0 1 14 1.25 H32"/>
        <path id="tjv-c" class="s l" pathLength="100" d="M18.5 25.5 H31.5"/>
        <path id="tjv-s" class="s l" pathLength="100" d="M25 25.5 V42.5"/>
        <path id="tjv-j" class="s l" pathLength="100"
              d="M41.5 25.5 V36.5 A5.5 5.5 0 0 1 30.5 36.5 V34.5"/>
        <path id="tjv-t1" class="t" pathLength="100" d="M24 53.5 V48.5"/>
        <path id="tjv-t2" class="t" pathLength="100" d="M30.5 53.5 V45.5"/>
        <path id="tjv-t3" class="t" pathLength="100" d="M37 53.5 V42.5"/>
      </svg>
    </div>
```

**Geometry notes.** Stroke centerline inset 1.25 from the 64 box, corner radius 12.75 (`favicon.svg`'s `rx="14"` minus the inset). Cap band 25.5→42.5 approximates 700-weight Space Grotesk at 25px on this canvas; the J bowl bottom kisses y42 (half-unit overshoot). Ticks sit on y53.5, tallest topping out exactly at the baseline 42.5. **Eyeball the T/J against the rendered `.topnav-mark` at 84–108px before committing** — the bowl radius (5.5) is the number most likely to look wrong.

### 1c. Fail-open + lift implementation — plain `<script>` immediately after the veil div

Plain, non-module, non-deferred: it must run even when the module graph 404s (which has killed this site once).

```html
    <script>
      /* Boot veil lift. Plain script on purpose — a dead module must never
         trap anyone behind the veil. app.js calls window.__liftBootVeil(). */
      (function () {
        var fired = false;
        var timer = setTimeout(lift, 2600);
        window.__liftBootVeil = lift;
        function lift() {
          if (fired) return;
          fired = true;
          clearTimeout(timer);
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              var v = document.getElementById("tjv");
              if (!v) return;
              v.className = "out";
              setTimeout(function () {
                if (v.parentNode) v.parentNode.removeChild(v);
              }, 420);
            });
          });
        }
      })();
    </script>
```

---

## 2. THE LIFT

`app.js` gets two lines. No new declarations, so no temporal-dead-zone exposure.

**Call site A** — `app.js:1308`, directly after `renderAll();` inside `init()`:

```js
  renderAll();
  // Boot veil: preview / desk-app / guest / reset-token boots have auth
  // settled here, so the first render pass IS the ready state. The web
  // owner's veil waits for checkAuthSession() below, which owns the swap.
  if (state.auth.checked && window.__liftBootVeil) window.__liftBootVeil();
```

**Call site B** — `app.js:2967`, as the last statement of `checkAuthSession()` (after the `if (state.auth.isAuthenticated) { … } else { … }` block, before the closing brace):

```js
  if (window.__liftBootVeil) window.__liftBootVeil();
}
```

That is the whole integration. The guard against `renderAll()`'s ~25 other callers is the `fired` boolean inside `lift()`, not anything at the call site — a later save-triggered `renderAll()` reaches a no-op.

Site B sits after `switchView()` and the storage loads, so the owner's veil covers the auth swap *and* the panel population. If those loads run past 2600ms the fail-open wins and the user sees the tail of the population instead of the whole thing — acceptable, and the fail-open is non-negotiable.

---

## 3. CUTOFF AND HOLD

| t | On screen |
|---|---|
| 0 | Veil painted. Ground already matches `--surface-0` in both themes. |
| 0–380 | Tile outline traces clockwise from 12 o'clock, sprinting the top-right corner, easing home. |
| 320–470 | T crossbar, left to right (starts 60ms before the outline lands — a real pen does not wait). |
| 430–610 | T stem, top to bottom, slight gravity into the baseline. |
| 570–810 | J: down the stem, decelerating through the bowl, tail tick at 810 is the drawing's period. |
| 850–1010 | **The invert.** Plate fades in, outline dissolves into it, letters go gunmetal. Wireframe becomes object. |
| 850–1020 | Three oxide ticks strike up off the baseline, 40ms apart. The desk stamped it. |
| 1450→ | **Hold.** The solid mark stands still; only the three ticks breathe, brightening left to right on a 1600ms loop. Opacity only — no `stroke-dashoffset` repaint while a 665KB module parses. No quantity, no accumulation, nothing readable as a percentage. |

**Cut at ~400ms (fast boot / desk app).** `animation: none` snaps every element to its markup default, which is the finished solid mark, then the fade starts 60ms later. The user sees the tile complete itself and leave. There is no "mid-stroke" frame to design around — the snap *is* the completion. Even a cut at 50ms reads as a stamp, not a broken drawing.

**Lift at ~900ms (typical web owner).** Letters are drawn, the invert is mid-flight; the snap finishes it and the mark leaves solid.

**2600ms fail-open.** The ticks are mid-shimmer. Opacity is interpolating, so the whole-veil fade exits cleanly from any phase.

**The lift itself, 340ms total from the call:** at +0 the mark snaps solid and pointer events die; at +60 the gunmetal ground begins dissolving (220ms). Because the ground is the app's own `--surface-0` in both themes, that fade is nearly invisible. At +140 the tile lifts away (200ms, up 4px, down to 0.97 scale) — it is the *last* thing to leave, over an app already in place, so the eye hands the mark to the identical topnav TJ tile in roughly the same optical position. Node removed at +420 by a single timer with a parent-node guard.

---

## 4. REDUCED MOTION

Two rules, already in the block above. `animation: none` on the veil and all descendants means frame one is the finished mark: off-white tile, gunmetal TJ, three oxide ticks, static. Nothing traces, nothing shimmers. At lift the whole veil goes `opacity: 1 → 0` over 160ms linear with no transform and no snap beat; the mark simply disappears. This costs one media query because the markup already *is* the finished state.

---

## 5. THE DESK APP

The shell bundles the site byte-identical, so the veil ships with it and needs no site-side change. Three shell notes:

1. **Nothing to inject.** `gate.js` runs at `documentStart` at `z-index: 2147483000`; the veil is `2147482000`, so the passcode gate correctly covers the veil and the veil lifts behind it. No ordering work.
2. **The lift fires early here.** `file://` → `isLocalPreviewMode()` → `state.auth.checked = true` before `renderAll()`, so call site A lifts the veil right after the first render — typically well under 400ms. This is the snap path; verify it looks like a stamp and not a flicker on a warm launch.
3. **One-line shell fix, optional but correct.** `shell/main.swift:192` sets the window/`underPageBackgroundColor` to `#14110f` (warm, a V2 leftover). The veil is `#14161a`. Change the Swift value to `0x14/0x16/0x1a` so the pre-WebView flash, the veil, and the app ground are one color. Same for `#tjGate`'s `background:#14110f` in `gate.js:21`. Purely cosmetic; skip if you would rather not rebuild the app today.

---

## 6. VERIFY

Run these, in this order, before calling it done.

1. **Paints before stylesheets.** DevTools → Network → block `styles.css`, `clay-v2.css`, `clay-v3.css`. Reload. Assert: full-viewport `#14161a` with a centered drawing mark, no landing markup visible at any point.
2. **Lifts after the real render.** Logged in, Network throttled to Slow 3G. Assert: the marketing hero is never visible; the veil is removed only after the dashboard panels are populated. In the Performance panel, `#tjv` removal timestamp > the last `renderAll` frame.
3. **Fail-open with the module dead.** Block `app.js` in DevTools. Reload. Assert: the veil lifts at ~2600ms ±100 and `document.getElementById('tjv')` returns `null` at 3200ms. The landing must be interactive after the lift.
4. **No scroll under the veil.** With the veil up, mouse-wheel and press End/Space. Assert `window.scrollY === 0` and `getComputedStyle(document.documentElement).overflow === 'hidden'`. After lift, assert it is back to `visible`.
5. **Light theme.** `localStorage.setItem('axiom_journal_theme_v1','light')`, reload. Assert: no black frame at any point — veil ground `#e6e8ea`, wireframe strokes gunmetal, plate `#f7f8fa`. Screenshot frame 1 and frame at 1200ms.
6. **Reduced motion.** macOS → Reduce Motion on. Assert: the very first painted frame is the solid finished mark (no tracing at all, capture with the Performance panel's screenshot strip), and lift is a plain 160ms fade with no transform.
7. **Idempotence.** With the veil already removed, run `window.__liftBootVeil()` in the console, then log a trade (triggers `renderAll`). Assert: no console error, nothing re-appears.
8. **Fast boot.** Desk app cold launch, screen-record at 60fps. Assert: no frame shows a partially drawn logo followed by nothing — the last mark frame before the fade is always the complete solid tile.

---

## 7. BUILD ORDER

1. **Veil markup + inline style, static.** Paste 1a and 1b. Comment out every `animation:` line. Load the page: a full-screen veil with the finished solid mark that never goes away. Fix the geometry here — compare side by side against `.topnav-mark` at 108px and adjust the J bowl radius and cap band until it reads as the same logo. Nothing else matters until the mark is right.
2. **Fail-open only.** Paste 1c. Reload: the veil lifts at 2600ms. You now have a shipping-safe veil with zero animation and zero coupling to `app.js`.
3. **The two `app.js` call sites.** Verify checks 2 and 3. At this point the bug this exists to kill is dead — everything after is craft.
4. **Turn the animations on.** Uncomment the `animation:` lines and the keyframes. Verify checks 1, 5, 6, 8.
5. **Light theme + reduced motion pass.** Checks 5 and 6 with real screenshots, both in the browser and the desk app.
6. *(Optional, only if step 4 leaves the snap looking abrupt on real fast boots.)* Replace the snap with a sprint: before adding `.out`, freeze each path at its computed `stroke-dashoffset`, kill the animation, then next frame transition it to 0 over 110ms `cubic-bezier(.2,0,0,1)` and delay the fade by 110ms. Four lines in `lift()`. Do not build this speculatively — measure the real lift timings in the desk app first, because it only ever runs on boots faster than 1010ms.

Skipped: the elapsed-time branch, the signature ring, the `transitionend` listener, and the stroke-width weight gain. Add the sprint at step 6 only if the snap actually reads badly on the desk app's warm launch.