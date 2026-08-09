/* ══ PROP-FIRM EVALUATION MATHS ══════════════════════════════════════════════
   Pure arithmetic over the trader's OWN closed trades and the limits THEY
   typed in. There is not one firm's rule hard-coded in the evaluator — the
   only numbers in this file live in PROP_PRESETS, and those exist solely to
   prefill a form the trader then edits and confirms against their own account.

   Why that matters: prop-firm parameters are product decisions, not physics.
   During the research pass for this feature Topstep's own legal page and its
   help centre disagreed with each other about payout caps, and three of the
   parameter articles had been edited inside the previous five weeks. A tracker
   that bakes in `drawdown = 2000` starts lying the first time a firm reprices.
   So every preset carries the date it was read (PROP_PRESET_AS_OF) and every
   value it seeds is editable and persisted per account.

   No DOM, no storage, no fetch — which is what lets the worked examples from
   the research brief run as assertions in tests/propRules.check.mjs. */

export const PROP_PRESET_AS_OF = "2026-08-05";

function num(value, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/* ── The rule set, per account ─────────────────────────────────────────────
   Every field is user-editable and persisted. `mode` and `basis` are separate
   on purpose: a firm can ship both a trailing and a static drawdown on the
   same product line (Topstep does), so drawdown behaviour is never inferred
   from a tier name.

   basis:
     "eod"   — the limit trails the end-of-day CLOSED balance.
     "trade" — the limit trails after every closed trade. This is the closest a
               journal of closed trades can get to an intraday-peak rule, and
               it is the CONSERVATIVE choice: it trails at least as fast as an
               EOD rule, so the floor it draws is never looser than reality.
               It is still not a real intraday peak — the app never sees one. */
export function defaultPropRules(startBalance = 0) {
  return {
    enabled: false,
    firm: "",
    presetId: "custom",
    presetAsOf: "",
    profitTarget: 0,
    drawdown: 0,
    mode: "trailing",
    basis: "eod",
    trailStops: true,
    trailStopAt: num(startBalance),
    dailyLossLimit: 0,
    consistencyPct: 0,
    maxContracts: 0,
    flattenBy: "",
    confirmed: false
  };
}

export function normalizePropRules(input, startBalance = 0) {
  const source = input && typeof input === "object" ? input : {};
  const base = defaultPropRules(startBalance);
  return {
    enabled: Boolean(source.enabled),
    firm: String(source.firm || "").trim().slice(0, 40),
    presetId: String(source.presetId || base.presetId).slice(0, 40),
    presetAsOf: String(source.presetAsOf || "").slice(0, 10),
    profitTarget: Math.max(num(source.profitTarget), 0),
    drawdown: Math.max(num(source.drawdown), 0),
    mode: source.mode === "static" ? "static" : "trailing",
    basis: source.basis === "trade" ? "trade" : "eod",
    // Absent means "not answered yet", and the conservative answer to "does the
    // trail stop?" is yes — a capped trail draws a HIGHER floor than an
    // uncapped one only after the cap binds, and before that they are equal.
    trailStops: source.trailStops === undefined ? true : Boolean(source.trailStops),
    trailStopAt: source.trailStopAt === undefined ? num(startBalance) : num(source.trailStopAt),
    dailyLossLimit: Math.max(num(source.dailyLossLimit), 0),
    consistencyPct: Math.min(Math.max(num(source.consistencyPct), 0), 100),
    maxContracts: Math.max(Math.round(num(source.maxContracts)), 0),
    // A real clock time or nothing — "25:99" is not a flatten time and must
    // never be rendered as one.
    flattenBy: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(source.flattenBy || "")) ? String(source.flattenBy) : "",
    // Set the moment the trader saves the form having read the "check these
    // against your own account" line. Until then the tracker says so.
    confirmed: Boolean(source.confirmed)
  };
}

