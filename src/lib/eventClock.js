// Terminal Pro — the clock. Pure: no DOM, no fetch, no storage, no ambient
// `new Date()`. Every function takes `now` so the tests can freeze time.
//
// Feed times are UTC. Proven against five zones in one real file (see
// tests/calendarParse.check.mjs): USD CPI 12:30pm = 08:30 EDT, AUD Cash Rate
// 4:30am = 14:30 AEST, GBP GDP 6:00am = 07:00 BST, JPY Bank Lending 11:50pm =
// 08:50 JST next day, NZD Inflation Expectations 3:00am = 15:00 NZST. Offsets
// -4/+10/+1/+9/+12 resolve only under UTC, which also rules out the two
// plausible fixed zones (America/New_York would print CPI at 8:30am,
// Europe/London at 1:30pm). So there is deliberately NO Intl call, NO DST
// correction and NO zone constant in this file. Intl belongs in the renderer,
// where the trader's own wall-clock is what matters.

import { normalizeMarketSymbol } from "../modules/livePrices.js";

// Holiday ranks 0: excluded from ranking and from arming, but still displayed.
// A JPY bank holiday is WHY the tape is dead, and that is worth knowing.
export const IMPACT_RANK = { Holiday: 0, Low: 1, Medium: 2, High: 3 };

const MINUTE_MS = 60 * 1000;

/** "EURUSD" -> ["EUR","USD"] · "XAUUSD" -> ["USD"] · "BTCUSDT" -> ["USD"] */
export function currenciesForSymbol(symbol) {
  const normalized = normalizeMarketSymbol(symbol);
  if (normalized === "") return [];

  // Metals and crypto quote in dollars: the trader of gold cares about USD
  // releases, not about a "XAU" central bank that does not exist.
  if (/^(XAU|XAG)/.test(normalized)) return ["USD"];
  if (/(USDT|USDC)$/.test(normalized)) return ["USD"];

  if (/^[A-Z]{6}$/.test(normalized)) {
    const base = normalized.slice(0, 3);
    const quote = normalized.slice(3);
    return base === quote ? [base] : [base, quote];
  }
  if (/USD$/.test(normalized)) return ["USD"];
  return [];
}

/** Union of the currencies behind every distinct asset the trader has touched. */
export function tradedCurrencies(trades) {
  const seen = new Set();
  (Array.isArray(trades) ? trades : []).forEach((trade) => {
    currenciesForSymbol(trade?.asset).forEach((code) => seen.add(code));
  });
  return [...seen];
}

export function isRelevant(event, currencies) {
  if (!Array.isArray(currencies) || currencies.length === 0) return true;
  return currencies.includes(String(event?.currency ?? "").toUpperCase());
}

/**
 * Upcoming, relevant, impactful, soonest first. All-day rows are excluded:
 * they have no instant, so they cannot carry a countdown.
 */
export function rankEvents(events, { now, currencies = [], minImpact = "Medium" } = {}) {
  const floor = IMPACT_RANK[minImpact] ?? 2;
  const at = now instanceof Date ? now.getTime() : Number(now);

  return (Array.isArray(events) ? events : [])
    .filter((event) => {
      if (event?.allDay) return false;
      const startsAt = Date.parse(event?.startsAt ?? "");
      if (Number.isNaN(startsAt) || startsAt < at) return false;
      if ((IMPACT_RANK[event.impact] ?? 1) < floor) return false;
      return isRelevant(event, currencies);
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function nextEvent(events, opts) {
  return rankEvents(events, opts)[0] ?? null;
}

/**
 * -> { ms, text, phase }. Phases: far >60m · near 5-60m · imminent 0-5m ·
 * live 0..+15m · past beyond. `text` is never negative — a countdown that
 * prints "-3m" reads as a bug on a screen people trade from.
 */
export function countdown(event, now) {
  const at = now instanceof Date ? now.getTime() : Number(now);
  const startsAt = Date.parse(event?.startsAt ?? "");
  if (Number.isNaN(startsAt)) return { ms: 0, text: "", phase: "past" };

  const ms = startsAt - at;
  if (ms > 60 * MINUTE_MS) return { ms, text: formatSpan(ms), phase: "far" };
  if (ms > 5 * MINUTE_MS) return { ms, text: formatSpan(ms), phase: "near" };
  if (ms >= 0) return { ms, text: formatSpan(ms), phase: "imminent" };
  if (ms >= -15 * MINUTE_MS) return { ms, text: "live", phase: "live" };
  return { ms, text: "", phase: "past" };
}

function formatSpan(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Events whose start lies within [at - windowMin, at + windowMin]. */
export function eventsActiveAt(events, at, windowMin) {
  const when = at instanceof Date ? at.getTime() : Number(at);
  const span = Math.abs(Number(windowMin)) * MINUTE_MS;

  return (Array.isArray(events) ? events : []).filter((event) => {
    if (event?.allDay) return false;
    const startsAt = Date.parse(event?.startsAt ?? "");
    if (Number.isNaN(startsAt)) return false;
    return Math.abs(startsAt - when) <= span;
  });
}

/**
 * The one input to the discipline-arming branch.
 * A stale feed returns null ALWAYS: a desk lock fired by a phantom event is
 * worse than no lock, because it destroys trust in every future one.
 */
export function armingWindow(
  events,
  now,
  { minImpact = "High", armMin = 30, liveMin = 15, stale = false } = {}
) {
  if (stale) return null;

  const at = now instanceof Date ? now.getTime() : Number(now);
  const floor = IMPACT_RANK[minImpact] ?? 3;

  const candidates = (Array.isArray(events) ? events : [])
    .filter((event) => {
      if (event?.allDay) return false;
      if ((IMPACT_RANK[event.impact] ?? 1) < floor) return false;
      const startsAt = Date.parse(event?.startsAt ?? "");
      if (Number.isNaN(startsAt)) return false;
      const deltaMin = (startsAt - at) / MINUTE_MS;
      return deltaMin <= armMin && deltaMin >= -liveMin;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const event = candidates[0];
  if (event === undefined) return null;

  const startsAt = Date.parse(event.startsAt);
  const secondsUntil = Math.round((startsAt - at) / 1000);
  return {
    key: event.key,
    title: event.title,
    currency: event.currency,
    impact: event.impact,
    startsAt: event.startsAt,
    secondsUntil,
    phase: secondsUntil >= 0 ? "arming" : "live",
  };
}
