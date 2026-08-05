// The prop-firm evaluator, checked against the worked examples the firms
// publish themselves. These four are the ones that catch a wrong implementation
// immediately, and three of them are the exact scenarios in the research brief:
//
//   1. A trailing limit trails the CLOSED balance up and NEVER back down.
//   2. A limit that has reached its cap stays there forever.
//   3. A STATIC limit does not move at all — the room it leaves is bigger than
//      a naive "drawdown below current balance" reading suggests, and getting
//      this wrong is how a tracker lies about a 25K Static account.
//   4. Breach is "hit or go below" (<=), not "go below".
//
// Run: node tests/propRules.check.mjs
import assert from "node:assert/strict";
import {
  PROP_PRESETS,
  PROP_PRESET_AS_OF,
  defaultPropRules,
  evaluateProp,
  findPropPreset,
  mllPressure,
  normalizePropRules,
  propSteps
} from "../src/lib/propRules.js";

const day = (date, pnl) => ({ date, pnl });

// --- 1. Topstep's own 50K Combine example -----------------------------------
// "Start 50,000 / MLL 48,000. +500 → EOD 50,500, MLL 48,500. −500 next day →
//  balance 50,000, MLL STAYS 48,500."
{
  const rules = {
    enabled: true,
    drawdown: 2000,
    mode: "trailing",
    trailStops: true,
    trailStopAt: 50000,
    profitTarget: 3000
  };
  const opening = evaluateProp({ rules, startBalance: 50000, steps: [] });
  assert.equal(opening.mll, 48000, "the floor opens one drawdown below the start");

  const after = evaluateProp({
    rules,
    startBalance: 50000,
    steps: [day("2026-08-03", 500), day("2026-08-04", -500)]
  });
  assert.equal(after.balance, 50000, "the two days net to flat");
  assert.equal(after.peak, 50500, "the peak is the best closed balance, not the last one");
  assert.equal(after.mll, 48500, "the floor trailed up on the winning day and did not come back down");
  assert.equal(after.room, 1500, "room is balance minus floor");
  assert.equal(after.mllMoves.length, 1, "exactly one upward move, on the winning day");
  assert.deepEqual(after.mllMoves[0], { date: "2026-08-03", from: 48000, to: 48500 });
  assert.equal(after.status, "in-progress");
}

// --- 2. Topstep's own 50K Express Funded example ----------------------------
// "Start 0 / MLL −2,000. +1,000 → MLL −1,000. +1,000 (balance 2,000) → MLL
//  locks at 0 permanently."
{
  const rules = { enabled: true, drawdown: 2000, mode: "trailing", trailStops: true, trailStopAt: 0 };
  const one = evaluateProp({ rules, startBalance: 0, steps: [day("2026-08-03", 1000)] });
  assert.equal(one.mll, -1000, "an XFA floor starts negative and climbs");
  assert.equal(one.mllLocked, false);

  const two = evaluateProp({
    rules,
    startBalance: 0,
    steps: [day("2026-08-03", 1000), day("2026-08-04", 1000)]
  });
  assert.equal(two.mll, 0, "the floor caps at $0 and cannot go higher");
  assert.equal(two.mllLocked, true, "a floor sitting on its cap is locked");

  // Another 5,000 of profit must not lift the floor off its cap.
  const three = evaluateProp({
    rules,
    startBalance: 0,
    steps: [day("2026-08-03", 1000), day("2026-08-04", 1000), day("2026-08-05", 5000)]
  });
  assert.equal(three.mll, 0, "a locked floor never moves again");
  assert.equal(three.room, 7000);
}