/* ── Tier presets ──────────────────────────────────────────────────────────
   READ ON 2026-08-05 from Topstep's help centre and reproduced here as FORM
   DEFAULTS ONLY. They are not asserted to be current, and the UI must say so
   wherever they are offered.

   Flags worth carrying into the UI copy:
   · The 25K is a limited "Labs" drop, and it is STATIC drawdown, not trailing.
     Applying trailing maths to it would be wrong by design.
   · Express Funded accounts start at a $0 balance; the tier name is buying
     power, not money, and the limit is a negative floor that locks at $0.
   · Every daily loss limit below is optional on some tiers and mandatory on
     others; that is a purchase-time choice the app cannot know. */
const COMBINE_TIERS = [
  {
    id: "ts-25k-static",
    label: "Topstep 25K Static (Labs): Combine",
    start: 25000,
    profitTarget: 2000,
    drawdown: 1000,
    mode: "static",
    dailyLossLimit: 500,
    maxContracts: 2,
    note: "Labs drop, limited run, STATIC drawdown. The floor never moves. Read 2026-08-05."
  },
  {
    id: "ts-50k",
    label: "Topstep 50K: Combine",
    start: 50000,
    profitTarget: 3000,
    drawdown: 2000,
    mode: "trailing",
    dailyLossLimit: 1000,
    maxContracts: 5,
    note: "Trails the end-of-day closed balance and stops once it reaches $50,000. Read 2026-08-05."
  },
  {
    id: "ts-100k",
    label: "Topstep 100K: Combine",
    start: 100000,
    profitTarget: 6000,
    drawdown: 3000,
    mode: "trailing",
    dailyLossLimit: 2000,
    maxContracts: 10,
    note: "Trails the end-of-day closed balance and stops once it reaches $100,000. Read 2026-08-05."
  },
  {
    id: "ts-150k",
    label: "Topstep 150K: Combine",
    start: 150000,
    profitTarget: 9000,
    drawdown: 4500,
    mode: "trailing",
    dailyLossLimit: 3000,
    maxContracts: 15,
    note: "Trails the end-of-day closed balance and stops once it reaches $150,000. Read 2026-08-05."
  },
  {
    id: "ts-250k-freedom",
    label: "Topstep 250K Freedom (Labs): Combine",
    start: 250000,
    profitTarget: 15000,
    drawdown: 10000,
    mode: "trailing",
    dailyLossLimit: 5000,
    maxContracts: 25,
    note: "Labs drop, limited run, 90-day expiry. Read 2026-08-05."
  }
];

// Express Funded accounts run the SAME algorithm with a $0 start, so they are
// derived rather than retyped — the two tables can never drift apart.
const XFA_SIZES = new Set(["ts-50k", "ts-100k", "ts-150k"]);

export const PROP_PRESETS = [
  {
    id: "custom",
    label: "Custom: enter my own numbers",
    firm: "",
    note: "Nothing is prefilled. Type the limits from your own account statement.",
    account: null,
    rules: null
  },
  ...COMBINE_TIERS.map((tier) => ({
    id: tier.id,
    label: tier.label,
    firm: "Topstep",
    note: tier.note,
    account: { startingBalance: tier.start, type: "evaluation" },
    rules: {
      profitTarget: tier.profitTarget,
      drawdown: tier.drawdown,
      mode: tier.mode,
      basis: "eod",
      trailStops: tier.mode === "trailing",
      trailStopAt: tier.start,
      dailyLossLimit: tier.dailyLossLimit,
      consistencyPct: 50,
      maxContracts: tier.maxContracts,
      flattenBy: "15:10"
    }
  })),
  ...COMBINE_TIERS.filter((tier) => XFA_SIZES.has(tier.id)).map((tier) => ({
    id: `${tier.id}-xfa`,
    label: tier.label.replace("— Combine", "— Express Funded"),
    firm: "Topstep",
    note:
      "Express Funded balances start at $0. The tier name is buying power, not money. " +
      "The limit starts negative and stops moving at $0. Read 2026-08-05.",
    account: { startingBalance: 0, type: "funded" },
    rules: {
      profitTarget: 0,
      drawdown: tier.drawdown,
      mode: "trailing",
      basis: "eod",
      trailStops: true,
      trailStopAt: 0,
      dailyLossLimit: tier.dailyLossLimit,
      consistencyPct: 0,
      maxContracts: tier.maxContracts,
      flattenBy: "15:10"
    }
  }))
];

