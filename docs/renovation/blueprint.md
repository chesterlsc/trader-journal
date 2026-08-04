# Trader Journal — Renovation Blueprint

## 1. Chosen design direction: Institutional Terminal

**Winner by unanimous panel vote (3–0, 42/50 from all three judges).**

The current UI cosplays a trading terminal; the renovation makes it one. All theatre is deleted — the two `blur(60px)` ambient blobs, the ~15 panel gradients, the infinite `brandAccentPulse`, the hover lifts and text-shadows — and replaced with the discipline that earns trust in real market infrastructure: a neutral graphite surface ramp (four flat elevations separated by 1px hairlines, never shadows), one accent blue used only for interaction (active nav, focus ring, primary CTA, equity line), and P&L green/red reserved exclusively for money. If a color appears, it means something.

The identity is typographic: JetBrains Mono with `tabular-nums` on every numeral in the product. Numbers align, never jitter on update, and read as instrument output. Sora stays for headings only. Radii tighten from 18–22px pillows to 4–10px precision corners. The motion budget is inverted — entrance theatrics deleted, spend moved to data motion: directional tick flashes on price updates, a one-time count-up on dashboard arrival, chart draw-in, skeletons.

**Grafts applied (final, all rulings made):**

1. **Ledger's designed empty states** — line icon, "No trades yet", primary "Log your first trade" CTA wired to `switchView('trade-entry')`, replacing twelve $0.00 cards. Ships at launch.
2. **Clickable calendar days** — day cells become real buttons that set journal `dateFrom`/`dateTo` and switch to the journal view.
3. **Ledger's calendar intensity ramp** — 4-step `color-mix()` heat toward `--pnl-pos`/`--pnl-neg` (with static rgba fallback lines), replacing the binary soft tint.
4. **Ledger's data-hash guard** — chart draw-in and count-up replay only when a dataset hash changes, never on the 2s poll. Adopted verbatim as the mechanism.
5. **Metric delta chips** — vs-previous-period pill under each metric value using the existing P&L soft tokens, mono 11px. Ships at launch (S effort; two of three judges adopted it, and it violates nothing).
6. **Obsidian Glass's opaque-inputs rule** — codified as a written token contract: text-entry surfaces always sit on `--surface-inset` (opaque). Never translucency behind text being typed.
7. **Obsidian Glass's segmented Long/Short toggle** — active fills `--pnl-pos-soft`/`--pnl-neg-soft`; consistent with the rule that P&L color only ever means money.
8. **Form-shake on invalid submit** — 4px, 240ms, offending field only; border-flash fallback under reduced motion. The one earned exception to the no-theatrics rule.
9. **Ledger's theme-crossfade** — temporary `html.theme-switching` class transitioning background/color/border for ~250ms around the `data-theme` flip; skipped under reduced motion.
10. **Ledger's reduced-motion pattern** — duration tokens zeroed inside the media query *in addition to* the global kill block, so all future motion is compliant by construction.
11. **Obsidian Glass's `--pl-intensity`** — clamped `|dayPnl| / dailyLossLimit`, but expressed in Terminal language: it drives the balance card's signed left hairline width (2px→4px) and opacity, **not** a glow.
12. **Ledger's WCAG AA QA gate** — operationalized as a sign-off checklist (see Phase 7).
13. **Ledger's live-pulse dot** — 6px dot on open positions in the landing tape; the **only** infinite animation in the product; static dot under reduced motion.
14. **Obsidian Glass's "desk stays alive"** — the landing auth modal opens over the still-ticking public trades board.

## 2. FINAL design tokens

