// Drives the REAL 1f #07 digest maths out of app.js (sliced by name, never
// copied), because the whole feature rests on one promise: every sentence is a
// template over a computed figure, and a clause with no data behind it is
// DROPPED rather than hedged.
//
// What would rot silently here:
//   * a clause acquiring a hedge ("roughly", "it looks like") and quietly
//     becoming a claim the arithmetic does not support;
//   * the empty-week path emitting prose instead of nothing;
//   * the week drifting off Monday–Sunday, so a digest and the weekly loss
//     limit (src/lib/core.js getWeekKey) disagree about which seven days;
//   * "dominant psychology tag" firing on a single loss or on a two-way tie;
//   * the rule-cost clause counting trades that were never SHOWN a checklist
//     (imports, command-bar captures, everything logged before 1f #02);
//   * the "what will I improve" box being filled with something invented
//     rather than left empty;
//   * the Monthly Review seed overwriting a month the trader already saved.
//
// Run: node tests/weeklyDigest.check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { round, getWeekKey } from "../src/lib/core.js";
import { formatCurrency } from "../src/lib/format.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const appSrc = readFileSync(`${ROOT}/app.js`, "utf8");
const htmlSrc = readFileSync(`${ROOT}/index.html`, "utf8");

function takeFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3);
}

// --- the harness -----------------------------------------------------------
// Only what the sliced functions actually reach: state, the two formatters,
// the date helpers and the journalled predicate. Everything else is real code.
const state = {
  trades: [],
  reflections: [],
  replayNotes: {},
  settings: {
    dailyMaxLoss: 500,
    weeklyMaxLoss: 1500,
    riskPerTrade: 1,
    preTradeRules: [
      { id: "news", label: "No news inside 15 minutes" },
      { id: "size", label: "Size at or under plan" }
    ]
  }
};

const bundle = [
  takeFunction(appSrc, "plural"),
  takeFunction(appSrc, "digestMoney"),
  takeFunction(appSrc, "weekBoundsFor"),
  takeFunction(appSrc, "digestWeekTrades"),
  takeFunction(appSrc, "worstWeekRule"),
  takeFunction(appSrc, "dominantLosingMood"),
  takeFunction(appSrc, "worstWeekSetup"),
  takeFunction(appSrc, "weekBreaches"),
  takeFunction(appSrc, "buildWeeklyDigest"),
  takeFunction(appSrc, "buildMonthlySeed"),
  takeFunction(appSrc, "getClosedTrades"),
  takeFunction(appSrc, "getPreTradeRules"),
  takeFunction(appSrc, "isTradeJournalled"),
  takeFunction(appSrc, "formatIsoShort"),
  takeFunction(appSrc, "shiftDateString"),
  `return { buildWeeklyDigest, buildMonthlySeed, weekBoundsFor, worstWeekRule, dominantLosingMood, weekBreaches };`
].join("\n\n");

const api = new Function(
  "state",
  "round",
  "getWeekKey",
  "formatCurrency",
  "formatSignedCurrency",
  "toDateInputValue",
  bundle
)(
  state,
  round,
  getWeekKey,
  formatCurrency,
  (value) => `${value > 0 ? "+" : value < 0 ? "-" : "±"}${formatCurrency(Math.abs(value))}`,
  (date) => date.toISOString().slice(0, 10)
);

let id = 0;
const trade = (over = {}) => ({
  id: `t${(id += 1)}`,
  status: "closed",
  date: "2026-07-29",
  asset: "EURUSD",
  setupType: "Breakout",
  psychology: "Focused",
  result: "Win",
  netPnl: 100,
  riskPercent: 0.5,
  notes: "a note",
  preTradeRulesAsked: [],
  preTradeRules: [],
  ...over
});

// --- 1. the week is Monday..Sunday, and it agrees with getWeekKey ----------
// 2026-07-29 is a Wednesday.
const week = api.weekBoundsFor("2026-07-29");
assert.equal(week.from, "2026-07-27", "week must start on Monday");
assert.equal(week.to, "2026-08-02", "week must end on Sunday");
assert.equal(week.key, getWeekKey("2026-07-29"), "digest week and loss-limit week must be the same seven days");
for (const day of ["2026-07-27", "2026-07-30", "2026-08-02"]) {
  const bounds = api.weekBoundsFor(day);
  assert.equal(bounds.from, week.from, `${day} must land in the same week`);
  assert.equal(bounds.key, week.key, `${day} must carry the same week key`);
}
assert.equal(api.weekBoundsFor("2026-08-03").from, "2026-08-03", "the next Monday starts a new week");
assert.equal(api.weekBoundsFor("nonsense"), null, "an unparseable date yields no week, not a guessed one");

