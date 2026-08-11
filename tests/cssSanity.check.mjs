// A CSS syntax error does not throw. The browser silently drops the broken rule
// AND, when the breakage is an unclosed functional selector, everything after it
// in the file.
//
// That happened: a script that trimmed dead selectors out of comma lists split
// on commas INSIDE `:is(...)`, producing
//
//     :root[data-term="on"] :is(.btn.primary,
//     .sheet-submit {
//
// The unclosed `:is(` swallowed the rest of the sheet. The browser parsed 1169
// of 1304 top-level rules, so ~135 rules — including an entire new component —
// were silently dead while every existing test stayed green: mobileFloors only
// balances braces, and clayV3Contrast only reads :root token blocks. Neither
// looks at whether a selector is syntactically valid.
//
// This file is the missing check. It is deliberately cheap and structural.
//
// Run: node tests/cssSanity.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SHEETS = ["styles.css", "clay-v2.css", "clay-v3.css"];

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Top-level rules as (selector, startIndex), brace-matched. */
function topLevelRules(css) {
  const out = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let k = open + 1;
    while (k < n && depth > 0) {
      if (css[k] === "{") depth += 1;
      else if (css[k] === "}") depth -= 1;
      k += 1;
    }
    out.push({ selector: css.slice(i, open), at: open });
    i = k;
  }
  return out;
}

const lineOf = (css, index) => css.slice(0, index).split("\n").length;

const problems = [];

for (const file of SHEETS) {
  const raw = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const css = stripComments(raw);

  // 1. Braces balance. An unclosed block nests everything after it.
  assert.equal(
    css.split("{").length,
    css.split("}").length,
    `${file}: unbalanced braces (${css.split("{").length - 1} open, ${css.split("}").length - 1} close)`
  );

  // 2. Comments terminate. An unclosed /* eats the remainder of the file.
  assert.equal(
    (raw.match(/\/\*/g) || []).length,
    (raw.match(/\*\//g) || []).length,
    `${file}: unterminated comment`
  );

  for (const { selector, at } of topLevelRules(css)) {
    const sel = selector.trim();
    if (sel === "") continue;

    // 3. THE ONE THAT BIT. Parentheses must balance inside a selector, or the
    //    parser runs past the rule and consumes the rest of the sheet.
    const opens = (sel.match(/\(/g) || []).length;
    const closes = (sel.match(/\)/g) || []).length;
    if (opens !== closes) {
      problems.push(
        `${file}:${lineOf(css, at)} unbalanced parentheses in selector: ${sel.replace(/\s+/g, " ").slice(0, 90)}`
      );
      continue;
    }

    // 4. Same failure mode, different bracket.
    if ((sel.match(/\[/g) || []).length !== (sel.match(/\]/g) || []).length) {
      problems.push(
        `${file}:${lineOf(css, at)} unbalanced square brackets in selector: ${sel.replace(/\s+/g, " ").slice(0, 90)}`
      );
      continue;
    }

    // 5. A selector list must not have an empty slot: a trailing or doubled
    //    comma is what a careless selector edit leaves behind, and the whole
    //    rule is dropped.
    if (sel.startsWith("@")) continue;
    const parts = splitSelectorList(sel);
    if (parts.some((part) => part.trim() === "")) {
      problems.push(
        `${file}:${lineOf(css, at)} empty slot in selector list: ${sel.replace(/\s+/g, " ").slice(0, 90)}`
      );
    }
  }
}

/** Split on commas at paren/bracket depth 0, which is the split the broken script skipped. */
function splitSelectorList(sel) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

assert.deepEqual(problems, [], `CSS selector syntax errors silently disable every rule after them:\n  ${problems.join("\n  ")}`);

// The splitter must actually be depth-aware, or this file would have passed the
// very bug it exists to catch.
assert.deepEqual(splitSelectorList(":is(a, b), .c").map((s) => s.trim()), [":is(a, b)", ".c"]);
assert.deepEqual(splitSelectorList("[data-x=\"a,b\"], .c").map((s) => s.trim()), ['[data-x="a,b"]', ".c"]);

const counts = SHEETS.map((f) => topLevelRules(stripComments(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"))).length);
console.log(
  `cssSanity.check.mjs: OK — ${counts.reduce((a, b) => a + b, 0)} top-level rules across ${SHEETS.length} sheets, all selectors parse`
);
