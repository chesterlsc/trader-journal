// Headless check for src/lib/tradeParse.js — the ⌘K command-bar parser.
// A capture parser that silently mis-reads a stop saves a real position at the
// wrong size, so every branch that could do that is pinned here.
import assert from "node:assert";
import { parseQuickTrade, resolveSymbol, inferMarket } from "../src/lib/tradeParse.js";

const ok = (line) => {
  const result = parseQuickTrade(line);
  assert.ok(result.ok, `expected "${line}" to parse, got: ${result.error}`);
  return result.value;
};
const fails = (line, match) => {
  const result = parseQuickTrade(line);
  assert.ok(!result.ok, `expected "${line}" to fail`);
  if (match) {
    assert.match(result.error, match, `"${line}" → ${result.error}`);
  }
};

// The mockup's exact line.
assert.deepStrictEqual(ok("btc long 118400 sl 117900 1%"), {
  symbol: "BTCUSDT",
  market: "Crypto",
  direction: "Buy",
  entryPrice: 118400,
  stopLoss: 117900,
  takeProfit: 0,
  riskPercent: 1,
  riskCash: 0,
  positionSize: 0,
  stopPips: 0,
  targetPips: 0
});

// Aliases, casing, thousands separators, glued keywords, "=" and ":" forms.
assert.strictEqual(ok("GOLD short 3320 stop 3325").symbol, "XAUUSD");
assert.strictEqual(ok("btc long 118,400 sl 117,900").entryPrice, 118400);
assert.strictEqual(ok("btc long 118400 sl117900").stopLoss, 117900);
assert.strictEqual(ok("btc long 118400 sl=117900").stopLoss, 117900);
assert.strictEqual(ok("btc long entry:118400 sl:117900 tp:119500").takeProfit, 119500);

// Direction synonyms both ways.
assert.strictEqual(ok("eurusd buy 1.0850 sl 1.0820").direction, "Buy");
assert.strictEqual(ok("eurusd sell 1.0850 sl 1.0880").direction, "Sell");
assert.strictEqual(ok("eurusd short 1.0850 sl 1.0880").direction, "Sell");

// Risk as percent or cash, keyword or bare suffix.
assert.strictEqual(ok("btc long 118400 sl 117900 risk 2%").riskPercent, 2);
assert.strictEqual(ok("btc long 118400 sl 117900 $250").riskCash, 250);
assert.strictEqual(ok("btc long 118400 sl 117900 risk $250").riskCash, 250);
assert.strictEqual(ok("btc long 118400 sl 117900 0.5%").riskPercent, 0.5);

// Optional size and target.
assert.strictEqual(ok("btc long 118400 sl 117900 size 0.4").positionSize, 0.4);
assert.strictEqual(ok("btc long 118400 sl 117900 tp 119400").takeProfit, 119400);
// Positional fallback: entry, stop, target in spoken order.
assert.strictEqual(ok("btc long 118400 117900 119400").takeProfit, 119400);
// Noise words are ignored, not treated as the symbol.
assert.strictEqual(ok("go long the btc at 118400 sl 117900").symbol, "BTCUSDT");

// Postfix lot size: "0.02 lots" claims only the adjacent number, never a
// positional entry/stop/target.
assert.strictEqual(ok("xauusd short 4234 sl 4244 tp 4214 0.02 lots").positionSize, 0.02);
assert.strictEqual(ok("xau short 4234 4244 4214 0.5 lot").positionSize, 0.5);
assert.strictEqual(ok("btc long 118400 sl 117900 size 0.2").positionSize, 0.2);

// Pip-distance stops and targets: the parser records the DISTANCE and leaves
// the price at zero — the app resolves it against entry with the pip spec.
const pipStop = ok("xauusd short 4234 sl 10p tp 20p 0.02 lots");
assert.strictEqual(pipStop.stopPips, 10);
assert.strictEqual(pipStop.targetPips, 20);
assert.strictEqual(pipStop.stopLoss, 0);
assert.strictEqual(pipStop.takeProfit, 0);
const pipWords = ok("xauusd short 4234 sl 10 pips tp 20 pips");
assert.strictEqual(pipWords.stopPips, 10);
assert.strictEqual(pipWords.targetPips, 20);
// The unit word re-tags ONLY the immediately preceding assignment — a later
// "pips" can never turn the 4214 target price into 4,214 pips.
const loose = ok("xauusd short 4234 sl 4244 tp 4214 0.02 lots");
assert.strictEqual(loose.takeProfit, 4214);
assert.strictEqual(loose.targetPips, 0);

// Market inference feeds the pip model, so it must not drift.
assert.strictEqual(inferMarket("BTCUSDT"), "Crypto");
assert.strictEqual(inferMarket("EURUSD"), "Forex");
assert.strictEqual(inferMarket("XAUUSD"), "Metals");
assert.strictEqual(inferMarket("NAS100"), "Indices");
assert.strictEqual(inferMarket("AAPL"), "Other");
assert.strictEqual(resolveSymbol("btc"), "BTCUSDT");
assert.strictEqual(resolveSymbol("ethusdt"), "ETHUSDT");

// --- refusals. Unparseable input must SAY so, never save something wrong ---
fails("", /Type a trade/);
fails("long 118400 sl 117900", /No symbol/);
fails("btc 118400 sl 117900", /long or short/);
fails("btc long", /No entry/);
fails("btc long 118400", /No stop/);
// Stop on the wrong side is the expensive mistake: it inverts the risk.
fails("btc long 118400 sl 118900", /stop must sit below/);
fails("btc short 118400 sl 117900", /stop must sit above/);
fails("btc long 118400 sl 117900 tp 117000", /wrong side/);
fails("btc long 118400 sl 117900 maybe?", /Could not read/);

// A failed parse still returns what it understood, for the live readout.
const partial = parseQuickTrade("btc long 118400");
assert.strictEqual(partial.ok, false);
assert.strictEqual(partial.value.symbol, "BTCUSDT");
assert.strictEqual(partial.value.entryPrice, 118400);

console.log("tradeParse.check.mjs — all assertions passed");
