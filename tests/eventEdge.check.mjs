// The fusion statistics decide what the terminal is ALLOWED to claim about a
// trader's record. The failure mode is not a crash — it is a confident
// percentage computed from four trades. These assertions are the guardrail.
//
// Run: node tests/eventEdge.check.mjs
import assert from "node:assert/strict";
import {
  EDGE_MIN_LOG,
  EDGE_MIN_VERDICT,
  stampFromEvents,
  wilson,
  buildBaseline,
  edgeConfidence,
  eventFile,
  windowBuckets,
  releaseClockEdge,
  tiltByEventType,
} from "../src/lib/eventEdge.js";

const CPI = "78-us-cpi-mm";
const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.UTC(2026, 7, 12, 12, 30); // a CPI print

const trade = (over = {}) => ({
  status: "closed",
  netPnl: 0,
  rMultiple: 0,
  createdAt: iso(T0),
  ...over,
});
const stamped = (m, over = {}) =>
  trade({ eventContext: [{ k: CPI, t: "CPI m/m", c: "USD", i: "High", m }], ...over });

// --- 1. Stamp sign convention — asserted FIRST -----------------------------
// Getting this backwards silently inverts every window verdict in the product.
{
  const events = [
    { key: CPI, title: "CPI m/m", currency: "USD", impact: "High", startsAt: iso(T0) },
    { key: "low-1", title: "Loan Officer Survey", currency: "USD", impact: "Low", startsAt: iso(T0) },
  ];
  const before = stampFromEvents(events, new Date(T0 - 8 * 60000));
  assert.equal(before[0].m, -8, "a trade opened BEFORE the print must stamp negative");
  const after = stampFromEvents(events, new Date(T0 + 8 * 60000));
  assert.equal(after[0].m, 8, "a trade opened AFTER the print must stamp positive");

  // Low impact is 53 of 73 events in a real week: stamping it is bloat.
  assert.equal(before.length, 1, "Low-impact events must not be stamped");
  // Out of window -> nothing.
  assert.deepEqual(stampFromEvents(events, new Date(T0 + 200 * 60000)), []);
  // Cap of 3, highest impact first.
  const many = Array.from({ length: 6 }, (_, i) => ({
    key: `k${i}`, title: `E${i}`, currency: "USD",
    impact: i === 5 ? "High" : "Medium", startsAt: iso(T0),
  }));
  const capped = stampFromEvents(many, new Date(T0));
  assert.equal(capped.length, 3);
  assert.equal(capped[0].i, "High", "highest impact must survive the cap");
}

// --- 2. Wilson never claims certainty --------------------------------------
assert.ok(wilson(3, 3).lo < 1, "3/3 must not read as a guaranteed 100%");
assert.ok(wilson(3, 3).hi <= 1);
assert.ok(Math.abs(wilson(0, 5).hi - 0.434) < 0.02, `wilson(0,5).hi ≈ 0.434, got ${wilson(0, 5).hi}`);
assert.deepEqual(wilson(0, 0), { lo: 0, hi: 1 }, "an empty sample admits everything");

// --- 3. Confidence ladder ---------------------------------------------------
assert.equal(edgeConfidence(0), "none");
assert.equal(edgeConfidence(EDGE_MIN_LOG - 1), "anecdote");
assert.equal(edgeConfidence(EDGE_MIN_LOG), "thin");
assert.equal(edgeConfidence(EDGE_MIN_VERDICT), "usable");

// --- 4. n = 0: no NaN may ever reach a template ----------------------------
{
  const file = eventFile([], CPI, { winRate: 0.5 });
  assert.equal(file.samples, 0);
  assert.equal(file.avgPnl, 0, "no division by zero");
  assert.equal(file.winRate, null, "an empty file has no rate, not a zero");
  assert.equal(file.confidence, "none");
  assert.equal(file.verdict, "");
  assert.ok(!file.sentence.includes("%"));
}

// --- 5. THE LOAD-BEARING HONESTY ASSERTION ---------------------------------
// Four losing trades must not become a percentage anywhere — not in the data,
// not in the sentence.
{
  const four = [stamped(5, { netPnl: -50 }), stamped(6, { netPnl: -20 }), stamped(7, { netPnl: -30 }), stamped(8, { netPnl: -10 })];
  const file = eventFile(four, CPI, { winRate: 0.55 });
  assert.equal(file.samples, 4);
  assert.equal(file.confidence, "anecdote");
  assert.equal(file.winRate, null, "n<5 must yield null, never 0.00");
  assert.equal(file.verdict, "", "n<10 must never yield a verdict");
  assert.ok(!file.sentence.includes("%"), `a 4-trade sentence must not contain a percentage: "${file.sentence}"`);
}

// --- 6. n = 12, clearly worse than the trader's own baseline ---------------
{
  const rows = [
    ...Array.from({ length: 3 }, () => stamped(5, { netPnl: 40 })),
    ...Array.from({ length: 9 }, () => stamped(5, { netPnl: -60 })),
  ];
  const file = eventFile(rows, CPI, { winRate: 0.55 });
  assert.equal(file.samples, 12);
  assert.equal(file.confidence, "usable");
  assert.equal(file.verdict, "worse");
  assert.ok(file.winRateCI.hi < 0.55, "the whole interval must sit below the baseline to call it worse");
  assert.ok(file.sentence.includes("worse"));
}

