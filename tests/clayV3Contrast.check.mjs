// Clay V3 contrast harness — computes WCAG 2.1 contrast ratios for every
// text/surface pairing that ships, in BOTH themes, from the ACTUAL cascade
// (styles.css -> clay-v2.css -> clay-v3.css, the <link> order in index.html).
// Floors: body text >= 4.5:1, large numerals / non-text UI >= 3:1.
// Alpha colours are composited over their real backdrop before measuring.
//
// It also guards the two V3 contracts that cannot be seen in a screenshot:
//   - no oxide hex may land in JS (charts read tokens via getComputedStyle);
//   - the V2 violet accent family must have no consumer outside clay-v2.css,
//     and clay-v3.css must override every accent-derived token in both themes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");

/* ---------------------------------------------------------------- parsing */

// Collect custom-property declarations from every TOP-LEVEL block whose
// selector matches; blocks inside @media are skipped (token blocks are all
// top-level in all three sheets).
function tokenBlocks(css, selector) {
  const blocks = [];
  let depth = 0;
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && ch !== "\n" && ch !== " ") {
      const open = css.indexOf("{", i);
      if (open === -1) break;
      const sel = css.slice(i, open).trim().replace(/\/\*[\s\S]*?\*\//g, "").trim();
      // Find the matching close brace for this block.
      let d = 1;
      let j = open + 1;
      while (j < css.length && d > 0) {
        if (css[j] === "{") d += 1;
        else if (css[j] === "}") d -= 1;
        j += 1;
      }
      if (sel === selector) blocks.push(css.slice(open + 1, j - 1));
      if (sel.startsWith("@")) {
        i = j; // skip whole at-rule
        depth = 0;
        continue;
      }
      i = open + 1;
      depth = 1;
      continue;
    }
    i += 1;
  }
  return blocks;
}

function declarations(block) {
  const out = {};
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const sheets = ["styles.css", "clay-v2.css", "clay-v3.css"].map(read);

function merged(selectors) {
  const map = {};
  for (const css of sheets) {
    for (const sel of selectors) {
      for (const block of tokenBlocks(css, sel)) {
        Object.assign(map, declarations(block));
      }
    }
  }
  return map;
}

// Cascade per theme. Dark: :root plus the dark-only guard. Light: :root plus
// the light attribute block ([data-theme="light"] out-specifies :root and the
// sheets keep source order, so a straight merge in sheet order is the cascade).
const THEMES = {
  dark: merged([":root", ':root:not([data-theme="light"])']),
  light: merged([":root", '[data-theme="light"]']),
};

/* ----------------------------------------------------------------- colour */

function resolve(tokens, value, seen = new Set()) {
  const v = String(value).trim();
  const m = v.match(/^var\((--[\w-]+)\)$/);
  if (m) {
    assert.ok(!seen.has(m[1]), `var() cycle at ${m[1]}`);
    seen.add(m[1]);
    assert.ok(tokens[m[1]] !== undefined, `undefined token ${m[1]}`);
    return resolve(tokens, tokens[m[1]], seen);
  }
  return v;
}

function parseColor(str) {
  const v = str.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{6})$/);
  if (m) {
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
      a: 1,
    };
  }
  m = v.match(/^#([0-9a-f]{3})$/);
  if (m) {
    return {
      r: parseInt(m[1][0] + m[1][0], 16),
      g: parseInt(m[1][1] + m[1][1], 16),
      b: parseInt(m[1][2] + m[1][2], 16),
      a: 1,
    };
  }
  m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  m = v.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*([\d.]+)\s*)?\)$/);
  if (m) {
    const h = +m[1] / 360;
    const s = +m[2] / 100;
    const l = +m[3] / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
      let x = t;
      if (x < 0) x += 1;
      if (x > 1) x -= 1;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    return {
      r: Math.round(hue(h + 1 / 3) * 255),
      g: Math.round(hue(h) * 255),
      b: Math.round(hue(h - 1 / 3) * 255),
      a: m[4] === undefined ? 1 : +m[4],
    };
  }
  return null;
}

function token(theme, name) {
  const tokens = THEMES[theme];
  assert.ok(tokens[name] !== undefined, `${theme}: missing token ${name}`);
  const color = parseColor(resolve(tokens, tokens[name]));
  assert.ok(color, `${theme}: ${name} did not parse as a colour (${tokens[name]})`);
  return color;
}

