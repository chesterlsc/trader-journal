// Session Intelligence data-contract checks.
// Run: node tests/sessionReport.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONFIDENCE_THRESHOLDS,
  DEFAULT_REPORT_TIME_ZONE,
  MIN_RELIABLE_HOUR_SAMPLES,
  buildSessionTimingReport,
  detectNormalizedTradeSource,
  detectPrimarySession,
  getConfidenceState,
  parseDurationMs,
  parseExecutionTimestamp,
  resolveTradePnl,
  resolveTradeTiming,
  summarizeDurations
} from "../src/lib/sessionReport.js";
import { parseTopstepCsv } from "../src/lib/topstepImport.js";
import { parseTopstepOrdersCsv } from "../src/lib/topstepOrdersImport.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

let nextId = 1;
const closed = (overrides = {}) => ({
  id: `trade-${nextId++}`,
  status: "closed",
  netPnl: 25,
  notes: "",
  ...overrides
});

const topstepTrade = (overrides = {}) => closed({
  importSource: "topstepx",
  externalSource: "topstepx",
  externalTradeId: `TS-${nextId}`,
  brokerPnl: 25,
  netPnl: 25,
  sourceFees: 0,
  sourceCommissions: 0,
  enteredAt: "2026-08-12T13:30:00Z",
  exitedAt: "2026-08-12T13:35:00Z",
  tradeDuration: "00:05:00",
  session: "Not recorded",
  ...overrides
});

const topstepOrders = (overrides = {}) => closed({
  importSource: "topstepx-orders",
  externalSource: "topstepx-orders",
  externalFingerprint: `TSO-${nextId}`,
  estimatedNetPnl: 25,
  pnlIsEstimated: true,
  pnlProvenance: "calculated-from-filled-orders",
  enteredAt: "2026-08-12T13:30:00Z",
  exitedAt: "2026-08-12T13:35:00Z",
  reconstructedDuration: "00:05:00",
  session: "Not recorded",
  ...overrides
});

// --- 1. One centralized confidence contract ------------------------------
{
  assert.deepEqual(CONFIDENCE_THRESHOLDS, {
    early: { min: 1, label: "Early signal" },
    developing: { min: 3, label: "Developing" },
    reliable: { min: 5, label: "Reliable" }
  });
  assert.equal(MIN_RELIABLE_HOUR_SAMPLES, 5);
  assert.equal(getConfidenceState(0).key, "none");
  assert.equal(getConfidenceState(1).key, "early");
  assert.equal(getConfidenceState(2).key, "early");
  assert.equal(getConfidenceState(3).key, "developing");
  assert.equal(getConfidenceState(4).key, "developing");
  assert.equal(getConfidenceState(5).key, "reliable");
  assert.deepEqual(getConfidenceState(5, { minimumReliableSamples: 7 }), {
    key: "developing",
    label: "Developing",
    count: 5,
    minimumReliableSamples: 7,
    neededForReliable: 2
  });
}

