// Drives the REAL 1f #02/#03 logic out of app.js (sliced by name, no
// duplication). Two things here are load-bearing and would rot silently:
//   #02 the rule-cost split, whose whole honesty rests on telling "never
//       asked" apart from "asked and skipped";
//   #03 the cooldown trigger, which decides when the app puts a speed bump in
//       front of a losing trader.
// Run: node tests/systemFeatures.check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { evaluateProp, mllPressure, propSteps } from "../src/lib/propRules.js";
import { toDateInputValue } from "../src/lib/core.js";

const ROOT = "/Users/macbookairm3/Documents/Trader-Journal";
const appSrc = readFileSync(`${ROOT}/app.js`, "utf8");
const coreSrc = readFileSync(`${ROOT}/src/lib/core.js`, "utf8");

function takeFunction(src, name) {
  const start = src.search(new RegExp(`^(export )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3).replace(/^export function/, "function");
}

function takeConst(src, name, open, close) {
  const start = src.indexOf(`const ${name} = ${open}`);
  assert.ok(start >= 0, `missing const ${name}`);
  const end = src.indexOf(close, start);
  assert.ok(end > start, `unterminated const ${name}`);
  return src.slice(start, end + close.length);
}

const bundle = [
  "const RULE_COST_MIN_SIDE = 5;",
  takeConst(appSrc, "DEFAULT_PRE_TRADE_RULES", "[", "];"),
  takeFunction(coreSrc, "sortTradesAsc"),
  takeFunction(coreSrc, "sortTradesDesc"),
  takeFunction(coreSrc, "ensureNonNegative"),
  takeFunction(coreSrc, "clamp"),
  takeFunction(appSrc, "getClosedTrades"),
  takeFunction(appSrc, "getPreTradeRules"),
  takeFunction(appSrc, "preTradeRuleLabel"),
  takeFunction(appSrc, "slugifyRuleId"),
  takeFunction(appSrc, "normalizePreTradeRules"),
  takeFunction(appSrc, "computeRuleCosts"),
  takeFunction(appSrc, "computeCooldownCost"),
  takeFunction(appSrc, "getConsecutiveLosses"),
  // The prop-firm limits are a cooldown TRIGGER, not a parallel interlock, so
  // the real functions come along rather than being stubbed — that is the only
  // way this file can prove a prop breach outranks the personal budgets.
  takeFunction(appSrc, "getAccounts"),
  takeFunction(appSrc, "getActiveAccount"),
  takeFunction(appSrc, "typicalLossSize"),
  takeFunction(appSrc, "getActivePropEvaluation"),
  takeFunction(appSrc, "getCooldownState"),
  // getCooldownState formats figures and asks whether the app is reachable;
  // neither is what this test is about.
  "function canAccessApp() { return true; }",
  "function formatCurrency(v) { return `$${Number(v).toFixed(2)}`; }",
  "function formatSignedCurrency(v) { return (v >= 0 ? '+' : '-') + formatCurrency(Math.abs(v)); }",
  "return { normalizePreTradeRules, preTradeRuleLabel, computeRuleCosts, computeCooldownCost, getConsecutiveLosses, getCooldownState, getActivePropEvaluation };"
].join("\n");

const state = {
  trades: [],
  analytics: { todayPnl: 0, weekPnl: 0 },
  settings: {
    preTradeRules: DEFAULTS(),
    dailyMaxLoss: 300,
    weeklyMaxLoss: 1000,
    cooldownEnabled: true,
    cooldownLossStreak: 3,
    // One plain account with no firm rules: the default every pre-accounts
    // journal migrates into, so the assertions above run unchanged.
    accounts: [{ id: "acct-main", label: "Main", startingBalance: 10000, archived: false, prop: { enabled: false } }],
    activeAccountId: "acct-main"
  }
};

function DEFAULTS() {
  return [
    { id: "playbook", label: "Setup is in my playbook" },
    { id: "no-news", label: "No news inside 15 minutes" }
  ];
}

// eslint-disable-next-line no-new-func
const api = new Function(
  "state",
  "evaluateProp",
  "propSteps",
  "mllPressure",
  "toDateInputValue",
  bundle
)(state, evaluateProp, propSteps, mllPressure, toDateInputValue);

/* ── #02 the editor's normaliser ─────────────────────────────────────────── */
assert.deepEqual(
  api.normalizePreTradeRules([{ id: "", label: "  No news inside 15 minutes  " }]),
  [{ id: "no-news-inside-15-minutes", label: "No news inside 15 minutes" }],
  "a new rule is slugged from its label and trimmed"
);
assert.deepEqual(
  api.normalizePreTradeRules([{ id: "playbook", label: "Renamed rule" }]),
  [{ id: "playbook", label: "Renamed rule" }],
  "an EXISTING rule keeps its id through a rename — trades store the id"
);
assert.deepEqual(api.normalizePreTradeRules([{ label: "   " }, null, 7]), [], "blank rules are dropped");
assert.equal(
  api.normalizePreTradeRules([{ label: "Same" }, { label: "Same" }]).map((r) => r.id).join(","),
  "same,same-2",
  "duplicate slugs are made unique, never collapsed"
);
assert.equal(api.normalizePreTradeRules(Array.from({ length: 20 }, (_, i) => ({ label: `r${i}` }))).length, 8);

/* ── #02 the rule-cost split ─────────────────────────────────────────────── */
const closed = (over) => ({
  id: over.id,
  status: "closed",
  result: over.netPnl > 0 ? "Win" : over.netPnl < 0 ? "Loss" : "Break Even",
  psychology: "Focused",
  preTradeRules: [],
  preTradeRulesAsked: [],
  cooldownOverride: false,
  ...over
});

const ALL = ["playbook", "no-news"];
// Five ticked at +100 each, five skipped at -100 each: both sides clear the
// threshold, so no-news gets a verdict.
state.trades = [
  ...Array.from({ length: 5 }, (_, i) =>
    closed({ id: `kept${i}`, netPnl: 100, preTradeRulesAsked: ALL, preTradeRules: ALL })
  ),
  ...Array.from({ length: 5 }, (_, i) =>
    closed({ id: `skip${i}`, netPnl: -100, preTradeRulesAsked: ALL, preTradeRules: ["playbook"] })
  ),
  // The trap: a legacy / command-bar / imported row. preTradeRules is empty
  // but so is preTradeRulesAsked, so it is NOT five skips — it is silence.
  closed({ id: "legacy", netPnl: -5000 })
];

const byId = Object.fromEntries(api.computeRuleCosts().map((cost) => [cost.rule.id, cost]));
assert.equal(byId["no-news"].skippedCount, 5, "the legacy row is not counted as a skip");
assert.equal(byId["no-news"].skippedPnl, -500, "and its -5000 never lands in the verdict");
assert.equal(byId["no-news"].keptCount, 5);
assert.equal(byId["no-news"].keptPnl, 500);
assert.equal(byId["no-news"].ready, true, "5 a side is the documented threshold");
assert.equal(byId.playbook.skippedCount, 0);
assert.equal(byId.playbook.ready, false, "a rule nobody skipped has nothing to compare");

state.trades.pop(); // drop one skip → 4 a side
state.trades = state.trades.filter((t) => t.id !== "skip4");
assert.equal(
  api.computeRuleCosts().find((c) => c.rule.id === "no-news").ready,
  false,
  "four on a side is below the threshold and must not render a number"
);

/* ── #02 labels survive a deleted rule ───────────────────────────────────── */
state.settings.preTradeRules = [{ id: "playbook", label: "Setup is in my playbook" }];
assert.equal(
  api.preTradeRuleLabel("no-news"),
  "No news inside 15 minutes",
  "a deleted rule still resolves through the seed list for historic rows"
);
assert.equal(api.preTradeRuleLabel("gone-forever"), "gone-forever", "an unknown id echoes, never blanks");
state.settings.preTradeRules = DEFAULTS();

/* ── #03 the cooldown trigger ────────────────────────────────────────────── */
const loss = (id, date) => closed({ id, date, netPnl: -100, closedAt: `${date}T12:00:00.000Z` });
const win = (id, date) => closed({ id, date, netPnl: 100, closedAt: `${date}T12:00:00.000Z` });

state.trades = [win("a", "2026-08-01"), loss("b", "2026-08-02"), loss("c", "2026-08-03")];
assert.equal(api.getConsecutiveLosses(), 2, "counts back from the most recent close");
assert.equal(api.getCooldownState(), null, "two losses is under the configured three");

state.trades.push(loss("d", "2026-08-04"));
assert.equal(api.getConsecutiveLosses(), 3);
assert.equal(api.getCooldownState().reason, "streak");

state.settings.cooldownLossStreak = 0;
assert.equal(api.getCooldownState(), null, "0 turns the streak trigger off");
state.settings.cooldownLossStreak = 3;

state.settings.cooldownEnabled = false;
assert.equal(api.getCooldownState(), null, "the whole feature is switchable");
state.settings.cooldownEnabled = true;

// Budgets outrank the streak, and the weekly outranks the daily.
state.analytics.todayPnl = -350;
assert.equal(api.getCooldownState().reason, "daily");
state.analytics.weekPnl = -1400;
assert.equal(api.getCooldownState().reason, "weekly");

state.settings.dailyMaxLoss = 0;
state.settings.weeklyMaxLoss = 0;
assert.equal(
  api.getCooldownState().reason,
  "streak",
  "an unset budget cannot be breached — it falls through to the streak"
);

/* ── prop-firm limits feed the SAME speed bump ───────────────────────────── */
// A firm limit is not a second interlock bolted alongside the cooldown; it is
// another trigger for the one that already exists. And it outranks the
// personal budgets, because it ends the account rather than the day.
state.settings.dailyMaxLoss = 300;
state.settings.weeklyMaxLoss = 1000;
state.analytics.todayPnl = 0;
state.analytics.weekPnl = 0;
state.settings.cooldownLossStreak = 0;

const propAccount = state.settings.accounts[0];
propAccount.startingBalance = 50000;
propAccount.prop = {
  enabled: true,
  drawdown: 2000,
  mode: "trailing",
  basis: "eod",
  trailStops: true,
  trailStopAt: 50000,
  profitTarget: 3000,
  dailyLossLimit: 0
};

// Plenty of room and small losses: no speed bump.
state.trades = [closed({ id: "p1", date: "2026-08-01", netPnl: -200, closedAt: "2026-08-01T12:00:00.000Z" })];
assert.equal(api.getActivePropEvaluation().room, 1800);
assert.equal(api.getCooldownState(), null, "an account with room does not trip the bump");

// Room down to 300 with a typical loss of 200 — one more, then the next
// breaches. The warning has to arrive HERE, before the breach.
state.trades.push(closed({ id: "p2", date: "2026-08-02", netPnl: -1500, closedAt: "2026-08-02T12:00:00.000Z" }));
assert.equal(api.getActivePropEvaluation().room, 300);
assert.equal(api.getCooldownState().reason, "prop-room", "the bump fires on room, not on the breach");

// And the breach itself outranks a simultaneously-breached personal budget.
state.analytics.todayPnl = -350;
state.analytics.weekPnl = -1400;
assert.equal(api.getCooldownState().reason, "prop-room", "a prop limit outranks the personal budgets");

state.trades.push(closed({ id: "p3", date: "2026-08-03", netPnl: -400, closedAt: "2026-08-03T12:00:00.000Z" }));
const breached = api.getActivePropEvaluation();
assert.equal(breached.status, "breached");
assert.equal(api.getCooldownState().reason, "prop-mll");

// A firm daily limit trips it too, without any max-loss trouble.
state.trades = [closed({ id: "p4", date: toDateInputValue(new Date()), netPnl: -600, closedAt: "2026-08-05T12:00:00.000Z" })];
propAccount.prop.dailyLossLimit = 500;
assert.equal(api.getCooldownState().reason, "prop-daily");

// Switching the account's prop rules off removes the trigger entirely — the
// personal budgets are back in charge.
propAccount.prop.enabled = false;
assert.equal(api.getActivePropEvaluation(), null, "no prop rules, no prop evaluation");
assert.equal(api.getCooldownState().reason, "weekly", "the personal budgets are still doing their job");

state.settings.cooldownLossStreak = 3;
state.analytics.todayPnl = 0;
state.analytics.weekPnl = 0;

/* ── #03 the override log ────────────────────────────────────────────────── */
state.trades = [
  closed({ id: "x", netPnl: -220, cooldownOverride: true, psychology: "Revenge Trade" }),
  closed({ id: "y", netPnl: 60, cooldownOverride: true }),
  closed({ id: "z", netPnl: 900 })
];
assert.deepEqual(api.computeCooldownCost(), { count: 2, pnl: -160, revenge: 1 });

console.log("OK — rule ids, rule-cost split (asked ≠ ticked), cooldown triggers, override log");