```css
/* ==========================================================================
   Trader Journal — Institutional Terminal tokens (FINAL)
   Dark is default (:root, no attribute). Light via <html data-theme="light">.
   Charts read tokens via getComputedStyle(document.documentElement);
   re-read on 'themechange'. Legacy aliases keep existing rules resolving
   during the literal sweep — delete the alias block when the sweep is done.
   CONTRACT NOTES:
   - Accent (--accent) means interaction only: active nav, focus, primary CTA,
     chart line. Nothing else.
   - --pnl-* means money only. Never decoration.
   - Text-entry surfaces always use --surface-inset (opaque). Never
     translucency behind text being typed.
   ========================================================================== */

:root {
  color-scheme: dark;

  /* Surfaces — neutral graphite ramp, no blue cast */
  --surface-0: #08090b;        /* page */
  --surface-1: #0e1014;        /* panels, cards */
  --surface-2: #13161c;        /* nav, modal, raised */
  --surface-3: #1a1e26;        /* hover / active fill */
  --surface-inset: #0a0c0f;    /* inputs, table heads, wells — ALWAYS OPAQUE */

  /* Hairlines */
  --line: #21252e;
  --line-strong: #2f3542;
  --line-accent: rgba(91, 141, 239, 0.45);

  /* Text */
  --text: #e9ecf2;
  --text-soft: #9aa2b4;
  --text-faint: #6b7386;       /* labels only, never below 11px / weight 600 */
  --text-inverse: #0b0d10;

  /* Accent — one hue, interaction only */
  --accent: #5b8def;
  --accent-strong: #7da5f5;
  --accent-muted: rgba(91, 141, 239, 0.12);

  /* P&L — money colors, used for nothing else */
  --pnl-pos: #2fd18c;
  --pnl-pos-soft: rgba(47, 209, 140, 0.12);
  --pnl-pos-line: rgba(47, 209, 140, 0.38);
  --pnl-neg: #f5537a;
  --pnl-neg-soft: rgba(245, 83, 122, 0.12);
  --pnl-neg-line: rgba(245, 83, 122, 0.38);
  --pnl-flat: var(--text-soft);

  /* P&L intensity — JS sets clamp(|dayPnl| / dailyLossLimit, 0, 1) on the
     balance card; drives signed-hairline width/opacity, never a glow */
  --pl-intensity: 0;

  /* Status */
  --warn: #f0b34e;
  --warn-soft: rgba(240, 179, 78, 0.12);
  --info: #4cc3e8;
  --info-soft: rgba(76, 195, 232, 0.12);

  /* Charts — canvas reads these; nothing hard-coded in charts.js */
  --chart-grid: #1b1f27;
  --chart-axis: #6b7386;
  --chart-line: var(--accent);
  --chart-fill: rgba(91, 141, 239, 0.10);
  --chart-pos: var(--pnl-pos);
  --chart-neg: var(--pnl-neg);
  --chart-radar: var(--info);
  --chart-font-size: 11;       /* px, unitless for canvas */
  --chart-font-family: "JetBrains Mono", ui-monospace, monospace;

  /* Type */
  --font-ui: "Sora", "Manrope", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace;
  --fs-micro: 11px;            /* badges, kickers — the floor */
  --fs-label: 12px;
  --fs-data: 13px;             /* table numerals */
  --fs-body: 13.5px;
  --fs-md: 15px;
  --fs-lg: 18px;
  --fs-h2: 22px;
  --fs-metric: 26px;
  --fs-hero: clamp(2rem, 4.5vw, 3.25rem);

  /* Spacing — 4px base */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px;
  --space-8: 32px; --space-10: 40px; --space-12: 48px;

  /* Radius — terminal, not bubble */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 10px;
  --radius-pill: 999px;

  /* Elevation — hairline first, shadow second */
  --shadow: 0 1px 0 rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
  --shadow-modal: 0 24px 64px rgba(0, 0, 0, 0.55);
  --edge-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  --focus-ring: 0 0 0 2px var(--surface-0), 0 0 0 4px var(--accent);

  /* Z-index */
  --z-nav: 100;
  --z-dropdown: 200;
  --z-overlay: 900;
  --z-modal: 1000;
  --z-toast: 1100;

  /* Motion */
  --dur-instant: 90ms;
  --dur-fast: 140ms;
  --dur-base: 200ms;
  --dur-slow: 320ms;
  --dur-tick: 480ms;
  --dur-draw: 640ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --ease-in-out: cubic-bezier(0.45, 0, 0.15, 1);
  --ease-snap: cubic-bezier(0.3, 1.1, 0.3, 1);

  /* Legacy aliases — existing rules keep resolving during the sweep.
     DELETE THIS BLOCK when the literal sweep completes. */
  --bg: var(--surface-0);
  --bg-alt: var(--surface-1);
  --panel: var(--surface-1);
  --panel-strong: var(--surface-2);
  --panel-muted: var(--surface-3);
  --green: var(--pnl-pos);
  --red: var(--pnl-neg);
  --blue: var(--accent);
  --cyan: var(--info);
  --amber: var(--warn);
  --violet: var(--accent);     /* retired hue */
  --text-main: var(--text);    /* fixes undefined var, styles.css:1359,1633 */
}

/* Light theme — only raw values override; every var()-referencing token
   (aliases, --chart-pos, --chart-line…) follows automatically.
   All values below are pre-checked: 4.5:1 body / 3:1 large numerals. */
[data-theme="light"] {
  color-scheme: light;

  --surface-0: #f4f5f7;
  --surface-1: #ffffff;
  --surface-2: #ffffff;
  --surface-3: #edf0f4;
  --surface-inset: #eceef2;

  --line: #dcdfe6;
  --line-strong: #c2c8d3;
  --line-accent: rgba(38, 88, 199, 0.5);

  --text: #171a21;
  --text-soft: #4c5567;
  --text-faint: #737b8c;
  --text-inverse: #ffffff;

  --accent: #2658c7;
  --accent-strong: #1c47a8;
  --accent-muted: rgba(38, 88, 199, 0.09);

  --pnl-pos: #0c8a58;
  --pnl-pos-soft: rgba(12, 138, 88, 0.10);
  --pnl-pos-line: rgba(12, 138, 88, 0.35);
  --pnl-neg: #cf2f58;
  --pnl-neg-soft: rgba(207, 47, 88, 0.09);
  --pnl-neg-line: rgba(207, 47, 88, 0.35);

  --warn: #a86e0e;
  --warn-soft: rgba(168, 110, 14, 0.10);
  --info: #0d7395;
  --info-soft: rgba(13, 115, 149, 0.10);

  --chart-grid: #e4e7ed;
  --chart-axis: #737b8c;
  --chart-fill: rgba(38, 88, 199, 0.08);

  --shadow: 0 1px 2px rgba(23, 26, 33, 0.06), 0 8px 24px rgba(23, 26, 33, 0.07);
  --shadow-modal: 0 24px 64px rgba(23, 26, 33, 0.18);
  --edge-highlight: none;
  --focus-ring: 0 0 0 2px var(--surface-1), 0 0 0 4px var(--accent);
}

/* Theme crossfade (graft) — JS adds .theme-switching before flipping
   data-theme, removes it ~300ms after. Skipped when reduced motion. */
html.theme-switching,
html.theme-switching *,
html.theme-switching *::before,
html.theme-switching *::after {
  transition: background-color var(--dur-base) var(--ease-in-out),
              color var(--dur-base) var(--ease-in-out),
              border-color var(--dur-base) var(--ease-in-out) !important;
}

/* Reduced motion — belt AND suspenders (graft: zeroed duration tokens make
   future motion compliant by construction; global block catches strays).
   JS mirrors with matchMedia('(prefers-reduced-motion: reduce)') for
   count-up / draw-in / ticks / crossfade. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-instant: 0.01ms; --dur-fast: 0.01ms; --dur-base: 0.01ms;
    --dur-slow: 0.01ms; --dur-tick: 0.01ms; --dur-draw: 0.01ms;
  }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## 3. Typography & fonts

Keep Sora + JetBrains Mono (the map's strongest asset), tokenized. Manrope is dropped from the download (fallback stack only).

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Roles.** Sora 600/700: view headings, hero, brand mark, modal titles — nothing else. JetBrains Mono: everything numeric or systemic — 400 body-data, 500 table cells, 600 labels/badges/buttons/kickers, 700 metric values. Rule: **if it's a number or an uppercase label, it's mono.**

**Scale.** `--fs-micro` 11px (uppercase, letter-spacing 0.08em — hard floor; raises all 0.56–0.65rem text at styles.css:333/431/485/2866) · `--fs-label` 12px · `--fs-data` 13px · `--fs-body` 13.5px · `--fs-md` 15px · `--fs-lg` 18px · `--fs-h2` 22px Sora 700 ls -0.01em · `--fs-metric` 26px mono 700 · `--fs-hero` clamp Sora 700 ls -0.015em.

**Signature rule.** `body { font-variant-numeric: tabular-nums; }` plus explicit `font-feature-settings: "tnum"` on `.metric-value`, `td`, `.live-price`, `.calendar-day`. The 60+ `font:` shorthands are replaced with token references during the sweep.

## 4. Component treatments (final)

**Nav** (desktop `.desktop-nav` + mobile sidebar). Flat `--surface-2`, `border-bottom: 1px solid var(--line)`, sticky, `z-index: var(--z-nav)`, **no backdrop blur anywhere in the product**. `.nav-btn`: mono 600 12px uppercase ls 0.06em, `--text-soft`, padding 8px 12px, radius `--radius-md`; hover `--surface-3` + `--text` (140ms). Active = `--text` + `box-shadow: inset 0 -2px 0 var(--accent)` (underline rail, not pill) + `aria-current="page"`. Sidebar variant uses a 2px inset left rail. Theme toggle + UTC clock chip (mono 11px `--text-faint`) in `.desktop-nav-actions`. `brandSettle`/`brandAccentPulse` deleted; brand mark static Sora 700 with accent word in `--accent`.

**Metric cards** (×12). Flat `--surface-1`, 1px `--line`, radius `--radius-lg`, padding `--space-4`, `--edge-highlight` only — all gradients deleted. Label: mono 600 11px uppercase `--text-faint`. Value: mono 700 `--fs-metric` tabular-nums. Money metrics get JS classes `.is-pos`/`.is-neg` → colored value + signed left hairline `border-left: 2px solid var(--pnl-pos-line|neg-line)`. **Balance card only:** hairline width is `calc(2px + var(--pl-intensity) * 2px)` and line opacity scales with `--pl-intensity` — sign-at-a-glance without a glow. **Delta chip** (graft): `span.metric-delta` under the value — mono 11px, radius `--radius-sm`, `--pnl-pos-soft`/`--pnl-neg-soft` bg, vs-previous-period. Grid `repeat(auto-fill, minmax(180px, 1fr))` gap `--space-3`. profitFactor 999 sentinel renders `∞` (mojibake fix rides along). **Empty state** (graft): zero trades replaces the card wall with a centered block — 48px inline SVG line icon in `--text-faint`, "No trades yet" (Sora 600 `--fs-lg`), one-liner in `--text-soft`, primary "Log your first trade" button → `switchView('trade-entry')`.

**Panels** (~15 gradient variants → one recipe). `background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius-xl); padding: var(--space-5)`. Nested wells: `--surface-inset`. Section kickers: mono 600 11px uppercase `--text-faint` over a 1px `--line` bottom rule. The `::after` "Hide/Expand/Show more" copy (styles.css:1382, 1872) moves into real `<span>` text.

**Tables** (13-col journal, edge-detection, admin). `thead th`: sticky top 0, `--surface-inset`, mono 600 11px uppercase `--text-faint`, border-bottom 1px `--line-strong`. `td`: mono 500 `--fs-data`, padding 8px 10px, border-bottom 1px `--line`; numeric columns right-aligned + tabular-nums; P&L cells colored **text only** — no cell backgrounds. Row hover `--surface-3`, no translate. Live-price cells get `.live-cell` + `data-symbol`/`data-live-field` so the 2s tick patches `textContent` in place. Keep the ≤900px `td::before` card transform; labels restyled mono 11px `--text-faint`. The 900–980px dead zone closes by applying `overflow-x: auto` on the wrapper from 981px down. Click-to-sort headers ship with the feature list.

**Forms.** Inputs/selects/textarea: `--surface-inset` (opaque — token contract), 1px `--line`, radius `--radius-md`, mono 400 `--fs-body`, padding 9px 11px; focus = `border-color: var(--accent)` + `box-shadow: var(--focus-ring)`, instant. `color-scheme` makes native date/month pickers follow the theme; delete the 9999s webkit-autofill hack. Labels mono 600 12px `--text-soft`. Validation: `--pnl-neg` border + 11px mono message + **form-shake** (graft — see motion). **Long/Short direction** (graft): segmented control, two buttons in one hairline-bordered track; active Long = `--pnl-pos-soft` fill + `--pnl-pos` text, active Short = `--pnl-neg-soft` + `--pnl-neg`. Native datalist/date inputs kept.

**Buttons.** Primary: `--accent` bg, `--text-inverse`, mono 600 12.5px, radius `--radius-md`, padding 10px 16px; hover `--accent-strong`; active `translateY(1px)` (press down — all hover lifts deleted). Secondary: `--surface-2` + 1px `--line-strong`; hover accent border. Destructive: transparent + `--pnl-neg` text, hover `--pnl-neg-soft` bg. All: `:focus-visible { box-shadow: var(--focus-ring) }`. Async buttons `.is-pending` → opacity .6, pointer-events none, label "Saving…" (kills auth double-submit).

**Modals.** Overlay `rgba(4,5,8,0.65)` (light: `rgba(23,26,33,0.35)`), no blur, fade `--dur-base`. Panel: `--surface-2`, 1px `--line-strong`, radius `--radius-xl`, `--shadow-modal`; enter opacity + scale(0.98→1) `--dur-base` `--ease-out`. Focus trap + Escape + return-focus-to-trigger. On the landing page the auth modal opens **over the still-ticking public trades board** (graft) — the desk stays alive while you sign in.

**Calendar.** Grid with `gap: 1px` on `--line` background, cells `--surface-1` — hairline grid without borders. Date mono 11px `--text-faint` top-right; P&L mono 600 13px tabular-nums colored. **Intensity ramp** (graft): JS stamps `--day-intensity` (0–1) per cell; `background: color-mix(in srgb, var(--pnl-pos) calc(var(--day-intensity) * 18%), var(--surface-1))` in 4 clamped steps (mirror for losses), with a static `background: var(--pnl-pos-soft)` fallback line above it for non-color-mix browsers. Today: `inset 0 0 0 1px var(--accent)`. **Cells are `<button>`s** (graft): click sets `state.filters.dateFrom/dateTo` and switches to the journal view; hover/focus affordance on non-empty days. ≤760px: vertical agenda list of nonzero days reusing the same cell classes.

**Landing.** Both ambient blobs deleted; `body::before` becomes a 24px dot grid (`radial-gradient(var(--line) 1px, transparent 1px)`, 24px pitch, opacity 0.5, edge-masked) — GPU-cheap, kills mobile-Safari fixed-blur jank. Monochrome hero: mono 11px uppercase preheadline with a 6px `--pnl-pos` **live-pulse dot** (2s opacity pulse — the only infinite animation in the product; static under reduced motion), Sora 700 clamp headline, one primary CTA (accent appears exactly once above the fold) + hairline secondary. The recent-trades board becomes the product demo: terminal tape rows — flat `--surface-1`, hairlines, mono tabular columns, P&L colored text, live prices ticking with the same `pnl-tick` flash the app uses. The hard-coded "Verified Vantage Trades" pill is replaced by an honest mono tag: `LIVE FEED · DELAYED 2s`. Meta description, OG tags, and dual `theme-color` (`#08090b` / `#f4f5f7`) ship in the same pass.

