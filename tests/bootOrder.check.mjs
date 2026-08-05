// app.js calls init() at module top level. Any module-level `let`/`const`
// declared BELOW that call is in the temporal dead zone while init() runs: the
// first render touches it, it throws, boot aborts, and every listener bound
// after that point is silently dead. The page still renders — that is what
// makes it so easy to ship. It has shipped four times.
//
// `node --check` cannot catch this: the file is syntactically perfect. A
// browser catches it, but only if somebody remembers to open one. So the check
// lives here, where it runs on every pass.
//
// The rule: declare new module-level state ABOVE the init() call, next to
// METRIC_DELTA_SPECS / dashSparkHash / QUICK_FILTER_LABELS.
//
// Run: node tests/bootOrder.check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const lines = readFileSync(new URL("../app.js", import.meta.url), "utf8").split("\n");

const initLine = lines.findIndex((line) => line === "init();");
assert.ok(initLine >= 0, "app.js no longer calls init() at module top level — this check needs rewriting");

// The bindings that already lived below init() when this guard was written.
// Each is only ever read from inside a function that cannot run before boot
// finishes, so each is safe TODAY — but none of them is a licence to add more.
// Anything not on this list is a new arrival and has to move above init().
const KNOWN_SAFE = new Set([
  "CAPTURE_CHIP_TONES",
  "ADMIN_PANELS_TEMPLATE",
  "LIVE_TONE_GROUPS",
  "LIVE_FIELD_SPECS"
]);

const offenders = [];
for (let i = initLine + 1; i < lines.length; i += 1) {
  const match = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
  if (match && !KNOWN_SAFE.has(match[1])) {
    offenders.push(`${match[1]} declared at app.js:${i + 1}, below the init() call at app.js:${initLine + 1}`);
  }
}

assert.deepEqual(
  offenders,
  [],
  "New module-level bindings are below the init() call and will be in the temporal dead zone " +
    `during the first render. Move them above init():\n  ${offenders.join("\n  ")}`
);

// And the converse: the guard is worthless if the known-safe list quietly
// becomes the whole file. Every name on it must still actually be down there.
const below = lines.slice(initLine + 1).join("\n");
for (const name of KNOWN_SAFE) {
  assert.match(
    below,
    new RegExp(`^(?:const|let|var)\\s+${name}\\b`, "m"),
    `${name} is on the known-safe list but is no longer declared below init() — drop it from the list`
  );
}

console.log(
  "bootOrder.check.mjs: OK — init() at line %d, no new module-level bindings below it",
  initLine + 1
);
