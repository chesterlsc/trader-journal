// The two accessibility floors this design system claims, enforced against the
// stylesheets instead of against a memory of them:
//
//   1. TYPE   — nothing below 11px (--fs-micro) may survive at phone widths.
//   2. TOUCH  — the audited controls must reach a 44px tap height at phone
//               widths (or on any coarse pointer).
//
// The audit at 375x812 found .dash-dial-label at 9px, seven more items between
// 10px and 10.5px, and six controls between 14px and 42px tall. Every one of
// them was a *base* declaration with no mobile branch — the kind of rule that
// is re-added the next time a component is written from a desktop mockup. So
// this file re-derives both floors from the CSS on every run.
//
// Cascade model: rules are compared by exact selector string, in source order
// (styles.css then clay-v2.css, which is the <link> order in index.html). Equal
// selector => equal specificity, so "last one wins" is exact for this check.
// Run: node tests/mobileFloors.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PHONE = 375;
const TYPE_FLOOR = 11;
const TOUCH_FLOOR = 44;

// Design tokens the sheets use in place of literals (styles.css :root).
const TOKENS = { "--fs-micro": 11, "--fs-label": 12, "--fs-body": 13.5 };

// Not reachable on a phone at all, so their small type is not a phone defect:
//   .topnav-*        — .topnav is display:none below 1025px (clay-v2 §10a)
//   .kbd-hint, .dash-log-flag — live inside #journalNewTradeBtn, which is
//                      display:none below 899px (styles.css, the FAB owns it)
const OFF_PHONE = new Set([".topnav-label", ".topnav-badge", ".kbd-hint", ".dash-log-flag"]);

function parse(file) {
  const css = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );
  const rules = [];
  const stack = [];
  let cursor = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === "{") {
      const prelude = css.slice(cursor, i).trim();
      const block = {
        file,
        selector: prelude,
        start: i + 1,
        media: stack.filter((b) => b.selector.startsWith("@")).map((b) => b.selector),
      };
      stack.push(block);
      if (!prelude.startsWith("@") && !prelude.startsWith("%")) rules.push(block);
      cursor = i + 1;
    } else if (css[i] === "}") {
      const block = stack.pop();
      if (block) block.body = css.slice(block.start, i);
      cursor = i + 1;
    }
  }
  assert.equal(stack.length, 0, `${file} has unbalanced braces`);
  return rules;
}

// clay-v3.css was outside this scan, so every rule written there was exempt
// from the floors this file exists to enforce. The dashboard density pass
// lives in clay-v3, which made the exemption load bearing rather than
// theoretical: a font-size below 11px there would have shipped unseen.
const rules = [...parse("styles.css"), ...parse("clay-v2.css"), ...parse("clay-v3.css")];

// Does this rule's media context apply to a 375px phone?
const appliesOnPhone = (media) =>
  media.every((m) => {
    if (/print/.test(m)) return false;
    const min = /min-width:\s*(\d+)px/.exec(m);
    if (min && Number(min[1]) > PHONE) return false;
    const max = /max-width:\s*(\d+)px/.exec(m);
    // A comma in the query is a union — one branch matching is enough, and the
    // touch-target block below deliberately uses `(max-width: 899px),
    // (pointer: coarse)`.
    if (max && Number(max[1]) < PHONE && !m.includes(",")) return false;
    return true;
  });

const px = (raw) => {
  if (!raw) return null;
  const token = /var\((--fs-[a-z]+)\)/.exec(raw);
  if (token) return TOKENS[token[1]] ?? null;
  const literal = /(\d+(?:\.\d+)?)px/.exec(raw);
  return literal ? Number(literal[1]) : null;
};

// font-size, whether written long-hand or inside the `font:` shorthand.
const fontSize = (body) => {
  const long = /(?:^|[;{\s])font-size:\s*([^;}]+)/.exec(body);
  if (long) return px(long[1]);
  const short = /(?:^|[;{\s])font:\s*([^;}]+)/.exec(body);
  if (!short) return null;
  const size = /(?:^|\s)(\d+(?:\.\d+)?px|var\(--fs-[a-z]+\))\s*(?:\/|$|\s)/.exec(short[1]);
  return size ? px(size[1]) : null;
};

// --- 1. Type floor ---------------------------------------------------------
// Winner per selector = the last phone-applicable rule that sets a font size.
// A selector display:none'd at phone width has no type to floor (the "/" hint
// in the review search is hidden there rather than grown).
const winners = new Map();
const hidden = new Set();
for (const rule of rules) {
  if (!appliesOnPhone(rule.media)) continue;
  const size = fontSize(rule.body || "");
  const display = /(?:^|[;{\s])display:\s*([a-z-]+)/.exec(rule.body || "")?.[1];
  for (const sel of rule.selector.split(",").map((s) => s.trim())) {
    if (!sel) continue;
    if (display === "none" && !/\[hidden\]|:not\(/.test(sel)) hidden.add(sel);
    else if (display) hidden.delete(sel);
    if (size !== null) winners.set(sel, { size, rule });
  }
}

const tooSmall = [];
for (const [sel, { size, rule }] of winners) {
  // font-size:0 is the icon-swap trick (.sheet-step.is-done .sheet-step-num),
  // not readable text; its ::after restates a real size.
  if (size === 0 || size >= TYPE_FLOOR) continue;
  if (OFF_PHONE.has(sel) || hidden.has(sel)) continue;
  tooSmall.push(`${rule.file}: "${sel}" resolves to ${size}px at 375px`);
}
assert.deepEqual(
  tooSmall,
  [],
  `Text below the ${TYPE_FLOOR}px floor survives at phone widths:\n  ${tooSmall.join("\n  ")}`
);

// --- 2. Touch floor --------------------------------------------------------
// The controls the audit measured under 44px. Each needs a phone-width rule
// that lifts it to the floor; the checkbox pair is a hit AREA, so the target
// is the padded label wrapper, not the 15px box itself.
const CONTROLS = [
  ".dash-range-btn",
  ".dash-live-close",
  ".info-btn",
  ".trade-status-toggle", // wraps #tradeInProgress
  ".tag-set label", // wraps the five reflection checkboxes
  ".sheet-tile", // 2g thumb sheet: destination tiles
  ".sheet-util", // 2g thumb sheet: theme / export / logout chips
];

for (const sel of CONTROLS) {
  const lifted = rules.some(
    (r) =>
      r.selector
        .split(",")
        .map((s) => s.trim())
        .includes(sel) &&
      r.media.length > 0 &&
      appliesOnPhone(r.media) &&
      (px(/(?:^|[;{\s])min-height:\s*([^;}]+)/.exec(r.body || "")?.[1]) ?? 0) >= TOUCH_FLOOR
  );
  assert.ok(
    lifted,
    `"${sel}" has no phone-width rule reaching the ${TOUCH_FLOOR}px touch floor`
  );
}

console.log(
  "mobileFloors.check.mjs: OK — %d rules scanned, %d sized selectors, %d controls",
  rules.length,
  winners.size,
  CONTROLS.length
);
