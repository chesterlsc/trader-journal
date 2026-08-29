// Topstep -> Session Intelligence -> visible-copy integration contract.
//
// Parser/reconstruction math has deeper fixture suites. This test crosses the
// module boundaries that those suites intentionally do not: actual sanitized
// Topstep exports must become the report object renderAll consumes, and the UI
// must preserve its source, timezone and P&L-basis labels instead of relabeling
// every broker/gross value as "net". It also pins the versioned child-module
// import that keeps a cached browser app bundle bootable after format exports
// change.
//
// Run: node tests/sessionIntelligenceIntegration.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTopstepCsv } from "../src/lib/topstepImport.js";
import { parseTopstepOrdersCsv } from "../src/lib/topstepOrdersImport.js";
import { buildSessionTimingReport } from "../src/lib/sessionReport.js";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const appSrc = read("app.js");
const html = read("index.html");

function takeFunction(source, name) {
  const start = source.search(new RegExp(`^function ${name}\\(`, "m"));
  assert.ok(start >= 0, `missing function ${name}`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return source.slice(start, end + 3);
}

// --- 1. The app and its newly exported formatter boot as one cache version
const formatImport = /from\s+"(\.\/src\/lib\/format\.js\?v=([^"]+))"/.exec(appSrc);
assert.ok(formatImport, "app.js must version its format.js child import; an unversioned cached child can fail before init()");
assert.ok(formatImport[2].trim(), "format.js child-module cache version must not be empty");
assert.match(html, /<script type="module" src="app\.js\?v=[^"]+"><\/script>/, "the browser entry module must also remain cache-versioned");
const formatModuleUrl = new URL(`../${formatImport[1].replace(/^\.\//, "")}`, import.meta.url);
const formatModule = await import(formatModuleUrl);
assert.equal(typeof formatModule.formatStatMoney, "function", "the exact versioned child module must export formatStatMoney");
assert.equal(formatModule.formatStatMoney(1250), "$1,250");

// --- 2. Real Topstep Trades become a source- and timezone-proven report ----
const tradesCsv = read("tests/fixtures/topstep_trades_sanitized.csv");
const parsedTrades = parseTopstepCsv(tradesCsv);
assert.deepEqual(parsedTrades.errors, []);
const tradesReport = buildSessionTimingReport(parsedTrades.trades, {
  reportTimeZone: "Asia/Manila",
  reportTimeZoneProvenance: "saved-user-setting",
  sourceTimeZone: "America/New_York",
  sourceTimeZoneProvenance: "confirmed-during-import"
});
assert.deepEqual(
  [tradesReport.source.key, tradesReport.source.label, tradesReport.source.topstepDetected],
  ["topstepx", "TopstepX Trades", true]
);
assert.deepEqual(
  [tradesReport.coverage.input, tradesReport.coverage.total, tradesReport.coverage.analyzed],
  [3, 3, 3],
  "all three normalized closed trade cycles from the fixture must reach Session Intelligence"
);
assert.deepEqual(
  tradesReport.timeZones.report,
  { id: "Asia/Manila", provenance: "saved-user-setting", daylightSavingAware: true }
);
assert.equal(tradesReport.timeZones.source.configuredId, "America/New_York");
assert.equal(tradesReport.timeZones.source.configuredProvenance, "confirmed-during-import");
assert.equal(tradesReport.timeZones.source.requiresConfirmation, false);
assert.equal(tradesReport.pnl.label, "Net P&L");
assert.equal(tradesReport.pnl.value, 152.5);

// --- 3. Real reconstructed Orders stay gross until costs are actually known
const ordersCsv = read("tests/fixtures/topstep_orders_reconstruction_sanitized.csv");
const parsedOrders = parseTopstepOrdersCsv(ordersCsv);
assert.deepEqual(parsedOrders.errors, []);
const ordersReport = buildSessionTimingReport(parsedOrders.trades, { reportTimeZone: "America/New_York" });
assert.deepEqual(
  [ordersReport.source.key, ordersReport.source.label, ordersReport.source.topstepDetected],
  ["topstepx-orders", "TopstepX Orders", true]
);
assert.equal(ordersReport.coverage.total, 14, "the UI report consumes completed cycles, not 67 raw fill rows");
assert.equal(ordersReport.coverage.durationKnown, 14);
assert.equal(ordersReport.pnl.value, 1095);
assert.equal(ordersReport.pnl.basis, "gross");
assert.equal(ordersReport.pnl.label, "Gross P&L", "raw Orders reconstruction must never impersonate net P&L");

// A broker result with no complete cost evidence gets its own honest label.
const brokerOnlyReport = buildSessionTimingReport([{
  id: "broker-only",
  status: "closed",
  importSource: "topstepx",
  externalTradeId: "BROKER-ONLY",
  brokerPnl: 125.5,
  enteredAt: "2026-08-12T13:30:00Z",
  exitedAt: "2026-08-12T13:35:00Z",
  tradeDuration: "00:05:00"
}]);
assert.equal(brokerOnlyReport.pnl.label, "Broker P&L");
assert.equal(brokerOnlyReport.pnl.isNet, false);