**Toasts/badges.** Toast: fixed bottom-right, `--surface-2`, 1px `--line-strong`, radius `--radius-lg`, `--shadow-modal`, `--z-toast`, enter translateY(8px)+fade. Badges/result pills: mono 600 11px uppercase, radius `--radius-sm` (rectangular tags, not 999px pills), semantic-soft bg + 1px semantic-line border.

## 5. Motion system — final inventory

One easing family, everything 90–640ms, every duration a token. JS gates share one helper: `const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches`.

| Name | What | Duration / easing | Reduced motion |
|---|---|---|---|
| **pnl-tick** (flagship) | Value change flashes cell bg `--pnl-pos-soft`/`--pnl-neg-soft` → transparent; class re-added on each change, removed on `animationend`. Applies to `.live-cell`, hero tape, progress cards, money metrics. **Hard dependency: the targeted-textContent patch — ships with or after it, never before.** | `--dur-tick` 480ms `--ease-out`, 1 iteration | Snaps (ends transparent — harmless at 0.01ms) |
| **count-up** | Metric values tween old→new, rAF ease-out cubic; fires on dashboard entry or **dataset-hash change** (graft) — never on the 2s poll. tabular-nums = zero layout shift. | 600ms | Set final value directly |
| **chart-draw** | Equity/drawdown clip-reveal left→right, bars scale from baseline (24ms stagger), radar radius interpolates. Guarded by dataset hash; also fires on themechange (with token re-read). | `--dur-draw` 640ms ease-out-cubic in JS | progress = 1, single frame |
| **view-enter** | 4px rise + fade on `.view.is-active` (retimed fadeUp). No exit animation. | `--dur-base` 200ms `--ease-out` | Killed by global block |
| **skeleton-pulse** | `--surface-3` blocks in metric cards + table rows during journal load / auth restore; opacity 0.45 at 50%. | 1.2s `--ease-in-out` infinite (removed on data arrival) | Static block |
| **hover/press** | background/border/color only, no transforms. Button `:active` translateY(1px). | `--dur-fast` 140ms / `--dur-instant` 90ms | Killed |
| **modal** | Overlay fade; panel opacity + scale(0.98→1). | `--dur-base` `--ease-out` | Killed |
| **form-shake** (graft) | 4px horizontal, 3 cycles, offending field only, on invalid submit. | 240ms | Border flash only |
| **theme-crossfade** (graft) | `.theme-switching` class transitions background/color/border around the `data-theme` flip; charts repaint at t=1. | ~250ms `--ease-in-out` | Skipped entirely (instant flip) |
| **live-pulse** (graft) | 6px dot on open positions in landing tape. **The only infinite animation in the product.** | 2s ease-in-out infinite | Static dot |
| **focus** | `:focus-visible` ring appears with no transition — instant feedback is the institutional tell. | 0ms | n/a |
| **Deletions** | `brandAccentPulse` (infinite glow), `brandSettle`, all hover translateY/translateX lifts, hero h2 hover text-shadow. | — | — |