// --- 3. Topstep's own 25K Static example ------------------------------------
// "With a $28,000 balance, the Trader has $4,000 of room — not $3,000."
// This is the one that punishes applying trailing maths to a static account.
{
  const rules = { enabled: true, drawdown: 1000, mode: "static", trailStops: true, trailStopAt: 25000 };
  const evaluation = evaluateProp({
    rules,
    startBalance: 25000,
    steps: [day("2026-08-03", 3000)]
  });
  assert.equal(evaluation.mll, 24000, "a static floor sits at start minus drawdown, forever");
  assert.equal(evaluation.room, 4000, "room grows with the balance because the floor does not move");
  assert.equal(evaluation.mllMoves.length, 0, "a static floor never moves, so it logs no moves");

  // The same numbers under trailing leave less room — proof the mode is doing
  // real work and is not cosmetic. Capped at the tier size the floor rises to
  // 25,000 (room 3,000); uncapped it rides the peak to 27,000 (room 1,000).
  const cappedTrail = evaluateProp({
    rules: { ...rules, mode: "trailing" },
    startBalance: 25000,
    steps: [day("2026-08-03", 3000)]
  });
  assert.equal(cappedTrail.mll, 25000, "a capped trail stops climbing at the cap");
  assert.equal(cappedTrail.room, 3000);

  const uncappedTrail = evaluateProp({
    rules: { ...rules, mode: "trailing", trailStops: false },
    startBalance: 25000,
    steps: [day("2026-08-03", 3000)]
  });
  assert.equal(uncappedTrail.mll, 27000, "an uncapped trail rides the peak with no ceiling");
  assert.equal(uncappedTrail.room, 1000, "which leaves a quarter of the room the static floor does");
}

// --- 4. Breach is "hit or go below" -----------------------------------------
{
  const rules = { enabled: true, drawdown: 2000, mode: "trailing", trailStops: true, trailStopAt: 50000 };

  const exactly = evaluateProp({ rules, startBalance: 50000, steps: [day("2026-08-03", -2000)] });
  assert.equal(exactly.status, "breached", "touching the limit is a breach, not a near miss");
  assert.equal(exactly.breachedOn, "2026-08-03");

  const justAbove = evaluateProp({ rules, startBalance: 50000, steps: [day("2026-08-03", -1999.99)] });
  assert.equal(justAbove.status, "in-progress", "a cent above the floor is not a breach");

  // A breach recorded on an early day survives a later recovery: the account
  // was gone at that moment and the tracker must not quietly un-breach it.
  const recovered = evaluateProp({
    rules,
    startBalance: 50000,
    steps: [day("2026-08-03", -2500), day("2026-08-04", 4000)]
  });
  assert.equal(recovered.status, "breached");
  assert.equal(recovered.breachedOn, "2026-08-03");
  assert.equal(recovered.breachBalance, 47500);
}

// --- Trailing basis: per-trade trails at least as fast as per-day ------------
// Two trades on one day, +800 then −500. Per-day the close is +300; per-trade
// the floor already trailed off the +800. The per-trade floor must be the
// tighter (higher) of the two — that is what makes it the conservative choice.
{
  const rules = { enabled: true, drawdown: 2000, mode: "trailing", trailStops: true, trailStopAt: 50000 };
  const trades = [
    { status: "closed", date: "2026-08-03", closedAt: "2026-08-03T14:00:00Z", netPnl: 800 },
    { status: "closed", date: "2026-08-03", closedAt: "2026-08-03T15:00:00Z", netPnl: -500 }
  ];

  const eod = evaluateProp({ rules, startBalance: 50000, steps: propSteps(trades, "eod") });
  const perTrade = evaluateProp({ rules, startBalance: 50000, steps: propSteps(trades, "trade") });

  assert.equal(eod.balance, perTrade.balance, "both bases end on the same money");
  assert.equal(eod.mll, 48300);
  assert.equal(perTrade.mll, 48800, "per-trade trailing caught the intraday high the day close hid");
  assert.ok(perTrade.mll > eod.mll, "the per-trade basis is never looser than the EOD basis");
}

// --- propSteps: open trades never count, ordering is stable -----------------
{
  const trades = [
    { status: "closed", date: "2026-08-04", netPnl: 100 },
    { status: "open", date: "2026-08-05", netPnl: 0 },
    { status: "closed", date: "2026-08-03", netPnl: -50 },
    { status: "closed", date: "2026-08-03", netPnl: 25 }
  ];
  assert.deepEqual(propSteps(trades, "eod"), [
    { date: "2026-08-03", pnl: -25 },
    { date: "2026-08-04", pnl: 100 }
  ]);
  assert.equal(propSteps(trades, "trade").length, 3, "an open trade has no closed P&L to step with");
}

