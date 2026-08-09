// Terminal Pro — the fusion statistics. Pure.
//
// This file exists to stop the feature telling the single most tempting lie in
// trading software: turning four trades into a percentage. Three rules are
// enforced HERE, in the library, so a renderer physically cannot break them:
//
//   1. n < EDGE_MIN_LOG     -> winRate is null, not 0.33.
//   2. n < EDGE_MIN_VERDICT -> verdict is "". The UI cannot print a verdict it
//                              was never given.
//   3. The comparison is against the trader's OWN baseline, never 50%. A 65%
//      trader who is 60% on CPI is WORSE on CPI; against 50% that reads as a win.
//
// The `sentence` is built here for the same reason: if the copy lived in the
// renderer, someone would eventually write "your edge" over a 4-trade sample.

// 5 is not a new number — it is RULE_COST_MIN_SIDE (app.js:839), the threshold
// renderRuleCost already holds itself to. Matching it is deliberate.
export const EDGE_MIN_LOG = 5;
export const EDGE_MIN_VERDICT = 10;
export const WINDOW_MIN = 3;

const MINUTE_MS = 60 * 1000;
const IMPACT_ORDER = { High: 3, Medium: 2, Low: 1, Holiday: 0 };

/**
 * The auto-stamp payload. Medium+ only: 53 of 73 events in a real week are
 * Low, and stamping those is payload bloat with no signal.
 * `m` is minutes from event start to trade open — NEGATIVE means the trade was
 * opened BEFORE the print.
 */
export function stampFromEvents(events, at, windowMin = 120) {
  const when = at instanceof Date ? at.getTime() : Number(at);
  if (!Number.isFinite(when)) return [];
  const span = Math.abs(Number(windowMin)) * MINUTE_MS;

  return (Array.isArray(events) ? events : [])
    .filter((event) => {
      if (event?.allDay) return false;
      if ((IMPACT_ORDER[event.impact] ?? 1) < 2) return false;
      const startsAt = Date.parse(event?.startsAt ?? "");
      return !Number.isNaN(startsAt) && Math.abs(startsAt - when) <= span;
    })
    .sort((a, b) => (IMPACT_ORDER[b.impact] ?? 1) - (IMPACT_ORDER[a.impact] ?? 1))
    .slice(0, 3)
    .map((event) => ({
      k: event.key,
      t: event.title,
      c: event.currency,
      i: event.impact,
      m: Math.round((when - Date.parse(event.startsAt)) / MINUTE_MS),
    }));
}

/**
 * Wilson score interval — five lines that kill "2W-5L means you win 28%".
 * At n=3 wins=3 the upper bound is still < 1: the maths refuses to claim
 * certainty the sample cannot support.
 */