// --- 2. Exact offsets, zone-less provenance and DST gaps -----------------
{
  const utc = parseExecutionTimestamp("2026-08-12T13:30:00Z");
  const eastern = parseExecutionTimestamp("2026-08-12T09:30:00-04:00");
  const manila = parseExecutionTimestamp("08/12/2026 09:30:00 PM +08:00");
  assert.equal(utc.quality, "exact");
  assert.equal(utc.instantMs, eastern.instantMs);
  assert.equal(utc.instantMs, manila.instantMs);

  assert.deepEqual(parseExecutionTimestamp("2026-08-12T09:30:00"), {
    instantMs: null,
    quality: "unresolved",
    reason: "missing-source-time-zone"
  });
  const assumed = parseExecutionTimestamp("2026-08-12T09:30:00", { sourceTimeZone: "America/New_York" });
  assert.equal(assumed.quality, "assumed");
  assert.equal(assumed.instantMs, Date.parse("2026-08-12T13:30:00Z"));
  assert.equal(
    parseExecutionTimestamp("2026-03-08T02:30:00", { sourceTimeZone: "America/New_York" }).instantMs,
    null,
    "nonexistent spring-forward wall clocks are never invented"
  );

  const metadataWins = resolveTradeTiming(topstepTrade({
    enteredAt: "2026-08-12T09:30:00",
    exitedAt: "2026-08-12T09:35:00",
    sourceTimezone: "America/Chicago"
  }), { sourceTimeZone: "America/New_York" });
  assert.equal(metadataWins.entryMs, Date.parse("2026-08-12T14:30:00Z"));
  assert.equal(metadataWins.sourceTimeZone, "America/Chicago");
  assert.equal(metadataWins.sourceTimeZoneSource, "trade-metadata");

  const executionWins = resolveTradeTiming(topstepTrade({ session: "London" }));
  assert.equal(executionWins.session, "New York");
  assert.equal(executionWins.sessionSource, "detected-entry");
  const manualFallback = resolveTradeTiming(closed({ enteredAt: "", exitedAt: "", session: "London" }));
  assert.equal(manualFallback.session, "London");
  assert.equal(manualFallback.sessionSource, "manual-fallback");

  const provenance = buildSessionTimingReport([topstepTrade({
    enteredAt: "2026-08-12T09:30:00",
    exitedAt: "2026-08-12T09:35:00",
    sourceTimezone: ""
  })], {
    reportTimeZone: "Asia/Manila",
    reportTimeZoneProvenance: "saved-user-setting",
    sourceTimeZone: "America/New_York",
    sourceTimeZoneProvenance: "confirmed-during-import"
  });
  assert.deepEqual(provenance.timeZones.report, {
    id: "Asia/Manila",
    provenance: "saved-user-setting",
    daylightSavingAware: true
  });
  assert.equal(provenance.timeZones.source.id, "America/New_York");
  assert.equal(provenance.timeZones.source.configuredProvenance, "confirmed-during-import");
  assert.equal(provenance.timeZones.source.evidence.confirmedSetting, 1);
  assert.equal(provenance.timeZones.source.requiresConfirmation, false);
}

// --- 3. Session definitions are DST-aware and may cross midnight ----------
{
  assert.equal(detectPrimarySession(Date.parse("2026-08-12T13:30:00Z")).primary, "New York");
  assert.equal(detectPrimarySession(Date.parse("2026-01-12T14:30:00Z")).primary, "New York");
  assert.equal(detectPrimarySession(Date.parse("2026-08-12T07:15:00Z")).primary, "London");
  assert.equal(detectPrimarySession(Date.parse("2026-01-12T08:15:00Z")).primary, "London");
  assert.equal(detectPrimarySession(Date.parse("2026-08-15T13:30:00Z")).primary, "Off session");

  const overnight = [{
    label: "Overnight",
    timeZone: "Asia/Singapore",
    startMinute: 22 * 60,
    endMinute: 2 * 60,
    weekdays: [1, 2, 3, 4, 5]
  }];
  assert.equal(
    detectPrimarySession(Date.parse("2026-08-14T15:00:00Z"), { sessionWindows: overnight }).primary,
    "Overnight",
    "Friday 23:00 Singapore is inside Friday's overnight session"
  );
  assert.equal(
    detectPrimarySession(Date.parse("2026-08-14T17:00:00Z"), { sessionWindows: overnight }).primary,
    "Overnight",
    "Saturday 01:00 belongs to Friday's still-open session"
  );
  assert.equal(
    detectPrimarySession(Date.parse("2026-08-15T15:00:00Z"), { sessionWindows: overnight }).primary,
    "Off session",
    "Saturday night's new open is excluded by weekday rules"
  );
}

