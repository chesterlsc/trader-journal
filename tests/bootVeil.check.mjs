// Boot veil regression contract.
//
// The veil exists to cover the boot: the landing markup ships in index.html
// and the module swaps it for the app, so without a cover the visitor sees the
// marketing page flash before their dashboard. Four things make that work, and
// all four are the kind that rot silently:
//
//   1. It must paint FIRST — inline <style> in <head> before every stylesheet
//      link, markup as the first child of <body>. Move either and the veil
//      arrives after the flash it was built to hide.
//   2. The lift must survive a dead module graph. This site has already shipped
//      an import that 404'd in production; a veil coupled to app.js would have
//      turned that outage into a locked door. Hence a plain non-module script
//      owning both the timeout and window.__liftBootVeil.
//   3. Every failure mode must degrade toward COMPLETE. The markup carries the
//      finished mark and only the keyframes' `from` block hides anything, so
//      animation:none — reduced motion, the lift snap, an engine that never ran
//      the keyframes — shows a whole logo rather than a blank box.
//   4. app.js must still call the lift, from both boot paths.
//
// Run: node tests/bootVeil.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const html = read("index.html");
const app = read("app.js");

// ── 1. paint order ────────────────────────────────────────────────────────────
const styleStart = html.indexOf("#tjv {");
assert.ok(styleStart > 0, "veil style block is missing from index.html");

const headEnd = html.indexOf("</head>");
assert.ok(styleStart < headEnd, "veil style must live in <head>, not <body>");

const firstSheet = html.search(/<link[^>]+rel="stylesheet"/);
assert.ok(firstSheet > 0, "no stylesheet link found");
assert.ok(
  styleStart < firstSheet,
  "veil style must precede every stylesheet link, or it paints after the flash"
);

const bodyOpen = html.indexOf("<body>");
const afterBody = html.slice(bodyOpen + "<body>".length);
const firstTag = afterBody.match(/<([a-z][\w-]*)\b[^>]*>/i);
assert.equal(firstTag?.[1], "div", "first element in <body> should be the veil div");
assert.ok(
  /^<div id="tjv"/.test(afterBody.trimStart()),
  "the veil must be the FIRST child of <body>"
);

// ── 2. fail-open ──────────────────────────────────────────────────────────────
const liftScript = html.slice(html.indexOf("<script>", bodyOpen), html.indexOf("</script>", bodyOpen));
assert.ok(
  liftScript.includes("__liftBootVeil"),
  "the lift script must sit immediately after the veil markup"
);
assert.ok(
  !/type\s*=\s*"module"|\bdefer\b|\basync\b/.test(liftScript.slice(0, liftScript.indexOf(">"))),
  "the lift script must be plain and blocking — a dead module must never strand the veil"
);
const failOpen = liftScript.match(/setTimeout\(\s*lift\s*,\s*(\d+)\s*\)/);
assert.ok(failOpen, "no fail-open timeout arming lift()");
assert.ok(
  Number(failOpen[1]) > 0 && Number(failOpen[1]) <= 4000,
  `fail-open of ${failOpen[1]}ms is outside the 0–4000ms the veil is allowed to hold`
);
// A backgrounded tab never ticks rAF, so a timer has to race it or the veil
// stays up until the tab is focused. Both paths must be present.
assert.ok(liftScript.includes("requestAnimationFrame"), "lift lost its rAF path");
assert.ok(
  /setTimeout\(\s*go\s*,\s*\d+\s*\)/.test(liftScript),
  "lift needs a timer racing rAF, or a hidden tab strands the veil"
);
assert.ok(
  /if \(done\) return;/.test(liftScript) && /if \(fired\) return;/.test(liftScript),
  "lift must be idempotent: renderAll() has ~25 other callers"
);
assert.ok(
  /if \(v\.parentNode\)/.test(liftScript),
  "node removal needs a parent guard"
);

