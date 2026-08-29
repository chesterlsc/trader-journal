// Almanac, counterfactual and tilt data-contract checks.
//
// The almanac buckets analyzed trades into weekday-by-hour cells of the
// report timezone; the counterfactual re-sums the same fills with reliable
// red-cell entries skipped (never twice); the tilt radar flags entries
// stamped within minutes of a losing exit. All three are arithmetic over
// broker timestamps — nothing here estimates.
//
// Run: node tests/sessionAlmanac.check.mjs
import assert from "node:assert/strict";
import {
  CONFIDENCE_THRESHOLDS,
  TILT_WINDOW_MINUTES,
  buildSessionTimingReport
} from "../src/lib/sessionReport.js";

let nextId = 1;
const topstepTrade = (enteredAt, exitedAt, netPnl) => ({
  id: `trade-${nextId++}`,
  status: "closed",
  notes: "",
  importSource: "topstepx",
  externalSource: "topstepx",
  externalTradeId: `TS-${nextId}`,
  brokerPnl: netPnl,
  netPnl,
  sourceFees: 0,
  sourceCommissions: 0,
  enteredAt,
  exitedAt,
  session: "Not recorded"
});

// New York is UTC-4 in August 2026. Aug 11 = Tuesday, Aug 12 = Wednesday,
// Aug 13 = Thursday.
const trades = [
  // Tue 10:00–11:00 ET green vein: six +$50 winners.
  ...[0, 5, 10, 15, 20, 25].map((minute) =>
    topstepTrade(`2026-08-11T14:${String(minute).padStart(2, "0")}:00Z`, `2026-08-11T14:${String(minute + 2).padStart(2, "0")}:00Z`, 50)),
  // The tilt pair: a loser exiting 10:30 ET, re-entry three minutes later.
  topstepTrade("2026-08-11T14:20:00Z", "2026-08-11T14:30:00Z", -30),
  topstepTrade("2026-08-11T14:33:00Z", "2026-08-11T14:40:00Z", 20),
  // Wed 13:00–14:00 ET red scar: five -$40 losers, spaced so their own
  // exits never fall inside the next entry's tilt window.
  ...[0, 12, 24, 36, 48].map((minute) =>
    topstepTrade(`2026-08-12T17:${String(minute).padStart(2, "0")}:00Z`, `2026-08-12T17:${String(minute + 5).padStart(2, "0")}:00Z`, -40)),
  // Thu 09:00–10:00 ET thin pair: negative but below the reliable floor,
  // so it must never become a red cell.
  topstepTrade("2026-08-13T13:10:00Z", "2026-08-13T13:15:00Z", -10),
  topstepTrade("2026-08-13T13:40:00Z", "2026-08-13T13:45:00Z", -10)
];

const report = buildSessionTimingReport(trades, { reportTimeZone: "America/New_York" });

// --- Almanac cells ---------------------------------------------------------
const { almanac } = report;
assert.equal(almanac.timeZone, "America/New_York");
assert.equal(almanac.cellSampleFloor, CONFIDENCE_THRESHOLDS.reliable.min);
assert.equal(almanac.columnSampleFloor, CONFIDENCE_THRESHOLDS.reliable.min * 3);

const cell = (day, hour) => almanac.cells.find((entry) => entry.day === day && entry.hour === hour);
const vein = cell(2, 10);
assert.ok(vein, "Tuesday 10:00 cell must exist");
assert.equal(vein.count, 8);
assert.equal(vein.pnl, 290);
assert.equal(vein.confidence.key, "reliable");
assert.equal(vein.label, "Tue 10:00-11:00");
assert.equal(vein.tradeIds.length, 8);

const scar = cell(3, 13);
assert.equal(scar.count, 5);
assert.equal(scar.expectancy, -40);
assert.equal(scar.confidence.key, "reliable");

const thin = cell(4, 9);
assert.equal(thin.count, 2);
assert.ok(thin.expectancy < 0);
assert.notEqual(thin.confidence.key, "reliable");