// --- 7. Matching the baseline is a REAL answer, not silence ----------------
{
  const rows = [
    ...Array.from({ length: 6 }, () => stamped(5, { netPnl: 40 })),
    ...Array.from({ length: 6 }, () => stamped(5, { netPnl: -40 })),
  ];
  const file = eventFile(rows, CPI, { winRate: 0.5 });
  assert.equal(file.verdict, "no-difference", "most event files will honestly return this forever");
}

// --- 8. The comparison is against the trader, not against 50% --------------
// 60% on CPI looks good against a coin and BAD against a 75% trader.
{
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => stamped(5, { netPnl: i < 7 ? 30 : -30 })),
  ];
  const vsCoin = eventFile(rows, CPI, { winRate: 0.5 });
  const vsSelf = eventFile(rows, CPI, { winRate: 0.95 });
  assert.notEqual(vsCoin.verdict, "worse", "58% is not worse than a coin");
  assert.equal(vsSelf.verdict, "worse", "58% IS worse for a 95% trader — the baseline must matter");
}

// --- 9. Unstamped and foreign-key trades are skipped, never counted -------
{
  const rows = [
    stamped(5, { netPnl: 100 }),
    trade({ netPnl: -999 }),                                   // no stamp at all
    trade({ netPnl: -999, eventContext: [{ k: "other", m: 1 }] }), // different event
    trade({ status: "open", netPnl: 0, eventContext: [{ k: CPI, m: 1 }] }), // still open
  ];
  const file = eventFile(rows, CPI, { winRate: 0.5 });
  assert.equal(file.samples, 1, "only closed trades stamped with THIS key may count");
  assert.equal(file.netPnl, 100, "an unstamped loss must not be attributed to the event");
}

// --- 10. Window buckets, both sides of the print --------------------------
{
  const rows = [stamped(-30, { netPnl: 10 }), stamped(5, { netPnl: -20 }), stamped(30, { netPnl: 5 }), stamped(90, { netPnl: 1 })];
  const buckets = windowBuckets(rows, CPI);
  assert.deepEqual(buckets.map((b) => b.n), [1, 1, 1, 1], "one trade per bucket");
  assert.deepEqual(buckets.map((b) => b.label), ["before", "0-15m", "15-60m", "60m+"]);
  assert.equal(buckets[0].netPnl, 10);
  assert.equal(buckets[1].netPnl, -20);
}

// --- 11. Day-one edge works with ZERO stamps ------------------------------
// This is what a brand-new user sees, so it must be real on visit one.
{
  const rows = [
    trade({ netPnl: -80, createdAt: iso(Date.UTC(2026, 7, 12, 12, 45)) }), // US data window
    trade({ netPnl: -40, createdAt: iso(Date.UTC(2026, 7, 13, 13, 10)) }), // US data window
    trade({ netPnl: 60, createdAt: iso(Date.UTC(2026, 7, 13, 8, 10)) }),   // London morning
    trade({ netPnl: 999, createdAt: iso(Date.UTC(2026, 7, 13, 12, 5)), importBatchId: "b1" }),
  ];
  const clock = releaseClockEdge(rows);
  const usWindow = clock.find((s) => s.slot === "12:00-14:00");
  assert.equal(usWindow.n, 2, "imported rows must be excluded — their timestamps are the paste time");
  assert.equal(usWindow.netPnl, -120);
  assert.equal(clock.find((s) => s.slot === "07:00-12:00").n, 1);
}

// --- 12. Tilt ratio refuses to speak on thin data ------------------------
{
  const thin = [stamped(5, { psychology: "Revenge Trade" }), trade({ netPnl: 1 })];
  assert.equal(tiltByEventType(thin).ratio, null, "a 1-vs-1 comparison is not a multiple");

  const rows = [
    ...Array.from({ length: 10 }, (_, i) => stamped(5, { netPnl: -10, psychology: i < 6 ? "Revenge Trade" : "Focused" })),
    ...Array.from({ length: 10 }, (_, i) => trade({ netPnl: 5, psychology: i < 2 ? "Emotional" : "Focused" })),
  ];
  const tilt = tiltByEventType(rows, { winRate: 0.5 });
  assert.equal(tilt.onEventN, 10);
  assert.equal(tilt.offEventN, 10);
  assert.ok(Math.abs(tilt.onEventTiltRate - 0.6) < 1e-9);
  assert.ok(Math.abs(tilt.ratio - 3) < 1e-9, "0.6 / 0.2 = 3x — the honest multiple");
}

// --- 13. Baseline uses the trader's whole closed record ------------------
{
  const base = buildBaseline([trade({ netPnl: 10, rMultiple: 1 }), trade({ netPnl: -5, rMultiple: -1 }), { status: "open", netPnl: 0 }]);
  assert.equal(base.n, 2, "open trades are not part of a settled baseline");
  assert.equal(base.winRate, 0.5);
  assert.equal(base.meanR, 0);
  assert.deepEqual(buildBaseline([]), { n: 0, winRate: null, meanR: 0 });
}

console.log("eventEdge.check.mjs — honesty rails pinned: no rate under 5, no verdict under 10, baseline-relative");
