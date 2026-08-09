// Drives the REAL 1f #04 playbook maths out of app.js (sliced by name, never
// copied) plus the two-segment hash router that reaches it.
//
// What would rot silently here:
//   * the expectancy CURVE quietly becoming a cumulative-P&L curve — both look
//     plausible on screen, only one answers "is this edge decaying";
//   * profit factor with no losing trade printing 999 instead of admitting it
//     cannot be computed;
//   * a setup's numbers being shown below the honesty threshold;
//   * "#playbook/Liquidity Grab" losing its second segment and dumping every
//     deep link on whichever setup happens to be busiest.
//
// Run: node tests/playbook.check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { round, clamp, escapeHtml, sortTradesAsc, sortTradesDesc } from "../src/lib/core.js";
import { formatCurrency } from "../src/lib/format.js";

const ROOT = "/Users/macbookairm3/Documents/Trader-Journal";
const appSrc = readFileSync(`${ROOT}/app.js`, "utf8");

function takeFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3);
}

// The honesty threshold is a number the page states out loud, so the test
// reads the real declaration rather than restating it.
const thresholdLine = /const PLAYBOOK_MIN_TRADES = (\d+);/.exec(appSrc);
assert.ok(thresholdLine, "PLAYBOOK_MIN_TRADES is gone from app.js");
const PLAYBOOK_MIN_TRADES = Number(thresholdLine[1]);
assert.ok(PLAYBOOK_MIN_TRADES >= 3, "a threshold below 3 trades is not a threshold");

const bundle = [
  `const PLAYBOOK_MIN_TRADES = ${PLAYBOOK_MIN_TRADES};`,
  takeFunction(appSrc, "getClosedTrades"),
  takeFunction(appSrc, "getPlaybookSetups"),
  takeFunction(appSrc, "isInlineImage"),
  takeFunction(appSrc, "playbookGroup"),
  takeFunction(appSrc, "buildPlaybookReport"),
  takeFunction(appSrc, "playbookMoney"),
  takeFunction(appSrc, "playbookTradeCount"),
  takeFunction(appSrc, "playbookExtremes"),
  takeFunction(appSrc, "playbookBarList"),
  takeFunction(appSrc, "viewHash"),
  takeFunction(appSrc, "getPlaybookSetupFromHash"),
  `return {
    PLAYBOOK_MIN_TRADES,
    getPlaybookSetups,
    isInlineImage,
    buildPlaybookReport,
    playbookExtremes,
    playbookBarList,
    playbookMoney,
    viewHash,
    getPlaybookSetupFromHash
  };`
].join("\n");

const state = { trades: [], playbook: { setup: "", curve: [], dates: [], key: "line" } };
const windowStub = { location: { hash: "" } };

const api = new Function(
  "state",
  "window",
  "round",
  "clamp",
  "escapeHtml",
  "sortTradesAsc",
  "sortTradesDesc",
  "formatCurrency",
  bundle
)(state, windowStub, round, clamp, escapeHtml, sortTradesAsc, sortTradesDesc, formatCurrency);

let id = 0;
function trade(overrides = {}) {
  id += 1;
  return {
    id: `t${id}`,
    createdAt: String(id).padStart(4, "0"),
    date: "2026-03-01",
    status: "closed",
    setupType: "Breakout",
    session: "London",
    timeframe: "H1",
    psychology: "Focused",
    asset: "EURUSD",
    notes: "",
    screenshotData: "",
    result: "Win",
    netPnl: 100,
    rMultiple: 1,
    ...overrides
  };
}

/* --- 1. The curve is expectancy, not cumulative P&L ----------------------- */
// Four winners then four losers: cumulative P&L would still end positive and
// look like a working setup. Running expectancy has to fall every step of the
// back half — that fall is the whole reason this chart exists.
state.trades = [
  ...[0, 1, 2, 3].map((i) => trade({ date: `2026-03-0${i + 1}`, netPnl: 300, result: "Win", rMultiple: 2 })),
  ...[4, 5, 6, 7].map((i) => trade({ date: `2026-03-0${i + 1}`, netPnl: -100, result: "Loss", rMultiple: -1 }))
];