// --- No drawdown entered means NO floor, not a floor at zero ----------------
{
  const evaluation = evaluateProp({
    rules: { enabled: true, drawdown: 0, mode: "trailing" },
    startBalance: 50000,
    steps: [day("2026-08-03", -900)]
  });
  assert.equal(evaluation.mll, null, "a limit nobody entered is not a limit of zero");
  assert.equal(evaluation.room, null);
  assert.equal(evaluation.status, "in-progress", "with no floor there is nothing to breach");
  assert.equal(mllPressure(evaluation, 300).level, "unknown");
}

// --- Consistency raises the target, it does not fail the account ------------
{
  const rules = { enabled: true, profitTarget: 3000, consistencyPct: 50, drawdown: 2000, trailStopAt: 50000 };
  // Best day 1,800 of 2,400 total = 75%. Target becomes 1,800 / 0.5 = 3,600.
  const evaluation = evaluateProp({
    rules,
    startBalance: 50000,
    steps: [day("2026-08-03", 1800), day("2026-08-04", 600)]
  });
  assert.equal(evaluation.bestDay, 1800);
  assert.equal(evaluation.netProfit, 2400);
  assert.equal(evaluation.effectiveTarget, 3600, "an outsized day raises the bar rather than failing it");
  assert.equal(evaluation.consistencyBreached, true);
  assert.equal(evaluation.status, "in-progress", "2,400 of a raised 3,600 target is not done");

  // Same profit spread evenly clears the original target untouched.
  const even = evaluateProp({
    rules,
    startBalance: 50000,
    steps: [day("2026-08-03", 1000), day("2026-08-04", 1000), day("2026-08-05", 1000)]
  });
  assert.equal(even.effectiveTarget, 3000, "a balanced run leaves the base target alone");
  assert.equal(even.status, "target-met");
  assert.equal(even.consistencyBreached, false);
}

// --- Off by default: consistency must not be asserted unasked ---------------
{
  const evaluation = evaluateProp({
    rules: { enabled: true, profitTarget: 3000, consistencyPct: 0 },
    startBalance: 50000,
    steps: [day("2026-08-03", 3000)]
  });
  assert.equal(evaluation.effectiveTarget, 3000, "consistencyPct 0 leaves the target exactly as typed");
  assert.equal(evaluation.consistencyRatio, null);
  assert.equal(evaluation.consistencyBreached, false);
}

// --- Daily budget: the tighter of the firm's limit and the trader's own -----
{
  const steps = [day("2026-08-05", -400)];
  const firmTighter = evaluateProp({
    rules: { enabled: true, dailyLossLimit: 500 },
    startBalance: 25000,
    steps,
    todayKey: "2026-08-05",
    personalDailyLimit: 800
  });
  assert.equal(firmTighter.dailyLimit, 500);
  assert.equal(firmTighter.dailyBinding, "firm");
  assert.equal(firmTighter.dailyUsed, 400);
  assert.equal(firmTighter.dailyLeft, 100);
  assert.equal(firmTighter.dailyBreached, false);

  const personalTighter = evaluateProp({
    rules: { enabled: true, dailyLossLimit: 1000 },
    startBalance: 25000,
    steps,
    todayKey: "2026-08-05",
    personalDailyLimit: 300
  });
  assert.equal(personalTighter.dailyLimit, 300, "the trader's own budget binds when it is tighter");
  assert.equal(personalTighter.dailyBinding, "personal");
  assert.equal(personalTighter.dailyBreached, true, "400 used against a 300 budget is spent");

  const none = evaluateProp({ rules: { enabled: true }, startBalance: 25000, steps, todayKey: "2026-08-05" });
  assert.equal(none.dailyLimit, 0);
  assert.equal(none.dailyLeft, null, "no budget means no headroom figure, not a headroom of zero");
}