// --- 2. an empty week drafts NOTHING --------------------------------------
state.trades = [];
const empty = api.buildWeeklyDigest("2026-07-29");
assert.equal(empty.count, 0);
assert.equal(empty.wentWell, "", "an empty week must not produce prose");
assert.equal(empty.mistake, "");
assert.equal(empty.improveTomorrow, "");

// --- 3. every figure in the headline is real ------------------------------
state.trades = [
  trade({ date: "2026-07-27", netPnl: 400, result: "Win", setupType: "Breakout" }),
  trade({ date: "2026-07-28", netPnl: -150, result: "Loss", setupType: "Reversal", psychology: "Emotional" }),
  trade({ date: "2026-07-28", netPnl: -50, result: "Loss", setupType: "Reversal", psychology: "Emotional" }),
  trade({ date: "2026-07-30", netPnl: 0, result: "Breakeven", setupType: "Scalp" }),
  // a trade one week earlier, for the comparison clause
  trade({ date: "2026-07-22", netPnl: 90, result: "Win" }),
  // an OPEN trade in the week — must not be counted anywhere
  trade({ date: "2026-07-29", status: "open", netPnl: 0, result: "Open" })
];

const digest = api.buildWeeklyDigest("2026-07-29");
assert.equal(digest.count, 4, "open trades are not closed trades");
assert.equal(digest.net, 200);
assert.match(digest.wentWell, /4 closed trades, \+\$200\.00 net across 3 trading days\./);
assert.match(digest.wentWell, /1 win, 2 losses, 1 scratch, a 25\.0% win rate\./);
assert.match(digest.wentWell, /Expectancy ran \+\$50\.00 per trade\./);
assert.match(digest.wentWell, /Best trade: EURUSD \+\$400\.00 on Breakout/);
assert.match(digest.wentWell, /week before was 1 trade for \+\$90\.00, up \$110\.00 on that\./);
assert.match(digest.wentWell, /All 4 carry a journal note\./);
assert.match(digest.mistake, /Worst trade: EURUSD -\$150\.00 on Reversal/);
// No hedging vocabulary anywhere in the draft.
const prose = `${digest.wentWell} ${digest.mistake} ${digest.improveTomorrow}`;
assert.doesNotMatch(prose, /\b(roughly|approximately|about|maybe|probably|seems|appears|likely|around)\b/i,
  "the digest may state figures, never estimate them");

// no previous week => the comparison clause disappears rather than saying "0"
state.trades = state.trades.filter((row) => row.date !== "2026-07-22");
assert.doesNotMatch(api.buildWeeklyDigest("2026-07-29").wentWell, /week before/,
  "with no prior week the comparison clause must be dropped, not zeroed");

// --- 4. dominant psychology needs two, and needs to be unambiguous --------
const twoLosses = [
  trade({ netPnl: -100, result: "Loss", psychology: "Emotional" }),
  trade({ netPnl: -100, result: "Loss", psychology: "Emotional" })
];
assert.deepEqual(api.dominantLosingMood(twoLosses), { label: "Emotional", count: 2, of: 2 });
assert.equal(
  api.dominantLosingMood([trade({ netPnl: -100, result: "Loss", psychology: "Emotional" })]),
  null,
  "one loss is an anecdote, not a dominant tag"
);
assert.equal(
  api.dominantLosingMood([...twoLosses,
    trade({ netPnl: -100, result: "Loss", psychology: "Hesitant" }),
    trade({ netPnl: -100, result: "Loss", psychology: "Hesitant" })
  ]),
  null,
  "a tie is not dominance"
);

// --- 5. rule cost counts only trades that were SHOWN the checklist --------
const rulesWeek = [
  // shown both rules, ticked both
  trade({ date: "2026-07-27", netPnl: 200, preTradeRulesAsked: ["news", "size"], preTradeRules: ["news", "size"] }),
  // shown both, skipped the news check — twice, and both lost
  trade({ date: "2026-07-28", netPnl: -300, result: "Loss", preTradeRulesAsked: ["news", "size"], preTradeRules: ["size"] }),
  trade({ date: "2026-07-29", netPnl: -100, result: "Loss", preTradeRulesAsked: ["news", "size"], preTradeRules: ["size"] }),
  // never shown a checklist (an import): must not appear on either side
  trade({ date: "2026-07-30", netPnl: -900, result: "Loss", preTradeRulesAsked: [], preTradeRules: [] })
];
const rule = api.worstWeekRule(rulesWeek);
assert.equal(rule.label, "No news inside 15 minutes");
assert.equal(rule.asked, 3, "the un-asked import must be excluded from the denominator");
assert.equal(rule.skipped, 2);
assert.equal(rule.pnl, -400, "the cost is the skipped trades' net, not the week's net");
assert.equal(api.worstWeekRule([rulesWeek[3]]), null, "no checklist shown means no rule clause at all");