// --- 4. Source detection requires normalized metadata, never raw rows -----
{
  assert.deepEqual(detectNormalizedTradeSource(topstepTrade()).key, "topstepx");
  assert.deepEqual(detectNormalizedTradeSource(topstepOrders()).key, "topstepx-orders");
  assert.equal(detectNormalizedTradeSource(closed()).key, "manual");

  const rawOrder = {
    Id: "ORDER-1",
    FilledAt: "08/13/2026 09:00:00 +08:00",
    PositionDisposition: "Opening",
    ExecutePrice: "2000"
  };
  assert.equal(detectNormalizedTradeSource(rawOrder).normalized, false);
  const report = buildSessionTimingReport([rawOrder, topstepOrders()]);
  assert.equal(report.coverage.invalidNormalized, 1);
  assert.equal(report.coverage.total, 1);
  assert.equal(report.source.key, "topstepx-orders");
}

// --- 5. P&L values carry honest net/gross/broker provenance ---------------
{
  const brokerNet = resolveTradePnl(topstepTrade({
    brokerPnl: 125.5,
    sourceFees: -4.26,
    sourceCommissions: -2.5,
    fees: 4.26,
    commissions: 2.5,
    costs: 6.76
  }));
  assert.equal(brokerNet.value, 118.74);
  assert.equal(brokerNet.basis, "net");
  assert.equal(brokerNet.costs, 6.76, "the total cost field is not added a second time");

  const missingCosts = resolveTradePnl(topstepTrade({
    brokerPnl: 125.5,
    sourceFees: null,
    sourceCommissions: "",
    fees: null,
    commissions: undefined,
    costs: null
  }));
  assert.equal(missingCosts.value, 125.5);
  assert.equal(missingCosts.basis, "broker");
  assert.equal(missingCosts.label, "Broker P&L", "unknown costs cannot turn broker P&L into claimed net P&L");
  assert.equal(
    resolveTradePnl(topstepTrade({
      brokerPnl: 125.5,
      sourceFees: -4.26,
      sourceCommissions: null,
      fees: null,
      commissions: null,
      costs: null
    })).basis,
    "broker",
    "one known cost component is not enough evidence for net P&L"
  );

  const estimated = resolveTradePnl(topstepOrders({ estimatedNetPnl: 91.25, calculatedGrossPnl: 100 }));
  assert.equal(estimated.value, 91.25);
  assert.equal(estimated.label, "Estimated net P&L");
  const gross = resolveTradePnl(topstepOrders({
    estimatedNetPnl: undefined,
    netPnl: undefined,
    pnlIsEstimated: false,
    calculatedGrossPnl: 100
  }));
  assert.equal(gross.value, 100);
  assert.equal(gross.label, "Gross P&L");
  assert.equal(resolveTradePnl(closed({ netPnl: 44 })).label, "Net P&L");

  const mixed = buildSessionTimingReport([
    closed({ netPnl: 25 }),
    topstepOrders({ estimatedNetPnl: undefined, netPnl: undefined, pnlIsEstimated: false, calculatedGrossPnl: 10 })
  ]);
  assert.equal(mixed.pnl.basis, "mixed");
  assert.equal(mixed.pnl.label, "Mixed-basis P&L");
}

// --- 6. Actual Topstep Trades fixture feeds truthful report net P&L -------
{
  const csv = readFileSync(`${ROOT}/tests/fixtures/topstep_trades_sanitized.csv`, "utf8");
  const parsed = parseTopstepCsv(csv);
  assert.deepEqual(parsed.errors, []);
  const report = buildSessionTimingReport(parsed.trades, { sourceTimeZone: "America/New_York" });
  assert.equal(report.reportTimeZone, DEFAULT_REPORT_TIME_ZONE);
  assert.equal(report.source.label, "TopstepX Trades");
  assert.equal(report.source.topstepDetected, true);
  assert.equal(report.pnl.label, "Net P&L");
  assert.equal(report.pnl.value, 152.5, "fixture broker P&L is reduced once by its fees and commissions");
  assert.equal(report.coverage.total, 3);
  assert.equal(report.coverage.exact, 1);
  assert.equal(report.coverage.assumed, 2);
  assert.equal(report.coverage.durationKnown, 3);
  assert.equal(report.hours[9].sourceIndexes.length, 2);
  assert.deepEqual(report.sessions.map((row) => row.label), ["Asia", "London", "New York", "Off session"]);
}

