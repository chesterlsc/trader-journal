// The landing product demo is a SCRIPTED replay, so its numbers are typed in
// by hand — which is exactly how they rot. Two honesty contracts pinned here:
//
//   1. The demo command line must still parse, with the real parser, into the
//      exact position the demo's chips claim (XAUUSD short, entry 4,234,
//      stop 4,244 = 10 pips, target 4,214 = 20 pips, size 0.02 lots, risk
//      $20 = 0.2% derived from the size on the labelled $10,000 demo
//      account, close P&L +$40). If the parser's grammar or the pip model
//      changes, this fails before the landing shows a parse the product
//      would no longer do.
//   2. The ticker strips in index.html must carry a price + delta node for
//      every symbol app.js polls, in every strip (marquee halves, dashboard
//      pair, sticky dock), and the "live · 5s" label must be printed while
//      the poll loop actually runs at 5s with no skip.
//
// Run: node tests/landingDemo.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseQuickTrade } from "../src/lib/tradeParse.js";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const appJs = read("app.js");
const html = read("index.html");

// --- 1. The demo command parses into the position the chips claim ----------
const commandMatch = /const LND_DEMO_COMMAND = "([^"]+)";/.exec(appJs);
assert.ok(commandMatch, "LND_DEMO_COMMAND no longer in app.js — demo removed or renamed");
const command = commandMatch[1];

const parsed = parseQuickTrade(command);
assert.ok(parsed.ok, `demo command "${command}" no longer parses: ${parsed.error}`);
assert.equal(parsed.value.symbol, "XAUUSD", "demo symbol chip is wrong");
assert.equal(parsed.value.direction, "Sell", "demo SHORT chip is wrong");
assert.equal(parsed.value.entryPrice, 4234, "demo entry chip is wrong");
assert.equal(parsed.value.stopLoss, 4244, "demo stop chip is wrong");
assert.equal(parsed.value.takeProfit, 4214, "demo target chip is wrong");
assert.equal(parsed.value.positionSize, 0.02, "demo size chip is wrong");

// XAUUSD pip model: pip size 1.0, $100 per pip per 1.0 lot. Stop distance 10
// = 10 pips, target distance 20 = 20 pips, so at 0.02 lots the risk is $20
// (0.2% of the labelled $10,000 demo account) and the winning close is +$40.
// These figures are hard-coded in the demo chips, the toast, and the
// close-sheet header — all of them must agree with the arithmetic.
const PIP_SIZE = 1;
const PIP_VALUE_PER_LOT = 100;
const DEMO_BALANCE = 10000;
const stopPips = Math.abs(parsed.value.entryPrice - parsed.value.stopLoss) / PIP_SIZE;
const targetPips = Math.abs(parsed.value.entryPrice - parsed.value.takeProfit) / PIP_SIZE;
assert.equal(stopPips, 10);
assert.equal(targetPips, 20);
const riskAmount = stopPips * PIP_VALUE_PER_LOT * parsed.value.positionSize;
assert.equal(riskAmount, 20);
assert.equal((riskAmount / DEMO_BALANCE) * 100, 0.2);
const closePnl = targetPips * PIP_VALUE_PER_LOT * parsed.value.positionSize;
assert.equal(closePnl, 40);
const rr = targetPips / stopPips;
assert.equal(rr, 2);

for (const claim of [
  "stop 4,244 · 10.0 pips",
  "risk $20.00 = 0.2% (from size)",
  "size 0.02 lots",
  "target 4,214 · 20.0 pips · R:R 2.00"
]) {
  assert.ok(appJs.includes(claim), `demo chip "${claim}" missing from app.js`);
}
for (const claim of [
  "0.02 lots at risk $20",

  "Short &middot; 0.02 lots",
  "+$40.00",
  "+20.0 pips"
]) {
  assert.ok(html.includes(claim), `demo frame claim "${claim}" missing from index.html`);
}
// The player keeps its name. The sample and demo chips were removed on an
// explicit request (2026-08-17): the figures stay scripted, the labels do not.
assert.ok(html.includes("Product demo"), "the demo section lost its 'Product demo' label");

// --- 2. Ticker strips match the polled symbols, and say live · 5s ----------
const symbolsMatch = /const TICKER_SYMBOLS = \[([^\]]+)\];/.exec(appJs);
assert.ok(symbolsMatch, "TICKER_SYMBOLS no longer in app.js");
const symbols = [...symbolsMatch[1].matchAll(/"([A-Z]+)"/g)].map((m) => m[1]);
assert.ok(symbols.length >= 2, "ticker pair shrank below two symbols");

for (const symbol of symbols) {
  const prices = html.split(`data-ticker-price="${symbol}"`).length - 1;
  const deltas = html.split(`data-ticker-delta="${symbol}"`).length - 1;
  // Every polled symbol rides both marquee halves (2); the compact dashboard
  // pair and the sticky dock carry only the first two symbols (+2).
  // BTC, spot gold and Micro Gold futures also ride the compact dashboard
  // pair and the sticky dock, so they carry 4 nodes rather than 2. MGC is
  // there because it is the instrument a prop trader is actually in, and
  // spot sits beside it so the basis between them is visible.
  const expected = ["BTCUSDT", "XAUUSD", "MGC"].includes(symbol) ? 4 : 2;
  assert.equal(prices, expected, `${symbol}: expected ${expected} price nodes, found ${prices}`);
  assert.equal(deltas, expected, `${symbol}: expected ${expected} delta nodes, found ${deltas}`);
}
const strips = html.split("data-ticker-strip").length - 1;
assert.equal(strips, 3, `expected the landing strip + dashboard pair + sticky dock, found ${strips} [data-ticker-strip]`);

// "live · 5s" may only be printed while it is true: one shared loop at 5s,
// no skip-every-other-tick branch for the landing.
assert.ok(/lnd-ticker-tag">live/.test(html), "the landing ticker lost its 'live · 5s' label");
assert.ok(/dash-ticker-tag">live/.test(html), "the dashboard ticker lost its 'live · 5s' label");
assert.ok(!/delayed/i.test(html), "a leftover 'delayed' label still in index.html");
assert.ok(/const LIVE_PRICE_REFRESH_MS = 5000;/.test(appJs), "the poll cadence moved off 5s — relabel the strips");
assert.ok(!appJs.includes("livePriceTickCount"), "the landing skip-tick branch is back — that makes 'live · 5s' a lie");

console.log(
  `landingDemo.check.mjs: OK — "${command}" parses to the position the demo claims (risk $20, +$40 close); ` +
    `${symbols.join("/")} nodes present in all three strips with the live · 5s label`
);