// --- 6. the lever is computed or absent, never invented -------------------
state.trades = rulesWeek;
const withRule = api.buildWeeklyDigest("2026-07-29");
assert.match(withRule.improveTomorrow, /Tick “No news inside 15 minutes”/);
assert.match(withRule.improveTomorrow, /are -\$400\.00\./);

// a clean week with nothing to say leaves the box empty for the trader
state.trades = [
  trade({ date: "2026-07-27", netPnl: 100 }),
  trade({ date: "2026-07-28", netPnl: 120 })
];
const clean = api.buildWeeklyDigest("2026-07-29");
assert.equal(clean.improveTomorrow, "", "with no computed lever the box stays empty rather than inventing one");
assert.equal(clean.followRules, "Yes");
assert.match(clean.mistake, /No trade closed red/);

// --- 7. breaches drive the rules answer ----------------------------------
state.trades = [trade({ date: "2026-07-28", netPnl: -600, result: "Loss" })];
const breached = api.buildWeeklyDigest("2026-07-29");
assert.match(breached.mistake, /\$500\.00 daily loss limit went on 1 day/);
assert.equal(breached.followRules, "No", "a breached loss limit is a No, not a Partially");

state.trades = [trade({ date: "2026-07-28", netPnl: -100, result: "Loss", riskPercent: 2.5 })];
const oversized = api.buildWeeklyDigest("2026-07-29");
assert.match(oversized.mistake, /risked more than your 1% per-trade cap, up to 2\.50%/);
assert.equal(oversized.followRules, "Partially", "an oversized trade with no breach is a Partially");

state.trades = [trade({ date: "2026-07-28", netPnl: -1600, result: "Loss", riskPercent: 0.5 })];
assert.match(api.buildWeeklyDigest("2026-07-29").mistake, /past your \$1,500\.00 weekly loss limit/);

// --- 8. the Monthly Review seed --------------------------------------------
state.trades = [
  trade({ date: "2026-07-01", netPnl: 100 }),
  trade({ date: "2026-07-29", netPnl: -100, result: "Loss" }),
  trade({ date: "2026-08-04", netPnl: 500 }) // another month entirely
];
state.reflections = [];
const seed = api.buildMonthlySeed("2026-07");
assert.match(seed, /Week of Jun 29 to Jul 05/);
assert.match(seed, /Week of Jul 27 to Aug 02/);
assert.doesNotMatch(seed, /Aug 03 – Aug 09/, "a week outside the month must not be seeded");
assert.equal(api.buildMonthlySeed("2026-09"), "", "a month with no trades seeds nothing");

// a saved digest for a week wins over a freshly generated one
state.reflections = [
  {
    weekOf: getWeekKey("2026-07-29"),
    wentWell: "MY OWN EDIT",
    mistake: "",
    improveTomorrow: ""
  }
];
const seeded = api.buildMonthlySeed("2026-07");
assert.match(seeded, /Week of Jul 27 to Aug 02 \(your saved digest\)\nMY OWN EDIT/);
assert.doesNotMatch(seeded.split("\n\n").pop(), /Expectancy ran/, "the saved edit replaces the draft, it does not append to it");

// --- 9. the wiring the harness cannot see ---------------------------------
for (const marker of ["digestDraftBtn", "digestPrevBtn", "digestNextBtn", "digestDate", "digestSummary", "replaySeedNote"]) {
  assert.ok(htmlSrc.includes(`id="${marker}"`), `index.html lost #${marker}`);
  assert.ok(appSrc.includes(marker), `app.js never reaches #${marker}`);
}
// The digest has exactly one save path: the reflection form's own submit.
assert.ok(
  appSrc.includes('ui.reflectionForm.dataset.weekOf = digest.key'),
  "applyWeeklyDigest must stamp the week on the form rather than saving directly"
);
assert.ok(
  appSrc.includes("state.reflections.filter((entry) => entry.weekOf !== weekOf)"),
  "re-saving a week must replace its digest, not stack a second one"
);
// weekOf must survive a reload and a second device.
assert.match(appSrc, /weekOf: String\(item\.weekOf \|\| ""\)/, "normalizeReflections dropped weekOf");
// The seed must never overwrite a month the trader saved — including one
// deliberately saved as empty.
assert.ok(
  appSrc.includes('Object.prototype.hasOwnProperty.call(state.replayNotes, month)'),
  "renderMonthlyReview must test for the KEY, not for truthiness, or a cleared month re-seeds itself"
);
assert.ok(
  appSrc.includes("if (document.activeElement === ui.replayNotes)"),
  "renderMonthlyReview must not overwrite the textarea while it is being typed in"
);

console.log("weeklyDigest.check.mjs: OK — 9 groups, every clause traced to a figure");