// --- 7. Actual Orders cycles aggregate; raw duplicates do not double count 
{
  const csv = readFileSync(`${ROOT}/tests/fixtures/topstep_orders_reconstruction_sanitized.csv`, "utf8");
  const parsed = parseTopstepOrdersCsv(csv);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.trades.length, 14);
  const report = buildSessionTimingReport([...parsed.trades, { ...parsed.trades[0] }]);
  assert.equal(report.coverage.input, 15);
  assert.equal(report.coverage.total, 14);
  assert.equal(report.coverage.duplicatesExcluded, 1);
  assert.equal(report.coverage.durationKnown, 14);
  assert.equal(report.source.label, "TopstepX Orders");
  assert.equal(report.pnl.value, 1095);
  assert.equal(report.pnl.basis, "gross");
  assert.equal(report.pnl.label, "Gross P&L");
}

// --- 8. Relative and explicit date ranges have inclusive stable boundaries 
{
  const dateRows = [
    closed({ id: "jul-21", enteredAt: "2026-07-21T14:00:00Z", exitedAt: "2026-07-21T14:05:00Z" }),
    closed({ id: "jul-22", enteredAt: "2026-07-22T14:00:00Z", exitedAt: "2026-07-22T14:05:00Z" }),
    closed({ id: "aug-20", enteredAt: "2026-08-20T14:00:00Z", exitedAt: "2026-08-20T14:05:00Z" })
  ];
  const last30 = buildSessionTimingReport(dateRows, { dateRange: "30d" });
  assert.deepEqual(last30.dateRange, {
    preset: "30d",
    anchor: "2026-08-20",
    from: "2026-07-22",
    to: "2026-08-20",
    active: true,
    inclusive: true,
    basis: "entry date in report timezone; source trade date fallback when entry time is unresolved"
  });
  assert.equal(last30.coverage.total, 2);
  assert.equal(last30.coverage.outsideDateRange, 1);

  const ytd = buildSessionTimingReport([
    closed({ enteredAt: "2025-12-31T15:00:00Z", exitedAt: "2025-12-31T15:05:00Z" }),
    closed({ enteredAt: "2026-01-01T15:00:00Z", exitedAt: "2026-01-01T15:05:00Z" }),
    closed({ enteredAt: "2026-08-20T15:00:00Z", exitedAt: "2026-08-20T15:05:00Z" })
  ], { dateRange: "ytd" });
  assert.equal(ytd.dateRange.from, "2026-01-01");
  assert.equal(ytd.dateRange.to, "2026-08-20");
  assert.equal(ytd.coverage.total, 2);

  const exactBoundary = buildSessionTimingReport(dateRows, {
    dateRange: { from: "2026-07-22", to: "2026-07-22" }
  });
  assert.equal(exactBoundary.coverage.total, 1, "both explicit date boundaries are inclusive");
  assert.throws(
    () => buildSessionTimingReport(dateRows, { dateRange: { from: "2026-08-20", to: "2026-07-01" } }),
    /start must not be after/
  );
}

// --- 9. Report timezone changes hours/dates, never venue session labels ----
{
  const row = closed({
    id: "zone-boundary",
    enteredAt: "2026-08-01T00:30:00Z",
    exitedAt: "2026-08-01T00:35:00Z",
    netPnl: 50
  });
  const ny = buildSessionTimingReport([row], {
    reportTimeZone: "America/New_York",
    dateRange: { from: "2026-08-01", to: "2026-08-01" }
  });
  const manila = buildSessionTimingReport([row], {
    reportTimeZone: "Asia/Manila",
    dateRange: { from: "2026-08-01", to: "2026-08-01" }
  });
  assert.equal(ny.coverage.total, 0, "00:30Z is still July 31 in New York");
  assert.equal(manila.coverage.total, 1, "00:30Z is August 1 in Manila");

  const sameTrades = [closed({
    enteredAt: "2026-08-12T13:30:00Z",
    exitedAt: "2026-08-12T13:35:00Z"
  })];
  const nyAll = buildSessionTimingReport(sameTrades, { reportTimeZone: "America/New_York" });
  const manilaAll = buildSessionTimingReport(sameTrades, { reportTimeZone: "Asia/Manila" });
  assert.deepEqual(
    nyAll.sessions.map((session) => [session.label, session.count]),
    manilaAll.sessions.map((session) => [session.label, session.count]),
    "display timezone does not relabel venue sessions"
  );
  assert.equal(nyAll.hours[9].count, 1);
  assert.equal(manilaAll.hours[21].count, 1);
}