// Weekday margin rows reconcile with their cells.
const tuesday = almanac.weekdays.find((row) => row.day === 2);
assert.equal(tuesday.count, 8);
assert.equal(tuesday.pnl, 290);
assert.equal(
  almanac.weekdays.reduce((sum, row) => sum + row.pnl, 0),
  report.pnl.value,
  "weekday nets must sum to the report net"
);

// Only the reliable negative cell is a red cell; the thin negative pair is
// an observation, not a scar.
assert.deepEqual(almanac.redCells.map((entry) => entry.key), ["3-13"]);
assert.equal(almanac.redCells[0].pnl, -200);

// --- Counterfactual --------------------------------------------------------
const { counterfactual } = report;
assert.equal(counterfactual.available, true);
assert.equal(counterfactual.tradeCount, 15);
assert.equal(counterfactual.skippedTrades, 5);
assert.equal(counterfactual.real, 70);
assert.equal(counterfactual.hypothetical, 270);
assert.equal(counterfactual.recovered, 200);
// No double counting: recovered is exactly the red cells' summed net.
assert.equal(
  counterfactual.recovered,
  -almanac.redCells.reduce((sum, entry) => sum + entry.pnl, 0)
);
assert.equal(counterfactual.points.length, 15);
const lastPoint = counterfactual.points[counterfactual.points.length - 1];
assert.equal(lastPoint.real, 70);
assert.equal(lastPoint.hypothetical, 270);
assert.match(counterfactual.caveat, /Hypothetical, not advice/);

// --- Tilt radar ------------------------------------------------------------
const { tilt } = report;
assert.equal(tilt.windowMinutes, TILT_WINDOW_MINUTES);
assert.equal(tilt.count, 1, "only the three-minute re-entry is a revenge entry");
assert.equal(tilt.pnl, 20);
assert.equal(tilt.winRate, 100);
assert.equal(tilt.baselineCount, 15);
assert.equal(tilt.baselineWinRate, 46.67);
assert.deepEqual(tilt.cells, [{ key: "2-10", day: 2, hour: 10, count: 1 }]);
assert.equal(tilt.tradeIds.length, 1);

// --- Identity edge cases ---------------------------------------------------
// Tilt matching is by record, never by id string: id-less trades must not
// self-match away, and duplicate ids must not suppress a genuine revenge
// entry. The id-less flagged entry still counts even though it cannot be
// listed (no id to resolve).
const stripId = (trade) => ({ ...trade, id: "", externalTradeId: "" });
const idlessPair = buildSessionTimingReport([
  stripId(topstepTrade("2026-08-11T14:20:00Z", "2026-08-11T14:30:00Z", -30)),
  stripId(topstepTrade("2026-08-11T14:33:00Z", "2026-08-11T14:40:00Z", 20))
], { reportTimeZone: "America/New_York" });
assert.equal(idlessPair.tilt.count, 1, "id-less trades must not self-match away a revenge entry");
assert.equal(idlessPair.tilt.tradeIds.length, 0, "an id-less flagged entry has no id to list");

const dupIdPair = buildSessionTimingReport([
  { ...topstepTrade("2026-08-11T14:20:00Z", "2026-08-11T14:30:00Z", -30), id: "same" },
  { ...topstepTrade("2026-08-11T14:33:00Z", "2026-08-11T14:40:00Z", 20), id: "same" }
], { reportTimeZone: "America/New_York" });
assert.equal(dupIdPair.tilt.count, 1, "duplicate ids must not suppress a genuine revenge entry");

// --- Degenerate inputs -----------------------------------------------------
const greensOnly = buildSessionTimingReport(trades.slice(0, 6), { reportTimeZone: "America/New_York" });
assert.equal(greensOnly.almanac.redCells.length, 0);
assert.equal(greensOnly.counterfactual.available, false);
assert.equal(greensOnly.counterfactual.recovered, 0);
assert.equal(greensOnly.tilt.count, 0);

const empty = buildSessionTimingReport([], { reportTimeZone: "America/New_York" });
assert.deepEqual(empty.almanac.cells, []);
assert.equal(empty.counterfactual.available, false);
assert.equal(empty.tilt.count, 0);

console.log("sessionAlmanac.check: ok");