export function findPropPreset(id) {
  return PROP_PRESETS.find((preset) => preset.id === id) || null;
}

/* ── Turning a trade list into evaluation steps ────────────────────────────
   Day bucketing is by the DATE ON THE TRADE, full stop. Topstep's trading day
   runs 17:00 CT to 15:10 CT the next calendar day, so a 18:30 CT Tuesday fill
   is a Wednesday trade to them — this journal stores a plain calendar date and
   no timezone, so it cannot reproduce that boundary and does not pretend to.
   Callers must surface that limitation next to any per-day figure. */
export function propSteps(trades, basis = "eod") {
  const closed = (Array.isArray(trades) ? trades : [])
    .filter((trade) => trade && trade.status !== "open" && trade.date)
    .map((trade) => ({
      date: String(trade.date),
      order: String(trade.closedAt || trade.createdAt || ""),
      pnl: num(trade.netPnl)
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order));

  if (basis === "trade") {
    return closed.map((step) => ({ date: step.date, pnl: step.pnl }));
  }

  const byDate = new Map();
  for (const step of closed) {
    byDate.set(step.date, (byDate.get(step.date) || 0) + step.pnl);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, pnl]) => ({ date, pnl }));
}

/* ── The evaluator ─────────────────────────────────────────────────────────
   Two mechanisms that must never be conflated:

     TRAILING  happens at session close, off the CLOSED balance, and only ever
               moves the floor UP.
     BREACH    is checked against equity at every moment the account is live,
               including unrealised P&L.

   This app only records closed trades, so the equity it can see is the closed
   balance after each step. A real breach can therefore happen where this
   evaluator sees none — an open position that traded through the floor and
   came back leaves no trace in a closed-trade journal. `visibleOnly: true` is
   returned so the UI is forced to say that out loud rather than implying the
   account is safe. */