const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg, bg) {
  const L1 = luminance(over(fg, bg));
  const L2 = luminance(bg);
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

/* --------------------------------------------------------------- pairings */

const SURFACES = ["--surface-0", "--surface-1", "--surface-2", "--surface-3", "--surface-inset"];
const failures = [];
let worst = { ratio: Infinity };
let checked = 0;

function check(theme, fgName, bgName, floor, bgColor, fgColor) {
  const fg = fgColor ?? token(theme, fgName);
  const bg = bgColor ?? token(theme, bgName);
  const r = ratio(fg, bg);
  checked += 1;
  if (floor === 4.5 && r < worst.ratio) worst = { ratio: r, theme, fg: fgName, bg: bgName };
  if (r < floor) {
    failures.push(`${theme}: ${fgName} on ${bgName} = ${r.toFixed(2)}:1 (floor ${floor})`);
  }
}

for (const theme of ["dark", "light"]) {
  const surface = (n) => token(theme, n);

  // Body text (4.5:1) — every text tone on every surface it can land on.
  for (const fg of ["--text", "--text-soft", "--text-faint"]) {
    for (const bg of SURFACES) check(theme, fg, bg, 4.5);
  }

  // Accent as text: kickers, links, active nav labels. Oxide-on-gunmetal is
  // the risky pairing this file exists for.
  for (const bg of ["--surface-0", "--surface-1", "--surface-2", "--surface-3"]) {
    check(theme, "--accent", bg, 4.5);
  }
  check(
    theme,
    "--accent",
    "--accent-muted over --surface-1",
    4.5,
    over(token(theme, "--accent-muted"), surface("--surface-1"))
  );
  check(
    theme,
    "--accent-strong",
    "--accent-muted over --surface-2",
    4.5,
    over(token(theme, "--accent-muted"), surface("--surface-2"))
  );

  // CTA labels sit on the accent fill at body size.
  check(theme, "--text-inverse", "--accent", 4.5);

  // Money — body-size in journal rows and on soft fills; also the badge/chip
  // labels (--text-inverse on the raw fills, tabbar-badge + seg buttons).
  for (const fg of ["--pnl-pos", "--pnl-neg"]) {
    for (const bg of SURFACES) check(theme, fg, bg, 4.5);
  }
  check(
    theme,
    "--pnl-pos",
    "--pnl-pos-soft over --surface-1",
    4.5,
    over(token(theme, "--pnl-pos-soft"), surface("--surface-1"))
  );
  check(
    theme,
    "--pnl-neg",
    "--pnl-neg-soft over --surface-1",
    4.5,
    over(token(theme, "--pnl-neg-soft"), surface("--surface-1"))
  );
  check(theme, "--text-inverse", "--pnl-pos", 4.5);
  check(theme, "--text-inverse", "--pnl-neg", 4.5);

  // Status text on its soft fill and on the card.
  for (const fg of ["--warn", "--info"]) {
    check(theme, fg, "--surface-1", 4.5);
    check(
      theme,
      fg,
      `${fg}-soft over --surface-1`,
      4.5,
      over(token(theme, `${fg}-soft`), surface("--surface-1"))
    );
  }

  // Chart chrome: axis labels on the carved canvas, tooltip body text.
  check(theme, "--chart-axis", "--chart-canvas-top", 4.5);
  check(theme, "--chart-axis", "--chart-canvas-bottom", 4.5);
  check(
    theme,
    "--text",
    "--chart-tooltip-bg over --surface-1",
    4.5,
    over(token(theme, "--chart-tooltip-bg"), surface("--surface-1"))
  );

  // Large numerals floor (3:1) — the P&L hero value can land on the deck
  // gradient ends.
  for (const fg of ["--pnl-pos", "--pnl-neg", "--text"]) {
    check(theme, fg, "--deck-top", 3);
    check(theme, fg, "--deck-bottom", 3);
  }

  // Non-text UI (3:1, WCAG 1.4.11): control hairline and the focus ring
  // against both the card and the page.
  for (const bg of ["--surface-0", "--surface-1"]) {
    check(theme, "--control-edge", bg, 3);
    check(theme, "--accent (focus ring)", bg, 3, null, token(theme, "--accent"));
  }
}

/* ------------------------------------------------- violet + JS hex guards */

// The V2 violet family must not survive outside clay-v2.css (whose token
// blocks V3 overrides wholesale).
const VIOLET = /#(6b3ed8|9e7bf0|5730b5|b69af5)|rgba\(\s*(107,\s*62,\s*216|158,\s*123,\s*240|87,\s*48,\s*181|182,\s*154,\s*245)/i;
for (const file of ["clay-v3.css", "styles.css", "index.html", "app.js"]) {
  assert.ok(!VIOLET.test(read(file)), `V2 violet accent found in ${file}`);
}

// clay-v3.css must override every accent-derived token in BOTH theme blocks,
// or a violet value from clay-v2.css leaks through the cascade.
const v3 = read("clay-v3.css");
const ACCENT_TOKENS = [
  "--accent",
  "--accent-strong",
  "--accent-muted",
  "--line-accent",
  "--chart-line-deep",
  "--chart-glow",
  "--chart-halo",
  "--chart-halo-fade",
  "--chart-area-top",
  "--chart-area-mid",
  "--chart-area-bottom",
  "--chart-canvas-glow",
  "--halo-accent",
  "--aurora-a",
  "--aurora-fade",
  "--landing-grid-line",
  "--floor-glow",
  "--deck-wash",
  "--clay-accent",
  "--focus-ring",
];
for (const sel of ['[data-theme="light"]', ':root:not([data-theme="light"])']) {
  const block = tokenBlocks(v3, sel).join("\n");
  assert.ok(block.length > 0, `clay-v3.css: missing token block ${sel}`);
  for (const t of ACCENT_TOKENS) {
    assert.ok(
      new RegExp(`${t}\\s*:`).test(block),
      `clay-v3.css ${sel}: accent-derived token ${t} not overridden`
    );
  }
}

// Charts stay zero-JS: no oxide hex may land in any script. Tokens travel
// via getComputedStyle + 'themechange' only.
const OXIDE = /#(c2410c|f0763d|f68d5c|a83508|8a2b06|8f3c14|6e2205)/i;
for (const file of [
  "app.js",
  "src/modules/charts.js",
  "src/modules/livePrices.js",
  "src/modules/recentTradesView.js",
  "src/modules/tradeDisplay.js",
]) {
  assert.ok(!OXIDE.test(read(file)), `oxide hex hard-coded in ${file} — charts must read tokens`);
}

/* ----------------------------------------------------------------- report */

if (failures.length) {
  console.error("clayV3Contrast: FAILURES\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  `clayV3Contrast: ${checked} pairings green in both themes. ` +
    `Worst body-text pairing: ${worst.theme} ${worst.fg} on ${worst.bg} = ${worst.ratio.toFixed(2)}:1`
);