// --- Days traded counts distinct dates, not trades --------------------------
{
  const evaluation = evaluateProp({
    rules: { enabled: true },
    startBalance: 50000,
    steps: [day("2026-08-03", 10), day("2026-08-03", 20), day("2026-08-04", 30)]
  });
  assert.equal(evaluation.daysTraded, 2);
  assert.equal(evaluation.stepCount, 3);
}

// --- mllPressure: the warning that has to fire BEFORE the breach ------------
{
  const rules = { enabled: true, drawdown: 2000, mode: "trailing", trailStops: true, trailStopAt: 50000 };
  const evaluation = evaluateProp({ rules, startBalance: 50000, steps: [day("2026-08-03", -1500)] });
  assert.equal(evaluation.room, 500);

  assert.deepEqual(mllPressure(evaluation, 400), { level: "warn", lossesLeft: 1, room: 500 });
  assert.deepEqual(mllPressure(evaluation, 600), { level: "warn", lossesLeft: 0, room: 500 });
  assert.deepEqual(mllPressure(evaluation, 150), { level: "safe", lossesLeft: 3, room: 500 });
  assert.equal(mllPressure(evaluation, 0).level, "unknown", "no losses on record is not a clean bill of health");

  const dead = evaluateProp({ rules, startBalance: 50000, steps: [day("2026-08-03", -2000)] });
  assert.deepEqual(mllPressure(dead, 100), { level: "breach", lossesLeft: 0, room: 0 });
}

// --- Presets are DEFAULTS, and every one of them is fully editable ----------
{
  assert.equal(PROP_PRESETS[0].id, "custom", "the first option prefills nothing");
  assert.equal(findPropPreset("nope"), null);

  const static25k = findPropPreset("ts-25k-static");
  assert.equal(static25k.rules.mode, "static", "the 25K Labs tier is STATIC — trailing maths would be wrong");
  assert.equal(static25k.account.startingBalance, 25000);
  assert.equal(static25k.rules.drawdown, 1000);

  const fiftyK = findPropPreset("ts-50k");
  assert.equal(fiftyK.rules.mode, "trailing");
  assert.equal(fiftyK.rules.trailStopAt, 50000, "the trail stops at the tier size");

  const xfa = findPropPreset("ts-50k-xfa");
  assert.equal(xfa.account.startingBalance, 0, "an Express Funded balance starts at zero, not at the tier name");
  assert.equal(xfa.rules.trailStopAt, 0);
  assert.equal(xfa.rules.drawdown, fiftyK.rules.drawdown, "XFA is derived from the Combine tier, so it cannot drift");

  assert.match(PROP_PRESET_AS_OF, /^\d{4}-\d{2}-\d{2}$/, "presets carry the date they were read");
  for (const preset of PROP_PRESETS) {
    assert.ok(preset.note && preset.note.length > 10, `${preset.id} must explain what it is prefilling`);
  }
}

// --- normalizePropRules: absent fields are absent, not zero ------------------
{
  const fresh = defaultPropRules(50000);
  assert.equal(fresh.enabled, false, "a new account is not a prop account until the trader says so");
  assert.equal(fresh.trailStopAt, 50000, "the trail cap seeds from the account's own starting balance");

  const loose = normalizePropRules(
    { enabled: 1, drawdown: "2000", mode: "nonsense", basis: "trade", flattenBy: "25:99", consistencyPct: 500 },
    50000
  );
  assert.equal(loose.enabled, true);
  assert.equal(loose.drawdown, 2000, "numeric strings coerce, as everything else in this codebase does");
  assert.equal(loose.mode, "trailing", "an unknown mode falls back to trailing, never to a made-up one");
  assert.equal(loose.basis, "trade");
  assert.equal(loose.flattenBy, "", "a nonsense clock time is dropped rather than displayed");
  assert.equal(loose.consistencyPct, 100, "a percentage is clamped to a percentage");

  assert.equal(normalizePropRules({}, 0).trailStops, true, "unanswered means the conservative answer");
  assert.equal(normalizePropRules({ trailStops: false }, 0).trailStops, false, "and an explicit no survives");
}

console.log("propRules.check.mjs: OK — %d presets, evaluator matches every published worked example", PROP_PRESETS.length);