const decaying = api.buildPlaybookReport("Breakout");
assert.equal(decaying.count, 8);
assert.equal(decaying.netPnl, 800);
assert.equal(decaying.curve.length, 8, "one curve point per trade in the setup");
assert.equal(decaying.curve[0], 300, "after one +300 trade the setup was worth 300/trade");
assert.equal(decaying.curve[3], 300);
assert.equal(decaying.curve[7], 100, "800 net over 8 trades = 100/trade");
assert.equal(decaying.curve[7], round(decaying.netPnl / decaying.count));
assert.ok(
  decaying.curve[7] < decaying.curve[3],
  "expectancy must FALL across the losing half — a rising tail here means the curve reverted to cumulative P&L"
);
assert.deepEqual(decaying.dates, state.trades.map((t) => t.date), "labels ride with the curve");
assert.equal(decaying.expectancy, 100);
assert.equal(decaying.winRate, 50);
assert.equal(decaying.profitFactor, 1200 / 400);
assert.equal(decaying.avgR, (4 * 2 + 4 * -1) / 8);
assert.equal(decaying.rCount, 8);

/* --- 2. Profit factor with no losses is not a number ---------------------- */
state.trades = [trade({ netPnl: 50 }), trade({ netPnl: 120 }), trade({ netPnl: 0, result: "Break Even" })];
const unbeaten = api.buildPlaybookReport("Breakout");
assert.equal(unbeaten.profitFactor, null, "no losing trade means profit factor cannot be computed — not 999");
assert.equal(unbeaten.netPnl, 170);
assert.equal(unbeaten.wins, 2, "a break-even trade is not a win");

// And with no risk distance recorded, average R is withheld the same way.
state.trades = [trade({ rMultiple: NaN }), trade({ rMultiple: NaN })];
assert.equal(api.buildPlaybookReport("Breakout").avgR, null);

/* --- 3. Open trades never reach the page --------------------------------- */
state.trades = [
  trade({ netPnl: 200 }),
  trade({ netPnl: 200 }),
  trade({ status: "open", netPnl: 0, setupType: "Breakout" }),
  trade({ setupType: "Reversal", netPnl: -40, result: "Loss" })
];
assert.deepEqual(
  api.getPlaybookSetups(),
  [
    { setup: "Breakout", trades: 2 },
    { setup: "Reversal", trades: 1 }
  ],
  "busiest setup first, open trades excluded"
);
assert.equal(api.buildPlaybookReport("Breakout").count, 2, "the open Breakout trade is not counted");

/* --- 4. Threshold: the page has enough to compute a count, never a stat --- */
assert.ok(
  api.buildPlaybookReport("Reversal").count < PLAYBOOK_MIN_TRADES,
  "fixture drifted — this setup must sit under the threshold"
);
// The report still carries the two FACTS the empty state is allowed to show.
assert.equal(api.buildPlaybookReport("Reversal").netPnl, -40);

/* --- 5. Best / worst, and the refusal to crown the only candidate --------- */
state.trades = [
  trade({ session: "London", timeframe: "H1", netPnl: 400 }),
  trade({ session: "London", timeframe: "H1", netPnl: 200 }),
  trade({ session: "Asia", timeframe: "M5", netPnl: -150, result: "Loss" }),
  trade({ session: "New York", timeframe: "M15", netPnl: 60 })
];
const spread = api.buildPlaybookReport("Breakout");
assert.deepEqual(
  spread.sessions.map((row) => row.label),
  ["London", "New York", "Asia"],
  "groups sort by net P&L descending, so best is first and worst is last"
);
assert.equal(spread.sessions[0].netPnl, 600);
assert.equal(spread.sessions[0].trades, 2);

const sessionCopy = api.playbookExtremes(spread.sessions, "session");
assert.match(sessionCopy, /Best session: London, \+\$600\.00 over 2 trades\./);
assert.match(sessionCopy, /Worst: Asia, −\$150\.00 over 1 trade\./);
assert.ok(!/1 trades/.test(sessionCopy), "singular trade count must not read '1 trades'");