// --- 10. Best and weakest entry hours are confidence-gated ----------------
{
  const thinWinner = Array.from({ length: 4 }, (_, index) => closed({
    id: `thin-${index}`,
    enteredAt: `2026-08-12T09:${31 + index}:00-04:00`,
    exitedAt: `2026-08-12T09:${36 + index}:00-04:00`,
    netPnl: 100
  }));
  const reliableWinner = Array.from({ length: 5 }, (_, index) => closed({
    id: `good-${index}`,
    enteredAt: `2026-08-12T10:0${index}:00-04:00`,
    exitedAt: `2026-08-12T10:1${index}:00-04:00`,
    netPnl: 20
  }));
  const reliableLoser = Array.from({ length: 5 }, (_, index) => closed({
    id: `bad-${index}`,
    enteredAt: `2026-08-12T11:0${index}:00-04:00`,
    exitedAt: `2026-08-12T11:1${index}:00-04:00`,
    netPnl: -10
  }));
  const report = buildSessionTimingReport([...thinWinner, ...reliableWinner, ...reliableLoser]);
  assert.equal(report.bestObservedHour.hour, 9);
  assert.equal(report.bestObservedHour.confidence.key, "developing");
  assert.equal(report.entryTime.bestHour.hour, 10, "a thin higher total cannot be called the best hour");
  assert.equal(report.entryTime.bestHour.confidence.key, "reliable");
  assert.equal(report.entryTime.weakestHour.hour, 11);
  assert.equal(report.entryTime.weakestHour.pnl, -50);
  assert.deepEqual(report.entryTime.bestHour.tradeIds, ["good-0", "good-1", "good-2", "good-3", "good-4"]);
  assert.equal(report.bestSession.label, "New York");

  const onlyThin = buildSessionTimingReport(thinWinner);
  assert.equal(onlyThin.entryTime.bestHour, null);
  assert.equal(onlyThin.bestSession, null);
  assert.equal(onlyThin.headline.entryHour.conclusion, "developing signal");
  assert.doesNotMatch(onlyThin.headline.entryHour.conclusion, /best/i);
}

// --- 11. Winner/loser medians and best duration band are truthful ----------
{
  const winners = [31, 32, 33, 34, 35].map((minutes, index) => closed({
    id: `winner-${index}`,
    enteredAt: `2026-08-12T10:00:0${index}-04:00`,
    exitedAt: `2026-08-12T10:${minutes}:0${index}-04:00`,
    netPnl: 40,
    tradeDuration: `00:${minutes}:00`
  }));
  const losers = Array.from({ length: 5 }, (_, index) => closed({
    id: `loser-${index}`,
    enteredAt: `2026-08-12T11:0${index}:00-04:00`,
    exitedAt: `2026-08-12T11:1${index}:00-04:00`,
    netPnl: -10,
    tradeDuration: "00:10:00"
  }));
  // Manual trades use exact entry/exit duration; broker duration strings are
  // not trusted for them, so the timestamp differences above are authoritative.
  const report = buildSessionTimingReport([...winners, ...losers]);
  assert.equal(report.duration.winners.medianMs, 33 * 60_000);
  assert.equal(report.duration.losers.medianMs, 10 * 60_000);
  assert.equal(report.duration.comparison.differenceMs, 23 * 60_000);
  assert.equal(report.duration.comparison.direction, "longer");
  assert.equal(report.duration.comparison.meaningful, true);
  assert.equal(report.duration.comparison.confidence.key, "reliable");
  assert.equal(report.duration.bestBand.key, "30m-60m");
  assert.equal(report.duration.bestBand.pnl, 200);
  assert.deepEqual(report.duration.bestBand.tradeIds, winners.map((trade) => trade.id));
  assert.match(report.duration.meaning, /not time spent floating in profit/i);
}

