// Drives the REAL 1f #05 equity-scrub mapping out of app.js (sliced by name,
// never copied). The playhead hands app.js an index into analytics.equity and
// app.js has to name the trade behind it.
//
// What would rot silently here:
//   * the off-by-one — equity[0] is the STARTING BALANCE, not a trade, so
//     equity[i] belongs to ordered[i - 1]. Get it wrong and the panel shows a
//     confident, plausible, wrong trade under the finger;
//   * the ordering drifting away from calculateAnalytics' own `ordered`, which
//     is what the curve was built from;
//   * open trades leaking in — the curve is closed trades only;
//   * the screen-reader sentence claiming an R the trade never recorded.
//
// Run: node tests/equityScrub.check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { sortTradesAsc } from "../src/lib/core.js";
import { formatCurrency } from "../src/lib/format.js";

const appSrc = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function takeFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3);
}

const state = { trades: [] };
const bundle = [
  takeFunction(appSrc, "getClosedTrades"),
  takeFunction(appSrc, "equityScrubTradeAt"),
  takeFunction(appSrc, "equityScrubValueText"),
  "return { equityScrubTradeAt, equityScrubValueText };"
].join("\n\n");
const { equityScrubTradeAt, equityScrubValueText } = new Function(
  "state",
  "sortTradesAsc",
  "formatCurrency",
  bundle
)(state, sortTradesAsc, formatCurrency);

const trade = (id, date, extra = {}) => ({
  id,
  date,
  asset: `SYM${id}`,
  setupType: "Breakout continuation",
  session: "New York",
  netPnl: 100,
  rMultiple: 1.5,
  notes: "",
  status: "closed",
  ...extra
});

// Deliberately out of order, with an open trade in the middle: the curve is
// built from closed trades sorted ascending, and the scrub has to agree.
state.trades = [
  trade(3, "2026-01-06", { netPnl: -220 }),
  trade(9, "2026-01-09", { status: "open", netPnl: 0 }),
  trade(1, "2026-01-02", { netPnl: 420 }),
  trade(2, "2026-01-03", { netPnl: 0, rMultiple: NaN })
];

const ordered = state.trades.filter((t) => t.status !== "open").slice().sort(sortTradesAsc);
assert.strictEqual(ordered.length, 3, "the fixture must leave three closed trades");

// The whole feature in one line: equity[0] is the opening balance.
assert.strictEqual(equityScrubTradeAt(0), null, "index 0 is the starting balance, not a trade");
ordered.forEach((expected, i) => {
  assert.strictEqual(
    equityScrubTradeAt(i + 1)?.id,
    expected.id,
    `equity point ${i + 1} must name the ${i + 1}th closed trade in ascending order`
  );
});
// Never the open trade, at any index.
for (let i = 0; i <= ordered.length + 2; i += 1) {
  assert.notStrictEqual(equityScrubTradeAt(i)?.id, 9, "an open trade is not on the equity curve");
}
assert.strictEqual(equityScrubTradeAt(ordered.length + 1), null, "past the end is nothing, not the last trade");
[null, undefined, NaN, -1, "2"].forEach((bad) => {
  assert.strictEqual(equityScrubTradeAt(bad), null, `equityScrubTradeAt(${String(bad)}) must be null`);
});

// --- the sentence a screen reader hears ------------------------------------
const COUNT = ordered.length + 1;
assert.strictEqual(equityScrubValueText(null, null, COUNT), "No point selected");
assert.strictEqual(equityScrubValueText(9, null, COUNT), "No point selected", "out of range says nothing");

const first = equityScrubValueText(0, null, COUNT);
assert.match(first, /Point 1 of 4/);
assert.match(first, /Starting balance/i);
assert.doesNotMatch(first, /\bR\b/, "the opening balance has no R to report");

const win = equityScrubValueText(1, equityScrubTradeAt(1), COUNT);
assert.match(win, /Point 2 of 4/);
assert.match(win, /SYM1/, "the symbol must be spoken");
assert.match(win, /Breakout continuation/, "the setup must be spoken");
assert.match(win, /New York/, "the session must be spoken");
assert.match(win, /net up \$420/, "a winner must be spoken as up, not as a colour");

// Ascending by date puts the −$220 trade last, and the breakeven one in the
// middle. "up $0.00" would be a small lie, so a flat trade says flat.
const loss = equityScrubValueText(3, equityScrubTradeAt(3), COUNT);
assert.match(loss, /net down \$220/, "a loser must be spoken as down, and never as a negative-looking dash");
assert.match(loss, /1\.50 R/);

const flat = equityScrubValueText(2, equityScrubTradeAt(2), COUNT);
assert.match(flat, /net flat/, "a breakeven trade is not an up trade");

// An R nobody recorded is never invented.
const noR = flat;
assert.match(noR, /SYM2/);
assert.doesNotMatch(noR, /R\./, "a missing R multiple must be omitted, not printed as 0 or NaN");
assert.doesNotMatch(noR, /NaN|undefined/, "nothing undefined may reach a screen reader");

// --- the panel and the canvas are wired to each other ----------------------
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="equityChart"[\s\S]{0,400}role="slider"/, "the curve must expose itself as a slider");
assert.match(html, /id="equityChart"[\s\S]{0,400}tabindex="0"/, "the curve must be keyboard reachable");
["equityScrub", "equityScrubPos", "equityScrubSymbol", "equityScrubNet", "equityScrubMeta", "equityScrubNote", "equityScrubShot", "equityScrubClear"].forEach(
  (id) => assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`)
);

const clay = readFileSync(new URL("../clay-v2.css", import.meta.url), "utf8");
// Without pan-y a horizontal-drag handler on a full-width canvas is a phone
// that will not scroll past the dashboard.
assert.match(clay, /#equityChart\s*\{[^}]*touch-action:\s*pan-y/, "the curve must leave vertical scrolling to the page");
assert.match(clay, /#equityChart:focus-visible\s*\{/, "a focusable canvas needs a visible focus state");

console.log("equityScrub.check.mjs: OK — %d closed trades mapped, %d aria sentences", ordered.length, 5);
