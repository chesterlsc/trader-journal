// Drives the REAL 1c queue predicate and tag vocabulary out of app.js (sliced
// by name, no duplication) and asserts the two things that would silently rot:
// that trades written before 1c shipped keep their journalled status, and that
// the custom-tag vocabulary stays deduped. Run: node tests/journalQueue.check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = "/Users/macbookairm3/Documents/Trader-Journal";
const appSrc = readFileSync(`${ROOT}/app.js`, "utf8");

function takeFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3);
}

function takeConst(src, name) {
  const start = src.indexOf(`const ${name} = [`);
  assert.ok(start >= 0, `missing const ${name}`);
  const end = src.indexOf("];", start);
  assert.ok(end > start, `unterminated const ${name}`);
  return src.slice(start, end + 2);
}

const bundle = [
  takeConst(appSrc, "DEFAULT_MISTAKE_TAGS"),
  takeFunction(appSrc, "isTradeJournalled"),
  takeFunction(appSrc, "getKnownMistakeTags"),
  "return { isTradeJournalled, getKnownMistakeTags };"
].join("\n");

// state + journalState are the only outer bindings the sliced code reads.
const state = { trades: [] };
const journalState = { tags: new Set() };
// eslint-disable-next-line no-new-func
const { isTradeJournalled, getKnownMistakeTags } = new Function("state", "journalState", bundle)(
  state,
  journalState
);

/* ---- migration: what counted as journalled before 1c must still count ---- */
assert.equal(
  isTradeJournalled({ notes: "shorted the open too early" }),
  true,
  "a pre-1c trade with a note must stay journalled"
);
assert.equal(isTradeJournalled({ notes: "   " }), false, "whitespace is not a note");
assert.equal(isTradeJournalled({ notes: "" }), false, "no note, never journalled → queue");
assert.equal(
  isTradeJournalled({ notes: "", journalledAt: "2026-08-05T13:22:00.000Z" }),
  true,
  "graded through the sheet with no note is still journalled"
);
assert.equal(isTradeJournalled({}), false, "an empty record is unjournalled, not journalled");

/* ---- tag vocabulary: seeds + every tag any trade carries, deduped -------- */
assert.deepEqual(
  getKnownMistakeTags(),
  ["Entered early", "Moved stop", "Oversized", "Off-playbook"],
  "an empty journal offers exactly the four seeds"
);

state.trades = [
  { mistakeTags: ["Chased the wick", "Moved stop"] },
  { mistakeTags: ["moved stop", "Chased the wick", ""] },
  { mistakeTags: null },
  {}
];
journalState.tags = new Set(["Traded the news"]);

const tags = getKnownMistakeTags();
assert.deepEqual(
  tags,
  ["Entered early", "Moved stop", "Oversized", "Off-playbook", "Chased the wick", "Traded the news"],
  "custom tags append once, case-insensitively, in first-seen order"
);
assert.equal(new Set(tags.map((tag) => tag.toLowerCase())).size, tags.length, "no case-variant duplicates");
assert.ok(!tags.includes(""), "empty tags never enter the vocabulary");

console.log(`OK — journal queue predicate + ${tags.length} tag vocabulary`);