// --- 12. Journal coverage is operational and exposes actionable ids -------
{
  const rows = [
    topstepTrade({
      id: "journalled-old",
      externalTradeId: "J-1",
      enteredAt: "2026-08-10T13:30:00Z",
      exitedAt: "2026-08-10T13:35:00Z",
      journalledAt: "2026-08-11T00:00:00Z"
    }),
    topstepTrade({
      id: "journalled-note",
      externalTradeId: "J-2",
      enteredAt: "2026-08-11T13:30:00Z",
      exitedAt: "2026-08-11T13:35:00Z",
      notes: "Waited for confirmation"
    }),
    topstepTrade({
      id: "next-unjournalled",
      externalTradeId: "J-3",
      enteredAt: "2026-08-12T13:30:00Z",
      exitedAt: "2026-08-12T13:35:00Z"
    }),
    topstepTrade({
      id: "missing-import",
      externalTradeId: "J-4",
      enteredAt: "2026-08-13T09:30:00",
      exitedAt: "",
      sourceTimezone: "",
      tradeDuration: ""
    })
  ];
  const report = buildSessionTimingReport(rows);
  assert.equal(report.journalCoverage.total, 4);
  assert.equal(report.journalCoverage.journaled, 2);
  assert.equal(report.journalCoverage.unjournalled, 2);
  assert.equal(report.journalCoverage.completionPercent, 50);
  assert.equal(report.journalCoverage.nextTradeId, "next-unjournalled");
  assert.equal(report.journalCoverage.imported.total, 4);
  assert.equal(report.journalCoverage.imported.missingOrIncomplete, 1);
  assert.deepEqual(report.journalCoverage.imported.missingOrIncompleteTradeIds, ["missing-import"]);
  assert.equal(report.journalCoverage.imported.missingFields.entryTime, 1);
  assert.equal(report.journalCoverage.imported.missingFields.exitTime, 1);
  assert.equal(report.journalCoverage.imported.missingFields.duration, 1);
  assert.equal(report.journalCoverage.imported.missingFields.sourceTimeZone, 1);
  assert.equal(report.timeZones.source.requiresConfirmation, true);
}

// --- 13. Duration parsing/statistics remain strict and reusable ------------
{
  assert.equal(parseDurationMs("00:45:30"), 2_730_000);
  assert.equal(parseDurationMs("25:00:00"), 90_000_000);
  assert.equal(parseDurationMs("00:00:01.250"), 1_250);
  assert.equal(parseDurationMs("00:60:00"), null);
  assert.equal(parseDurationMs("-01:00:00"), null);
  assert.deepEqual(summarizeDurations([60_000, 180_000, 300_000, 420_000]), {
    count: 4,
    avgMs: 240_000,
    medianMs: 240_000,
    q1Ms: 150_000,
    q3Ms: 330_000,
    minMs: 60_000,
    maxMs: 420_000
  });
}

// --- 14. Empty-state shape stays complete and UI-safe ---------------------
{
  const report = buildSessionTimingReport([], { dateRange: "all" });
  assert.equal(report.hours.length, 24);
  assert.deepEqual(report.sessions.map((row) => row.label), ["Asia", "London", "New York", "Off session"]);
  assert.equal(report.confidence.key, "none");
  assert.equal(report.entryTime.bestHour, null);
  assert.equal(report.entryTime.weakestHour, null);
  assert.equal(report.duration.bestBand, null);
  assert.equal(report.bestSession, null);
  assert.equal(report.journalCoverage.total, 0);
  assert.match(report.headline.sentence, /import normalized closed trades/i);
}

console.log(
  "sessionReport.check.mjs: OK - normalized Topstep sources, net/gross provenance, DST sessions, deterministic ranges, confidence gates, drill-down refs, duration and journal coverage pinned"
);