export function evaluateProp(options = {}) {
  const {
    rules: rawRules = {},
    startBalance = 0,
    steps = [],
    todayKey = "",
    personalDailyLimit = 0
  } = options;

  const rules = normalizePropRules(rawRules, startBalance);
  const start = num(startBalance);
  const drawdown = rules.drawdown;
  const trailing = rules.mode === "trailing";
  const cap = rules.trailStops ? rules.trailStopAt : Number.POSITIVE_INFINITY;

  // null means "the trader has not entered a max loss limit", which is a very
  // different thing from "the limit is zero". Nothing downstream may draw a
  // floor line from a limit that was never given.
  const mllFor = (peak) => {
    if (!(drawdown > 0)) {
      return null;
    }
    return trailing ? Math.min(peak - drawdown, cap) : start - drawdown;
  };

  let balance = start;
  let peak = start;
  let mll = mllFor(peak);
  let breachedOn = "";
  let breachBalance = 0;
  const mllMoves = [];
  const dayPnl = new Map();

  for (const step of steps) {
    const pnl = num(step.pnl);
    balance += pnl;
    dayPnl.set(String(step.date), (dayPnl.get(String(step.date)) || 0) + pnl);

    // "Hit or go below" — the comparison is <=, not <, because touching the
    // limit is the breach.
    if (mll !== null && !breachedOn && balance <= mll) {
      breachedOn = String(step.date);
      breachBalance = balance;
    }

    // Session close: the floor trails, and only upward.
    if (balance > peak) {
      peak = balance;
      const next = mllFor(peak);
      if (mll !== null && next !== null && next > mll) {
        mllMoves.push({ date: String(step.date), from: mll, to: next });
      }
      mll = next;
    }
  }

  const netProfit = balance - start;
  const dayValues = [...dayPnl.values()];
  const bestDay = dayValues.reduce((best, value) => (value > best ? value : best), 0);

  // Consistency: a best day worth more than `consistencyPct` of total profit
  // does not fail the account, it RAISES the target. 0 turns the rule off,
  // which is the default — the app must not assert a rule nobody entered.
  const baseTarget = rules.profitTarget;
  const consistencyRatio = rules.consistencyPct > 0 && netProfit > 0 ? bestDay / netProfit : null;
  const effectiveTarget =
    rules.consistencyPct > 0 && bestDay > 0
      ? Math.max(baseTarget, bestDay / (rules.consistencyPct / 100))
      : baseTarget;

  const firmDaily = rules.dailyLossLimit;
  const personalDaily = Math.max(num(personalDailyLimit), 0);
  const candidates = [firmDaily, personalDaily].filter((value) => value > 0);
  // The tighter budget is the one that stops the desk, so it is the one shown.
  const dailyLimit = candidates.length ? Math.min(...candidates) : 0;
  const dailyBinding = !dailyLimit ? "" : firmDaily > 0 && firmDaily <= (personalDaily || Infinity) ? "firm" : "personal";

  const todayPnl = todayKey ? dayPnl.get(String(todayKey)) || 0 : 0;
  const dailyUsed = Math.max(-todayPnl, 0);

  const targetMet = baseTarget > 0 && effectiveTarget > 0 && netProfit >= effectiveTarget;
  const status = breachedOn
    ? "breached"
    : !steps.length
      ? "idle"
      : targetMet
        ? "target-met"
        : "in-progress";

  return {
    rules,
    startBalance: start,
    balance,
    netProfit,
    peak,
    mll,
    // Distance from the money to the floor. null when no limit was entered.
    room: mll === null ? null : balance - mll,
    mllMoves,
    // The floor has stopped moving for good: it is sitting on its cap.
    mllLocked: mll !== null && trailing && rules.trailStops && mll >= cap,
    baseTarget,
    effectiveTarget,
    targetProgress: effectiveTarget > 0 ? clamp01(netProfit / effectiveTarget) : null,
    bestDay,
    consistencyRatio,
    consistencyBreached: consistencyRatio !== null && consistencyRatio > rules.consistencyPct / 100,
    dailyLimit,
    dailyBinding,
    dailyUsed,
    dailyLeft: dailyLimit > 0 ? Math.max(dailyLimit - dailyUsed, 0) : null,
    dailyBreached: dailyLimit > 0 && dailyUsed >= dailyLimit,
    todayPnl,
    daysTraded: dayPnl.size,
    stepCount: steps.length,
    breachedOn,
    breachBalance,
    status,
    // Always true here, and deliberately so: this evaluator only ever sees
    // closed trades. Callers must not present its verdict as the firm's.
    visibleOnly: true
  };
}

/* How close the next ordinary loss puts the account to the floor. `typicalLoss`
   is a POSITIVE dollar figure the caller derives from real closed losses; pass
   0 when there are none and the answer is honestly "not enough data". */
export function mllPressure(evaluation, typicalLoss = 0) {
  const room = evaluation && Number.isFinite(evaluation.room) ? evaluation.room : null;
  if (room === null) {
    return { level: "unknown", lossesLeft: null, room: null };
  }
  if (room <= 0 || evaluation.status === "breached") {
    return { level: "breach", lossesLeft: 0, room };
  }
  const loss = Math.max(num(typicalLoss), 0);
  if (!(loss > 0)) {
    return { level: "unknown", lossesLeft: null, room };
  }
  const lossesLeft = Math.floor(room / loss);
  return { level: lossesLeft <= 1 ? "warn" : "safe", lossesLeft, room };
}