state.trades = [trade({ session: "London" }), trade({ session: "London" })];
const single = api.buildPlaybookReport("Breakout");
const singleCopy = api.playbookExtremes(single.sessions, "session");
assert.match(singleCopy, /Only one session here: London, on all 2 trades\. Nothing to compare it against\./);
assert.ok(!/Best session/.test(singleCopy), "one group is a fact, not a ranking");
assert.equal(api.playbookExtremes([], "session"), "");

/* --- 6. Screenshots: inline images only, newest first --------------------- */
const PNG = "data:image/png;base64,AAAA";
state.trades = [
  trade({ date: "2026-03-01", screenshotData: PNG }),
  trade({ date: "2026-03-09", screenshotData: PNG }),
  trade({ date: "2026-03-05", screenshotData: "" }),
  // Not an inline image, so it is never rendered as a src.
  trade({ date: "2026-03-07", screenshotData: "javascript:alert(1)" })
];
const shots = api.buildPlaybookReport("Breakout").shots;
assert.deepEqual(shots.map((t) => t.date), ["2026-03-09", "2026-03-01"]);
assert.equal(api.isInlineImage("javascript:alert(1)"), false);
assert.equal(api.isInlineImage("DATA:IMAGE/JPEG;base64,x"), true, "scheme test is case-insensitive");
assert.equal(api.isInlineImage(""), false);

/* --- 7. The bar list escapes labels and never divides by zero ------------- */
const nastyBars = api.playbookBarList([
  { label: '<img src=x onerror="alert(1)">', trades: 1, wins: 1, netPnl: 0 }
]);
assert.ok(!nastyBars.includes("<img"), "group labels come from user data and must be escaped");
assert.match(nastyBars, /width:6%/, "a zero-net group still gets the minimum visible bar");

/* --- 8. The two-segment hash router -------------------------------------- */
state.playbook.setup = "Liquidity Grab";
assert.equal(api.viewHash("playbook"), "playbook/Liquidity%20Grab");
assert.equal(api.viewHash("journal"), "journal", "every other route stays a bare view id");
state.playbook.setup = "";
assert.equal(api.viewHash("playbook"), "playbook", "no setup yet means no second segment");

windowStub.location.hash = "#playbook/Liquidity%20Grab";
assert.equal(api.getPlaybookSetupFromHash(), "Liquidity Grab");
windowStub.location.hash = "#journal";
assert.equal(api.getPlaybookSetupFromHash(), "", "a non-playbook hash carries no setup");
windowStub.location.hash = "#playbook";
assert.equal(api.getPlaybookSetupFromHash(), "");
// A setup name may contain a slash; the tail rejoins rather than truncating.
state.playbook.setup = "Break / Retest";
windowStub.location.hash = `#${api.viewHash("playbook")}`;
assert.equal(api.getPlaybookSetupFromHash(), "Break / Retest");
// A hand-mangled percent escape must not throw the router.
windowStub.location.hash = "#playbook/%E0%A4%A";
assert.equal(api.getPlaybookSetupFromHash(), "");

/* --- 9. The page is wired to the router ---------------------------------- */
assert.match(appSrc, /if \(id === "playbook"\) \{\s*\n\s*renderPlaybookPage\(\);/, "switchView must render the page before showing it");
assert.match(appSrc, /const target = viewHash\(id\);/, "switchView must write the two-segment hash");
assert.match(appSrc, /setupChanged \|\| !isViewActive\(id\)/, "back/forward between two setup pages must not be swallowed");
const indexSrc = readFileSync(`${ROOT}/index.html`, "utf8");
assert.match(indexSrc, /id="playbookChart"/, "the expectancy curve canvas must exist");
const chartsSrc = readFileSync(`${ROOT}/src/modules/charts.js`, "utf8");
assert.match(chartsSrc, /state\.playbook\?\.curve/, "the curve must be hashed by the charts engine, not painted around it");
assert.match(chartsSrc, /ui\.playbookChart/, "the curve must be drawn by the shared line engine");

console.log(
  "playbook.check.mjs: OK — expectancy curve, thresholds at %d trades, groupings, screenshots and the #playbook/<setup> router",
  PLAYBOOK_MIN_TRADES
);