export function wilson(wins, n, z = 1.96) {
  if (!(n > 0)) return { lo: 0, hi: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return {
    lo: Math.max(0, (centre - margin) / denom),
    hi: Math.min(1, (centre + margin) / denom),
  };
}

const isClosed = (trade) => trade && trade.status !== "open";
const isWin = (trade) => Number(trade?.netPnl) > 0;

/** The trader's own baseline across every closed trade. */
export function buildBaseline(trades) {
  const closed = (Array.isArray(trades) ? trades : []).filter(isClosed);
  const n = closed.length;
  if (n === 0) return { n: 0, winRate: null, meanR: 0 };

  const wins = closed.filter(isWin).length;
  const rSum = closed.reduce((sum, trade) => sum + (Number(trade.rMultiple) || 0), 0);
  return { n, winRate: wins / n, meanR: rSum / n };
}

export function edgeConfidence(n) {
  if (!(n > 0)) return "none";
  if (n < EDGE_MIN_LOG) return "anecdote";
  if (n < EDGE_MIN_VERDICT) return "thin";
  return "usable";
}

// Trades carrying a stamp for this event family. A trade with NO eventContext
// is skipped entirely rather than counted as a zero — that is what stops 400
// pre-stamp trades diluting every file into meaninglessness.
function tradesForEvent(trades, eventKey) {
  const key = String(eventKey ?? "");
  return (Array.isArray(trades) ? trades : []).filter((trade) => {
    if (!isClosed(trade) || !Array.isArray(trade.eventContext)) return false;
    return trade.eventContext.some((stamp) => stamp?.k === key);
  });
}

/** The F2 pane: the trader's own record against one event family. */
export function eventFile(trades, eventKey, baseline = { winRate: null }) {
  const sample = tradesForEvent(trades, eventKey);
  const samples = sample.length;
  const title = sample[0]?.eventContext?.find((s) => s.k === eventKey)?.t ?? "";

  const wins = sample.filter(isWin).length;
  const losses = sample.filter((t) => Number(t.netPnl) < 0).length;
  const flat = samples - wins - losses;
  const netPnl = sample.reduce((sum, t) => sum + (Number(t.netPnl) || 0), 0);
  const rSum = sample.reduce((sum, t) => sum + (Number(t.rMultiple) || 0), 0);

  const confidence = edgeConfidence(samples);
  const winRate = samples >= EDGE_MIN_LOG ? wins / samples : null;
  const winRateCI = samples > 0 ? wilson(wins, samples) : { lo: 0, hi: 1 };
  const baselineWinRate = baseline?.winRate ?? null;

  let verdict = "";
  if (samples >= EDGE_MIN_VERDICT && baselineWinRate !== null) {
    if (winRateCI.hi < baselineWinRate) verdict = "worse";
    else if (winRateCI.lo > baselineWinRate) verdict = "better";
    else verdict = "no-difference";
  }

  return {
    key: eventKey,
    title,
    samples,
    wins,
    losses,
    flat,
    netPnl,
    avgPnl: samples > 0 ? netPnl / samples : 0,
    avgR: samples > 0 ? rSum / samples : 0,
    winRate,
    winRateCI,
    baselineWinRate,
    confidence,
    verdict,
    sentence: edgeSentence({ title, samples, wins, losses, netPnl, confidence, verdict }),
  };
}

// The honest sentence. Below EDGE_MIN_LOG it must not contain a "%" — asserted
// in the tests, because that is the exact shape the lie would take.
function edgeSentence({ title, samples, wins, losses, netPnl, confidence, verdict }) {
  const name = title || "this release";
  if (confidence === "none") {
    return `${name} — no prints on record yet. Your file starts with the next one.`;
  }
  const money = `${netPnl >= 0 ? "+" : "−"}$${Math.abs(netPnl).toFixed(2)}`;
  if (confidence === "anecdote") {
    return `${name} — ${samples} print${samples === 1 ? "" : "s"} on record (${wins}W–${losses}L, ${money}). Too few to call a rate.`;
  }
  if (confidence === "thin") {
    return `${name} — ${wins}W–${losses}L, ${money} across ${samples} prints. Not enough to call it an edge yet.`;
  }
  if (verdict === "worse") {
    return `${name} — ${wins}W–${losses}L, ${money}. You do measurably worse here than you do everywhere else.`;
  }
  if (verdict === "better") {
    return `${name} — ${wins}W–${losses}L, ${money}. You do measurably better here than your own average.`;
  }
  return `${name} — ${wins}W–${losses}L, ${money}. No measurable difference from your own average.`;
}

/** Fixed buckets by when the trade was opened relative to the print. */
export function windowBuckets(trades, eventKey) {
  const sample = tradesForEvent(trades, eventKey);
  const buckets = [
    { label: "before", test: (m) => m < 0 },
    { label: "0-15m", test: (m) => m >= 0 && m < 15 },
    { label: "15-60m", test: (m) => m >= 15 && m < 60 },
    { label: "60m+", test: (m) => m >= 60 },
  ];

  return buckets.map(({ label, test }) => {
    const rows = sample.filter((trade) => {
      const stamp = trade.eventContext.find((s) => s?.k === eventKey);
      return stamp !== undefined && test(Number(stamp.m) || 0);
    });
    const netPnl = rows.reduce((sum, t) => sum + (Number(t.netPnl) || 0), 0);
    return {
      label,
      n: rows.length,
      netPnl,
      avgPnl: rows.length > 0 ? netPnl / rows.length : 0,
    };
  });
}

/**
 * DAY-ONE EDGE: needs no stamps and no archive at all — it reads the trades the
 * user already has. Buckets live-logged trades by UTC hour, so a trader sees
 * something true about themselves on the very first visit, before a single
 * event has been stamped.
 */
export function releaseClockEdge(trades) {
  const slots = [
    { slot: "00:00-07:00", label: "Asia session", from: 0, to: 7 },
    { slot: "07:00-12:00", label: "London morning", from: 7, to: 12 },
    { slot: "12:00-14:00", label: "US data window", from: 12, to: 14 },
    { slot: "14:00-21:00", label: "US session", from: 14, to: 21 },
    { slot: "21:00-24:00", label: "Late / rollover", from: 21, to: 24 },
  ];

  // Imported rows carry the import time, not the entry time — bucketing them
  // by hour would invent a pattern out of when the user happened to paste.
  const live = (Array.isArray(trades) ? trades : []).filter(
    (trade) => isClosed(trade) && !trade.importBatchId && trade.createdAt
  );

  return slots.map(({ slot, label, from, to }) => {
    const rows = live.filter((trade) => {
      const hour = new Date(trade.createdAt).getUTCHours();
      return !Number.isNaN(hour) && hour >= from && hour < to;
    });
    const netPnl = rows.reduce((sum, t) => sum + (Number(t.netPnl) || 0), 0);
    return {
      slot,
      label,
      n: rows.length,
      netPnl,
      avgPnl: rows.length > 0 ? netPnl / rows.length : 0,
      confidence: edgeConfidence(rows.length),
    };
  });
}

/**
 * The F9 pane. Reuses the SHIPPED psychology vocabulary verbatim — the exact
 * predicate app.js already uses at 7225 — rather than inventing a taxonomy the
 * rest of the app does not know about.
 */
export function tiltByEventType(trades, baseline = { winRate: null }) {
  const tilted = (trade) =>
    trade?.psychology === "Emotional" ||
    trade?.psychology === "Revenge Trade" ||
    trade?.cooldownOverride === true;

  const closed = (Array.isArray(trades) ? trades : []).filter(isClosed);
  const stamped = closed.filter((t) => Array.isArray(t.eventContext) && t.eventContext.length > 0);
  const unstamped = closed.filter((t) => !Array.isArray(t.eventContext) || t.eventContext.length === 0);

  const rate = (rows) => (rows.length > 0 ? rows.filter(tilted).length / rows.length : 0);
  const onEvent = rate(stamped);
  const offEvent = rate(unstamped);

  // A ratio needs both sides to clear the log threshold, or it is noise
  // dressed as a multiple.
  const ratio =
    stamped.length >= EDGE_MIN_LOG && unstamped.length >= EDGE_MIN_LOG && offEvent > 0
      ? onEvent / offEvent
      : null;

  return {
    onEventN: stamped.length,
    offEventN: unstamped.length,
    onEventTiltRate: stamped.length >= EDGE_MIN_LOG ? onEvent : null,
    offEventTiltRate: unstamped.length >= EDGE_MIN_LOG ? offEvent : null,
    ratio,
    confidence: edgeConfidence(Math.min(stamped.length, unstamped.length)),
    baselineWinRate: baseline?.winRate ?? null,
  };
}