// --- 4. renderAll consumes this report and visible labels stay dynamic -----
const renderAll = takeFunction(appSrc, "renderAll");
assert.match(renderAll, /renderSessionTiming\(state\.analytics\.sessionTiming\)/);
assert.match(
  appSrc,
  /buildSessionTimingReport\(ordered,\s*\{[\s\S]*reportTimeZone:\s*settings\.timingReportTimeZone,[\s\S]*sourceTimeZone:\s*settings\.topstepSourceTimeZone,[\s\S]*dateRange:\s*settings\.sessionDateRange/,
  "the active account's normalized closed trades must be recalculated with all three persisted report filters"
);

const renderTiming = takeFunction(appSrc, "renderSessionTiming");
assert.match(renderTiming, /report\.headline\.sentence/);
assert.match(renderTiming, /report\.source\.topstepDetected/);
assert.match(renderTiming, /report\.source\.label/);
assert.match(renderTiming, /report\.coverage\.analyzed/);
assert.match(renderTiming, /renderExitDiscipline\(report\)/,
  "the exit pane must be scoped to the same report the header states");

// WHO CLOSED IT replaced the Topstep execution prose pane. The evidence it
// rests on still has to reach the screen: the closing-order disposition, the
// hand-vs-bracket cost with its five-a-side gate, and the P&L basis.
const exitRendererSource = takeFunction(appSrc, "renderExitDiscipline");
assert.match(exitRendererSource, /summarizeExitDiscipline/);
assert.match(exitRendererSource, /sessionReportTradeIds\(report\)/,
  "the exit pane must count only the trades inside the report's own date range");
assert.match(exitRendererSource, /summary\.comparable/,
  "the hand-vs-bracket verdict must stay behind its sample gate");
assert.match(exitRendererSource, /dataQuality\?\.pnlAndCosts/);
for (const basis of ["exactNet", "estimatedNet", "grossOnly", "brokerOnly"]) {
  assert.match(exitRendererSource, new RegExp(basis), `${basis} must survive into the exit pane's basis note`);
}

const summarizeSource = takeFunction(appSrc, "summarizeExitDiscipline");
assert.match(summarizeSource, /manual\.count >= 5 && plannedCount >= 5/,
  "five cycles a side stays the floor for calling a hand-close cost");

// Execute the real scorecard renderer with small DOM-like nodes. This catches
// the dangerous regression where engine provenance remains correct while the
// last UI hop hardcodes "Net P&L" again.
const scorecardSource = takeFunction(appSrc, "renderSessionScorecard");
const ledgerOrder = /const SESSION_LEDGER_ORDER = (\[[^\]]*\]);/.exec(appSrc);
assert.ok(ledgerOrder, "the sessions ledger must keep its fixed row order");
const node = () => ({
  textContent: "",
  innerHTML: "",
  title: "",
  classList: { toggle() {} }
});
function renderScorecard(report) {
  const ui = {
    sessionScorecard: node(),
    sessionLedgerBasis: node(),
    sessionLedgerFoot: node()
  };
  const setTimingValue = (target, text) => { if (target) target.textContent = text; };
  const timingTone = (value) => value > 0 ? "is-positive" : value < 0 ? "is-negative" : "is-flat";
  const timingMoney = (value) => `$${Number(value || 0).toFixed(2)}`;
  const escapeHtml = (value) => String(value ?? "");
  const timingWithheld = (count) => `Withheld n=${count}`;
  const timingZoneLabel = (zone) => `${zone} (TZ)`;
  const SESSION_LEDGER_ORDER = JSON.parse(ledgerOrder[1].replace(/'/g, '"'));
  // eslint-disable-next-line no-new-func
  const render = new Function(
    "ui",
    "setTimingValue",
    "timingTone",
    "timingMoney",
    "escapeHtml",
    "timingWithheld",
    "timingZoneLabel",
    "SESSION_LEDGER_ORDER",
    `${scorecardSource}\nreturn renderSessionScorecard;`
  )(ui, setTimingValue, timingTone, timingMoney, escapeHtml, timingWithheld, timingZoneLabel, SESSION_LEDGER_ORDER);
  render(report);
  return ui;
}

// The ledger prints all four sessions in a fixed order, and the engine's
// basis label must reach the reader rather than a hardcoded "Net P&L".
for (const [report, expectedLabel] of [
  [tradesReport, "Net P&L"],
  [ordersReport, "Gross P&L"],
  [brokerOnlyReport, "Broker P&L"]
]) {
  const ui = renderScorecard(report);
  assert.equal(ui.sessionLedgerBasis.title, expectedLabel, `${expectedLabel} must stay reachable on the ledger`);
  assert.equal(
    (ui.sessionScorecard.innerHTML.match(/class="ledger-row/g) || []).length,
    4,
    "all four sessions print, including the ones with no trades"
  );
  if (report.sessions.some((row) => row.count && row.confidence.key === "reliable")) {
    assert.ok(
      ui.sessionScorecard.innerHTML.includes(expectedLabel),
      `${expectedLabel} must survive into hover/accessible detail copy`
    );
  }
}

const almanacRenderer = takeFunction(appSrc, "renderSessionAlmanac");
assert.match(almanacRenderer, /cell\.pnlLabel/, "almanac cells must carry the engine's net/gross/broker basis into their detail copy");
const cfRenderer = takeFunction(appSrc, "renderSessionCounterfactual");
assert.match(cfRenderer, /report\.pnl\.label/, "the counterfactual must state the report's P&L basis, never hardcode one");
const durationRenderer = takeFunction(appSrc, "renderSessionDurations");
assert.match(durationRenderer, /report\.pnl\.label/);
assert.match(durationRenderer, /band\.pnlLabel/, "each hold band must carry its own P&L basis into its detail copy");
assert.doesNotMatch(durationRenderer, /stayed profitable|profitable for\s+\$\{/i);
const drawerRenderer = takeFunction(appSrc, "openSessionTradeDrawer");
assert.match(drawerRenderer, /resolveTradePnl\(trade\)/);
assert.match(drawerRenderer, /pnl\.label\.toLowerCase\(\)/, "the cell drawer must carry the same net/gross/broker label as the report");

console.log("sessionIntelligenceIntegration.check.mjs: OK — boot cache, Topstep source/timezone, and visible P&L provenance stay connected");
