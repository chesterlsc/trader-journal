// The landing product demo is a SCRIPTED replay, so its numbers are typed in
// by hand — which is exactly how they rot. Two honesty contracts pinned here:
//
//   1. The demo command line must still parse, with the real parser, into the
//      exact position the demo's chips claim (BTCUSDT long, entry 118,400,
//      stop 117,900, risk 1% = $100 on the labelled $10,000 demo account,
//      size 0.20 BTC). If the parser's grammar changes, this fails before the
//      landing starts showing a parse the product would no longer do.
//   2. The ticker strips in index.html must carry a price + delta node for
//      every symbol app.js polls, in both marquee halves, and the "delayed"
//      label must actually be printed.
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
assert.equal(parsed.value.symbol, "BTCUSDT", "demo symbol chip is wrong");
assert.equal(parsed.value.direction, "Buy", "demo LONG chip is wrong");
assert.equal(parsed.value.entryPrice, 118400, "demo entry chip is wrong");
assert.equal(parsed.value.stopLoss, 117900, "demo stop chip is wrong");
assert.equal(parsed.value.riskPercent, 1, "demo risk chip is wrong");

// The demo states a $10,000 account, so risk 1% = $100 and size = $100 over
// the $500 stop distance = 0.2 BTC. These figures are hard-coded in the demo
// chips, the toast and the close-sheet header — all four must agree.
const DEMO_BALANCE = 10000;
const riskAmount = (DEMO_BALANCE * parsed.value.riskPercent) / 100;
assert.equal(riskAmount, 100);
const size = riskAmount / Math.abs(parsed.value.entryPrice - parsed.value.stopLoss);
assert.equal(size, 0.2);
for (const claim of ["risk 1% = $100", "size 0.20 BTC"]) {
  assert.ok(appJs.includes(claim), `demo chip "${claim}" missing from app.js`);
}
for (const claim of ["0.20 BTC at risk $100", "$10,000 demo account", "Long &middot; 0.20 BTC"]) {
  assert.ok(html.includes(claim), `demo frame claim "${claim}" missing from index.html`);
}
// The frame must say it is a demo with sample data, out loud.
assert.ok(html.includes("Product demo"), "the demo section lost its 'Product demo' label");
assert.ok(/demo &middot; sample data/.test(html), "the demo frame chrome lost its 'sample data' tag");

// --- 2. Ticker strips match the polled symbols, and say "delayed" ----------
const symbolsMatch = /const TICKER_SYMBOLS = \[([^\]]+)\];/.exec(appJs);
assert.ok(symbolsMatch, "TICKER_SYMBOLS no longer in app.js");
const symbols = [...symbolsMatch[1].matchAll(/"([A-Z]+)"/g)].map((m) => m[1]);
assert.ok(symbols.length >= 2, "ticker pair shrank below two symbols");

for (const symbol of symbols) {
  const prices = html.split(`data-ticker-price="${symbol}"`).length - 1;
  const deltas = html.split(`data-ticker-delta="${symbol}"`).length - 1;
  // Landing marquee halves (2) + dashboard pair (1) = 3 of each.
  assert.equal(prices, 3, `${symbol}: expected 3 price nodes (2 marquee halves + dashboard), found ${prices}`);
  assert.equal(deltas, 3, `${symbol}: expected 3 delta nodes, found ${deltas}`);
}
const strips = html.split('data-ticker-strip').length - 1;
assert.equal(strips, 2, `expected the landing strip + dashboard pair, found ${strips} [data-ticker-strip]`);
assert.ok(/lnd-ticker-tag">delayed</.test(html), "the landing ticker lost its 'delayed' label");
assert.ok(/dash-ticker-tag">delayed</.test(html), "the dashboard ticker lost its 'delayed' label");

console.log(
  `landingDemo.check.mjs: OK — "${command}" parses to the position the demo claims; ` +
    `${symbols.join("/")} nodes present in both strips with the delayed label`
);