// ── 3. every failure degrades toward the finished mark ────────────────────────
const styleBlock = html.slice(styleStart, html.indexOf("</style>", styleStart));
const keyframeCut = styleBlock.indexOf("@keyframes");
assert.ok(keyframeCut > 0, "veil style lost its @keyframes block");
const baseRules = styleBlock.slice(0, keyframeCut);
assert.ok(
  !/stroke-dashoffset/.test(baseRules),
  "stroke-dashoffset outside @keyframes would leave the mark hidden when animations are off"
);
assert.ok(
  !/#tjv-p[^{]*\{[^}]*opacity:\s*0/.test(baseRules),
  "the plate must default to visible; only the keyframe `from` may hide it"
);
assert.ok(
  /@media \(prefers-reduced-motion: reduce\)/.test(styleBlock),
  "reduced motion has no branch"
);
assert.ok(
  /#tjv, #tjv \* \{ animation: none/.test(styleBlock),
  "reduced motion must kill animations on descendants too, not just the veil"
);
assert.ok(
  /#tjv\.out \* \{ animation: none !important/.test(styleBlock),
  "the lift snap depends on killing descendant animations"
);

// The veil must sit UNDER the desk app's passcode gate (z-index 2147483000).
const z = Number(styleBlock.match(/z-index:\s*(\d+)/)?.[1]);
assert.ok(z > 0 && z < 2147483000, `veil z-index ${z} must stay under the desk gate's 2147483000`);

// Both themes get a ground, or one of them boots to the flash it was hiding.
assert.ok(/background: #14161a/.test(styleBlock), "dark ground missing");
assert.ok(
  /\[data-theme="light"\] #tjv \{[^}]*background: #e6e8ea/.test(styleBlock),
  "light ground missing — a hardcoded dark veil is the same flash, inverted"
);

// Choreography must address elements that exist: an animation on a missing id
// is dead, and an un-animated path silently skips its beat.
const markup = html.slice(html.indexOf('<div id="tjv"'), html.indexOf("</div>", html.indexOf('<div id="tjv"')));
const drawn = new Set([...markup.matchAll(/id="(tjv-[\w-]+)"/g)].map((m) => m[1]));
const animated = new Set([...baseRules.matchAll(/#(tjv-[\w-]+)\s*\{\s*animation:/g)].map((m) => m[1]));
assert.deepEqual(
  [...animated].filter((id) => !drawn.has(id)),
  [],
  "an @keyframes target has no element in the markup"
);
assert.deepEqual(
  [...drawn].filter((id) => !animated.has(id)),
  [],
  "an element in the markup never animates — it will pop in fully formed"
);

// Every traced path needs pathLength="100", or the shared dasharray is wrong.
const traced = [...markup.matchAll(/<path[^>]*>/g)].map((m) => m[0]);
for (const path of traced) {
  assert.ok(
    /pathLength="100"/.test(path),
    `traced path without pathLength="100": ${path.slice(0, 60)}`
  );
}

// ── 4. app.js still lifts ─────────────────────────────────────────────────────
const calls = [...app.matchAll(/window\.__liftBootVeil\(\)/g)];
assert.equal(
  calls.length,
  2,
  "expected two lift calls: init() for settled-auth boots, checkAuthSession() for the owner"
);
assert.ok(
  /renderAll\(\);\n(?:\s*\/\/[^\n]*\n)*\s*if \(state\.auth\.checked && window\.__liftBootVeil\)/.test(app),
  "init()'s lift must sit right after renderAll() and behind the auth.checked gate"
);
assert.ok(
  /if \(window\.__liftBootVeil\) window\.__liftBootVeil\(\);\n\}/.test(app),
  "checkAuthSession() must lift as its last statement, after the view swap"
);

console.log(
  `bootVeil.check.mjs: OK — paints before ${html.match(/<link[^>]+rel="stylesheet"/g).length} stylesheets, ` +
    `fails open at ${failOpen[1]}ms, ${drawn.size} elements all default to the finished mark`
);
