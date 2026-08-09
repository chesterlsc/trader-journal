// The user has asked twice to get em and en dashes out of the copy, and it has
// regressed twice, because "don't type that character" is not a thing a person
// can enforce by remembering. This is the enforcement.
//
// SCOPE, precisely: a dash used as PROSE PUNCTUATION, meaning one with a word
// on both sides. That is the thing that was asked for and the thing that keeps
// coming back.
//
// What this deliberately does NOT ban: a standalone dash as the missing-value
// glyph. `DASH = "—"` (src/modules/tradeDisplay.js:5) is the app-wide
// placeholder in every table cell that has no number yet, it is not a sentence,
// and banning it would mean rewriting every empty state for no reason.
//
// Comments are exempt, so the reasoning above a line can still read like
// English. Only shipped copy is scanned.
//
// Run: node tests/copyDashes.check.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// word (or %, closing bracket) · optional spaces · dash · optional spaces · word
const PROSE_DASH = /[\w%)\]][ \t]*[—–][ \t]*[\w(\[$]/;

/** Blank out comment bodies, preserving every newline so line numbers survive. */
function blankJsComments(src) {
  const out = [...src];
  let mode = null;
  let quote = "";
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const next = src[i + 1] ?? "";
    if (mode === null) {
      if (c === "/" && next === "/") { mode = "line"; out[i] = " "; out[i + 1] = " "; i += 1; continue; }
      if (c === "/" && next === "*") { mode = "block"; out[i] = " "; out[i + 1] = " "; i += 1; continue; }
      if (c === '"' || c === "'" || c === "`") { mode = "str"; quote = c; }
      continue;
    }
    if (mode === "line") {
      if (c === "\n") mode = null;
      else out[i] = " ";
      continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") { out[i] = " "; out[i + 1] = " "; mode = null; i += 1; continue; }
      if (c !== "\n") out[i] = " ";
      continue;
    }
    // inside a string
    if (c === "\\") { i += 1; continue; }
    if (c === quote) mode = null;
  }
  return out.join("");
}

const blankRun = (match) => match.replace(/[^\n]/g, " ");

function blankHtmlNonCopy(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, blankRun)
    .replace(/<script\b[\s\S]*?<\/script>/gi, blankRun)
    .replace(/<style\b[\s\S]*?<\/style>/gi, blankRun);
}

function jsFilesUnder(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return jsFilesUnder(rel);
    return entry.name.endsWith(".js") ? [rel] : [];
  });
}

// Every file that can put words on a user's screen.
const TARGETS = ["index.html", "app.js", ...jsFilesUnder("src")];

const violations = [];
for (const rel of TARGETS) {
  const path = join(ROOT, rel);
  if (!statSync(path).isFile()) continue;
  const raw = readFileSync(path, "utf8");
  const scan = rel.endsWith(".html") ? blankHtmlNonCopy(raw) : blankJsComments(raw);
  const rawLines = raw.split("\n");
  scan.split("\n").forEach((line, index) => {
    if (PROSE_DASH.test(line)) {
      violations.push(`${rel}:${index + 1}  ${rawLines[index].trim().slice(0, 120)}`);
    }
  });
}

assert.deepEqual(
  violations,
  [],
  `em/en dash used as prose punctuation in shipped copy. Use a colon, comma or full stop:\n  ${violations.join("\n  ")}`
);

// The scanner has to actually be able to catch one, or a broken regex would
// pass this file silently forever.
assert.ok(PROSE_DASH.test("Clip ready — 4s, 12kB."), "the scanner must catch a prose em dash");
assert.ok(PROSE_DASH.test("7W–5L"), "the scanner must catch a prose en dash");
assert.ok(!PROSE_DASH.test('const DASH = "—";'), "a standalone placeholder dash must stay legal");
assert.ok(!PROSE_DASH.test("<span>—</span>"), "an empty-state glyph must stay legal");

console.log(`copyDashes.check.mjs: OK — ${TARGETS.length} copy files clean of prose em/en dashes`);
