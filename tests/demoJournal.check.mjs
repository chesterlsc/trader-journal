// Drives the REAL sample-journal generator and the REAL trade metric math out
// of app.js (sliced by name, no duplication) and asserts the seeded demo
// journal is a believable, correctly-priced month. Run: node demo-journal-check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = "/Users/macbookairm3/Documents/Trader-Journal";
const appSrc = readFileSync(`${ROOT}/app.js`, "utf8");
const coreSrc = readFileSync(`${ROOT}/src/lib/core.js`, "utf8");

// Top-level `function name(...) { ... }` blocks end at a `}` in column 0.
function takeFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3);
}

function takeConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `missing const ${name}`);
  const end = src.indexOf("\n];", start) >= 0 && src.indexOf("\n];", start) < src.indexOf(";\n", start) + 2
    ? src.indexOf("\n];", start) + 3
    : src.indexOf(";\n", start) + 2;
  return src.slice(start, end);
}

const DEMO_CONSTS = [
  "DEMO_BATCH_ID",
  "DEMO_REFLECTION_TAG",
  "DEMO_TRADE_NOTE_PREFIX",
  "DEMO_INSTRUMENTS",
  "DEMO_OUTCOMES_R",
  "DEMO_DAYS_AGO",
  "DEMO_SESSIONS",
  "DEMO_SETUPS",
  "DEMO_TIMEFRAMES",
  "DEMO_PSYCHOLOGY",
  "DEMO_EXECUTION",
  // 1f #02: the sample rows carry a sample checklist history.
  "DEFAULT_PRE_TRADE_RULES"
].map((name) => takeConst(appSrc, name)).join("\n");

const bundle = [
  takeFunction(coreSrc, "round"),
  takeFunction(coreSrc, "toDateInputValue"),
  DEMO_CONSTS,
  takeFunction(appSrc, "buildDemoJournal"),
  takeFunction(appSrc, "calculateTradeMetrics"),
  takeFunction(appSrc, "getPipSpec"),
  takeFunction(appSrc, "inferPipSizeFromPrice"),
  takeFunction(appSrc, "isCryptoMarketSymbol"),
  "return { buildDemoJournal, calculateTradeMetrics };"
]
  .join("\n")
  .replace(/^export function/gm, "function");

// calculateTradeMetrics reads state.settings for the no-stop risk fallback.
const state = { settings: { startingBalance: 10000 } };
// eslint-disable-next-line no-new-func
const { buildDemoJournal, calculateTradeMetrics } = new Function("state", bundle)(state);

const { trades, reflections } = buildDemoJournal();

// --- shape -----------------------------------------------------------------
assert.equal(trades.length, 17, "16 closed + 1 open");
assert.equal(trades.filter((t) => t.status === "open").length, 1, "exactly one open position");
assert.equal(reflections.length, 2);
assert.ok(
  trades.every((t) => t.importBatchId === "demo-sample-journal"),
  "every sample row carries the demo batch id so carry-over can exclude it"
);
assert.ok(
  trades.every((t) => t.notes.startsWith("SAMPLE DATA:")),
  "every sample row is labelled in its notes"
);
assert.ok(reflections.every((r) => r.tags.includes("sample")));
assert.ok(new Set(trades.map((t) => t.id)).size === trades.length, "ids unique");
assert.ok(new Set(trades.map((t) => t.asset)).size >= 4, "several instruments");
assert.ok(new Set(trades.map((t) => t.setupType)).size >= 4, "several setups");
assert.ok(new Set(trades.map((t) => t.session)).size >= 3, "several sessions");
assert.ok(new Set(trades.map((t) => t.psychology)).size >= 3, "several psychology ratings");

// --- span ------------------------------------------------------------------
const days = trades.map((t) => t.date).sort();
const spanDays = (new Date(days[days.length - 1]) - new Date(days[0])) / 86400000;
assert.ok(spanDays >= 25 && spanDays <= 30, `~4 weeks, got ${spanDays}`);

// --- money -----------------------------------------------------------------
const closed = trades.filter((t) => t.status === "closed");
const expectedR = [2, -1, 1.6, 2.4, -1, 0, 2.2, -1, 1.4, 3, -1, -0.6, 1.8, 2.6, -1, 1.2];
let total = 0;
closed.forEach((trade, i) => {
  const m = calculateTradeMetrics(trade);
  assert.ok(
    Math.abs(m.riskAmount - 100) < 0.5,
    `${trade.asset} risk should be ~1% of 10k, got ${m.riskAmount}`
  );
  assert.ok(
    Math.abs(m.rMultiple - expectedR[i]) < 0.02,
    `${trade.asset} #${i} R: want ${expectedR[i]}, got ${m.rMultiple}`
  );
  total += m.netPnl;
});
assert.ok(Math.abs(total - 1260) < 5, `~+$1,260 over the month, got ${total}`);

const wins = closed.filter((t) => calculateTradeMetrics(t).netPnl > 0).length;
const losses = closed.filter((t) => calculateTradeMetrics(t).netPnl < 0).length;
assert.equal(wins, 9);
assert.equal(losses, 6);

// Open position: priced live, so netPnl/pips must be zero at rest and the
// stop/target must bracket the entry in the trade's direction.
const open = trades.find((t) => t.status === "open");
assert.equal(open.exitPrice, 0);
assert.ok(open.stopLoss < open.entryPrice && open.takeProfit > open.entryPrice, "long brackets entry");
assert.equal(open.asset, "XAUUSD", "the live-price proxy supports XAUUSD");

console.log(
  `PASS  ${closed.length} closed + 1 open, ${wins}W/${losses}L, ` +
    `net $${total.toFixed(2)}, span ${spanDays}d, ${reflections.length} reflections`
);