Reduced-motion coverage: zeroed duration tokens + global kill block (CSS) + `REDUCED` guard (JS) = compliant by construction. Coverage goes from 1 element to everything.

## 6. Feature work list

### Ship now (priority order)

1. **Security hardening batch — mandatory first** (M). CSRF token via `session` action, checked in the POST router; SameSite=Lax/secure/httponly cookie params + `session_regenerate_id()` at login (trade_handler.php:4, 83-108); DB-backed rate limit on login/forgot_password reusing `login_info` (1108-1126); auth required on `update_prices` (214-220); LIMIT + field whitelist (asset/direction/result/date only — no prices/P&L) on `public_recent_trades` (1570-1617); `.dockerignore` excluding db/, scripts/, data/users.json (Dockerfile:7-11); env-gate the bootstrap-admin fallback (973-1020) and the localhost auth bypass (app.js:639-642); stop APP_DEBUG returning reset URLs and raw exceptions (121-123, 2066-2074).
2. **Design-system rebuild, dark + light** (L). The token block above replaces styles.css:1-21; sweep ~200 rgba literals, 15 gradients, 60+ font shorthands; theme toggle + FOUC-guard inline head script; charts read all colors via `getComputedStyle` (replaces charts.js:14-24, 81-82, 105, 187, 417); fixes `--text-main`, 11px floor, radius/spacing tokens.
3. **Kill the 2-second full innerHTML rebuild** (M). Tag live cells (`tradeDisplay.js:204-235`, progress cards app.js:2941-2965); replace the renderJournal/renderHeroFeed/renderProgressCards tick calls at app.js:4070-4072 with a `querySelectorAll` textContent + tone-class patch; slow `LIVE_PRICE_REFRESH_MS` to 5s; delete client-side direct Binance fallback + cache write-back (livePrices.js:149-176).
4. **Trust & correctness sweep** (M). Mojibake fixes (app.js:2945, 2954, 2960-2962, 3356, 3612-3614); `∞` for the 999 sentinel; live % computed as leveraged P&L from positionSize (tradeDisplay.js:216-220); bulk import stops fabricating stop/TP/exit — blank + flagged in preview, open-status rows allowed, `importBatchId` for undo (app.js:1721-1790); delete the "Verified Vantage Trades" pill (recentTradesView.js:132-147); "TS" close-reason guessing → "Manual" (tradeDisplay.js:123-155); score-formula info popover (app.js:3193-3293); reconcile balanceOverride vs equity curve (app.js:3105).
5. **Motion system + complete reduced-motion** (M). The inventory in §5; depends on item 3 for pnl-tick.
6. **Psychology & session analytics** (M). Three computed reports in `calculateAnalytics` (app.js:2990-3191) rendered with the existing bar-chart pattern (charts.js:364): P&L + win-rate by psychology rating, P&L by session, R-multiple distribution histogram. Zero new data entry — the fields already exist.
7. **Close-at-market quick action** (S). Close button on open-trade rows + progress cards; inline confirm showing cached live price → set exitPrice, status=closed, run `calculateTradeMetrics` + existing autosave path. No new form.
8. **Interactive calendar day click-through** (S). Day cells → `data-date` buttons → set `dateFrom`/`dateTo` → journal view (graft; app.js:3398-3503, 94-103). Mobile agenda list in the same pass.
9. **Daily risk-budget strip** (S). Dashboard strip: today vs `dailyMaxLoss`, week vs `weeklyMaxLoss`, reusing breach logic at app.js:3119-3135; tone via `--warn`/`--pnl-neg`. Pure derivation from existing state.
10. **Journal table sort + hash router** (S). Click-to-sort headers on the filtered array; `location.hash` router replacing bare `switchView` class toggling (app.js:587-605) with refresh/back-button restore; `aria-current` in the same pass.
11. **Accessibility + quick polish batch** (S). `:focus-visible` for buttons/nav; auth modal focus trap; pending states on auth/save buttons; 900-980px dead zone; `::after` copy into markup; copy-to-clipboard on donation addresses; persist admin `<details>` state; surface the 180-entry reflections cap in copy; delete dead `handleLandingPreviewAutoExpand`.
12. **Marketing surface minimum** (S). Meta description/OG/theme-color tags; move admin panel markup (index.html:424-495) behind JS injection so it never ships publicly.

