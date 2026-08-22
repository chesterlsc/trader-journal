// Drives the REAL 1e review filters out of app.js (sliced by name, no
// duplication). The chip row replaced a <select>, so the thing that would
// silently rot is the quick-filter predicate: a chip that quietly stops
// filtering looks identical to a chip that filters correctly.
// Run: node tests/reviewFilters.check.mjs
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

function takeConst(src, name, open, close) {
  const start = src.indexOf(`const ${name} = ${open}`);
  assert.ok(start >= 0, `missing const ${name}`);
  const end = src.indexOf(close, start);
  assert.ok(end > start, `unterminated const ${name}`);
  return src.slice(start, end + close.length);
}

const bundle = [
  takeConst(appSrc, "QUICK_FILTER_LABELS", "{", "};"),
  takeFunction(appSrc, "isTradeJournalled"),
  takeFunction(appSrc, "isRuleBroken"),
  takeFunction(appSrc, "getFilteredTrades"),
  takeFunction(appSrc, "formatIsoShort"),
  takeFunction(appSrc, "formatSignedR"),
  takeFunction(appSrc, "describeJournalFilters"),
  "return { getFilteredTrades, isRuleBroken, formatIsoShort, formatSignedR, describeJournalFilters };"
].join("\n");

const state = {
  trades: [],
  settings: { riskPerTrade: 1 },
  filters: {
    dateFrom: "",
    dateTo: "",
    market: "all",
    setup: "all",
    session: "all",
    timeframe: "all",
    psychology: "all",
    search: "",
    quick: "all"
  }
};

// eslint-disable-next-line no-new-func
const api = new Function("state", bundle)(state);

const trade = (over) => ({
  id: over.id,
  date: "2026-08-05",
  asset: "BTCUSDT",
  market: "Crypto",
  setupType: "Liquidity Grab",
  session: "London",
  timeframe: "H1",
  psychology: "Focused",
  status: "closed",
  result: "Win",
  riskPercent: 1,
  notes: "",
  journalledAt: "",
  ...over
});

state.trades = [
  trade({ id: "win", result: "Win", notes: "clean" }),
  trade({ id: "loss", result: "Loss", notes: "chased" }),
  trade({ id: "over", result: "Win", riskPercent: 2.5, notes: "sized up" }),
  trade({ id: "bare", result: "Loss" }), // closed, no note, never graded
  trade({ id: "live", status: "open", result: "Open" }) // open: no note is not a debt yet
];

const ids = () => api.getFilteredTrades().map((t) => t.id);
const withQuick = (quick, fn) => {
  state.filters.quick = quick;
  try {
    return fn();
  } finally {
    state.filters.quick = "all";
  }
};

assert.deepEqual(ids(), ["win", "loss", "over", "bare", "live"], "All shows everything");
assert.deepEqual(withQuick("wins", ids), ["win", "over"], "Wins is result === Win");
assert.deepEqual(withQuick("losses", ids), ["loss", "bare"], "Losses is result === Loss");
assert.deepEqual(withQuick("rules", ids), ["over"], "Rule broken is riskPercent over the cap");
assert.deepEqual(
  withQuick("nonote", ids),
  ["bare"],
  "No note is CLOSED and unjournalled — an open trade has nothing to journal yet"
);

/* The cap is a setting, not a constant: raising it must clear the chip. */
state.settings.riskPerTrade = 3;
assert.deepEqual(withQuick("rules", ids), [], "raising the per-trade cap clears Rule broken");
state.settings.riskPerTrade = 1;

/* Chips AND with the dropdowns rather than replacing them. */
state.filters.session = "New York";
assert.deepEqual(ids(), [], "a session nobody traded filters everything out");
state.filters.session = "London";
assert.deepEqual(withQuick("wins", ids), ["win", "over"], "session + chip compose");
state.filters.session = "all";

/* Header line: every clause has to come from a filter that is really on. */
assert.deepEqual(api.describeJournalFilters(), [], "an unfiltered journal describes nothing");
state.filters.quick = "nonote";
state.filters.dateFrom = "2026-08-01";
state.filters.dateTo = "2026-08-05";
state.filters.setup = "Breakout";
assert.deepEqual(
  api.describeJournalFilters(),
  ["not journalled", "Aug 01 to Aug 05", "Breakout"],
  "chip, date range and dropdown all appear, in reading order"
);
state.filters.dateTo = "2026-08-01";
assert.deepEqual(
  api.describeJournalFilters()[1],
  "Aug 01",
  "a single-day range reads as one date, not a range of one"
);
Object.assign(state.filters, { quick: "all", dateFrom: "", dateTo: "", setup: "all" });

/* Signs are the non-colour half of the win/loss signal (WCAG 1.4.1). */
assert.equal(api.formatSignedR(2.4), "+2.40R");
assert.equal(api.formatSignedR(-1), "-1.00R");
assert.equal(api.formatSignedR(0), "0.00R", "break-even is unsigned, not '+0.00R'");
assert.equal(api.formatSignedR(Number.NaN), "0.00R");
assert.equal(api.formatIsoShort("2026-08-05"), "Aug 05");
assert.equal(api.formatIsoShort("nonsense"), "nonsense", "an unparseable date is echoed, never faked");

console.log("OK — 5 quick filters, filter description, signed R");