### Roadmap (post-renovation, in rough order)

1. Normalize the trades JSONB blob into per-trade rows with CRUD (`sanitizeTradesPayload` at trade_handler.php:1475-1528 is the column spec) — highest structural leverage, explicitly out of renovation scope. Preceded by an HTTP smoke-test suite over the 15 actions.
2. Object-storage screenshot uploads replacing base64-in-record — depends on #1.
3. Server-side price polling (cron + cache) with SSE or slow poll — deletes per-tab fallback entirely.
4. Deploy-time migrations replacing per-request `ensureSchema`; de-drift `migrate_legacy_json.php`.
5. Monolith split (app.js factory-module completion; trade_handler.php into includes) — after tests exist.
6. Broker CSV import templates beyond Vantage/Binance, driven by user requests.
7. Weekly review view; journal pagination (wants SQL rows first); multi-account support (wants #1).
8. Playbooks-lite (per-setup rule checklists); MAE/MFE excursion capture.
9. Separate landing page with pricing/testimonials once there is a paid tier.

### Cut (not doing)

- **Broker API auto-sync** — years of per-broker work; paste-import + CSV covers the manual-journal segment this app can win.
- **Trade replay / backtesting engines** — requires tick-data licensing; different product category; not needed to charge for a journal.
- **AI coach / chat** — LLM costs on a no-revenue vanilla-PHP app; the deterministic psychology/session reports deliver the insight.
- **Verification backend for the "Verified" badge** — removing the unbacked claim is the honest fix.
- **OAuth/social login** — delete the dead `oauth_subject`/`auth_provider` columns instead.
- **Client-side WebSocket streaming** — 5s poll with targeted DOM patches is imperceptibly different for journaling.
- **Mentor/coach sharing, community feed, multi-leg options, dashboard drag-reorder, PWA/offline, framework migration** — off-strategy, speculative, or prohibited by constraints.

## 7. Implementation phases

Each phase leaves the app fully working and verifiable in a browser.

### Phase 1 — Security & backend correctness
**Files:** trade_handler.php, Dockerfile, .dockerignore (new), app.js (bypass gate only).
**Work:** entire security batch (ship-now #1); mojibake-adjacent server fixes none — this phase is backend-only.
**Must not break:** login/register/logout, save/load round-trip, price proxy for authenticated users, password reset flow. Verify: log in, save a trade, reload; confirm `update_prices` rejects unauthenticated POST and `public_recent_trades` returns only whitelisted fields; confirm db/schema.sql is no longer downloadable.

### Phase 2 — Token foundation, fonts, theme toggle
**Files:** styles.css (token block replaces :1-21 + crossfade/reduced-motion blocks), index.html (font links, FOUC head script, meta/theme-color, toggle button markup), app.js (toggle handler + `themechange` event + localStorage `axiom_journal_theme_v1`), charts.js (delete hard-coded palette :14-24 etc.; read `--chart-*` via `getComputedStyle`, cached per render pass, re-read on `themechange`).
**Work:** paste final tokens with legacy aliases; wire toggle; charts follow theme; `--text-main` fixed by alias.
**Must not break:** every existing view still renders (aliases guarantee old rules resolve); charts draw in both themes; no theme flash on reload. Verify: toggle themes, reload, confirm charts + native date pickers follow.

### Phase 3 — Live-update refactor + motion core
**Files:** app.js (:52, :4070-4072, render diffing, `REDUCED` helper), tradeDisplay.js (:204-235 cell tagging), livePrices.js (delete :149-176 fallback), styles.css (keyframes: tickUp/tickDown, viewEnter, skeletonPulse; delete brandAccentPulse/brandSettle/hover lifts), charts.js (draw-in progress param + dataset-hash guard).
**Work:** targeted cell patching; 5s poll; pnl-tick, count-up, chart-draw, view-enter, skeletons; global reduced-motion live.
**Must not break:** live prices still update on journal/hero/progress; scroll, focus, and text selection survive ticks (the acceptance test); full `renderAll` still fires on real state mutations. Verify: open journal with an open trade, scroll mid-tick, watch cells flash without table rebuild; toggle OS reduced-motion and confirm everything is instant.

### Phase 4 — Visual sweep: dashboard + journal (the two money views)
**Files:** styles.css (literal sweep for nav, metric cards, panels, tables, buttons, forms sections used by these views), index.html (empty-state markup, delta chip spans, `::after` copy → spans), app.js (`.is-pos/.is-neg` classes, delta chip computation, empty-state branch, `--pl-intensity` on balance card).
**Work:** component treatments from §4 for nav, metric cards (+ delta chips, signed hairlines, `--pl-intensity`), panels, journal table, empty states.
**Must not break:** all 12 metrics compute identically; filters, edit/delete, CSV export; the ≤900px card transform. Verify: dashboard + journal in both themes at 375/768/1280; empty state with a cleared journal; 900-980px width scrolls horizontally.

### Phase 5 — Visual sweep: remaining views + calendar + forms + landing
**Files:** styles.css (trade entry, reflections, calendar, monthly review, admin, landing, modal), index.html (Long/Short segmented control, landing tape markup, LIVE FEED tag), app.js (calendar day buttons + `--day-intensity` + date-filter click-through, mobile agenda list, form-shake trigger), recentTradesView.js (tape restyle, Verified pill removal).
**Work:** forms (opaque inputs, segmented toggle, shake), modals (+ landing modal over live tape), calendar (intensity ramp + clickable days), landing treatment (dot grid, monochrome hero, live-pulse dot, tape), toasts/badges.
**Must not break:** trade entry validation and edit round-trip; bulk import preview; auth modal flows; public board polling. Verify: submit an invalid trade (shake fires, reduced-motion → border flash); click a calendar day and land in a filtered journal; landing tape ticks while the auth modal is open.

### Phase 6 — Feature adds
**Files:** app.js (calculateAnalytics reports, close-at-market, risk strip, sort, hash router; import fabrication fixes; live % fix in tradeDisplay.js), charts.js (three new bar reports), index.html (report canvases, risk strip, sort affordances).
**Work:** ship-now #4 (client-side trust items), #6, #7, #9, #10.
**Must not break:** existing analytics numbers; the save path when closing at market; back-button now works and must keep working across all six views. Verify: close an open trade from the row; refresh restores the active view; sort a column; psychology report renders with real data.

### Phase 7 — Accessibility, polish, QA gate
**Files:** styles.css, index.html, app.js (focus trap, pending states, aria).
**Work:** ship-now #11 and #12 remainder; then the **AA sign-off checklist** (graft): every `.is-pos`/`.is-neg`/`--text-faint` pairing verified 4.5:1 body / 3:1 large numerals in BOTH themes; keyboard-only pass through auth → trade entry → journal → calendar; reduced-motion pass; 375/768/900-980/1280 in both themes; legacy alias block deleted once `grep` finds zero remaining alias consumers.
**Must not break:** anything — this phase is verification plus deletions. Verify: the checklist itself is the acceptance artifact; alias-block deletion causes zero visual diff.