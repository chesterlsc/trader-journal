// App-level Topstep import contract, driven from the REAL app.js functions.
// The CSV parser has its own suite; this file pins the hand-off points where a
// valid broker row could otherwise be filed under the wrong account, have its
// P&L recomputed, acquire today's event tape, or lose its audit metadata on the
// next load.
//
// Run: node tests/topstepIntegration.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTopstepCsv, topstepDuplicateKey } from "../src/lib/topstepImport.js";
import {
  detectTopstepExport,
  parseTopstepOrdersCsv,
  topstepOrdersDuplicateKey
} from "../src/lib/topstepOrdersImport.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const appSrc = readFileSync(`${ROOT}/app.js`, "utf8");
const html = readFileSync(`${ROOT}/index.html`, "utf8");
const tradesCsv = readFileSync(`${ROOT}/tests/fixtures/topstep_trades_sanitized.csv`, "utf8");
const ordersCsv = readFileSync(`${ROOT}/tests/fixtures/topstep_orders_reconstruction_sanitized.csv`, "utf8");
const ordersCostSchedule = Object.freeze({
  MGC: Object.freeze({ effectiveFrom: "2026-07-20", verifiedThrough: "2026-08-14", fees: 1.42, commissions: 0.50 }),
  GC: Object.freeze({ effectiveFrom: "2026-07-20", verifiedThrough: "2026-08-14", fees: 3.32, commissions: 1.00 })
});
const ordersCostScheduleUrl = "https://help.topstep.com/en/articles/8284213-topstepx-commissions-and-fees";

function takeFunction(src, name) {
  const start = src.search(new RegExp(`^function ${name}\\(`, "m"));
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3);
}

// --- 1. Import belongs to Trade Review ------------------------------------
const journalStart = html.indexOf('<section class="view" id="journal"');
const journalEnd = html.indexOf('<section class="view" id="reflections"', journalStart);
assert.ok(journalStart >= 0 && journalEnd > journalStart, "Trade Review view is missing");
const journalHtml = html.slice(journalStart, journalEnd);
assert.match(journalHtml, /<h2 id="journalHeading">Trade Review<\/h2>/);
assert.match(
  journalHtml,
  /id="reviewImportBtn"[\s\S]*?>Import<\/button>[\s\S]*?id="reviewExportBtn"/,
  "Import must sit in the Trade Review header beside Export"
);

const dialogStart = html.indexOf('<dialog id="tradeImportDialog"');
const dialogEnd = html.indexOf("</dialog>", dialogStart);
assert.ok(dialogStart >= 0 && dialogEnd > dialogStart, "Trade Review import dialog is missing");
const dialogHtml = html.slice(dialogStart, dialogEnd + 9);
assert.match(dialogHtml, /aria-labelledby="tradeImportTitle"/);
assert.match(dialogHtml, /class="trade-import-kicker">Trade Review<\/p>/);
assert.match(dialogHtml, /<h2 id="tradeImportTitle">Import trades<\/h2>/);
assert.match(appSrc, /ui\.reviewImportBtn\?\.addEventListener\("click", openTradeImport\)/);
assert.match(takeFunction(appSrc, "closeTradeImport"), /ui\.reviewImportBtn\?\.focus\(\)/, "dialog must return focus to its Review trigger");

// --- 2. A Topstep identity is scoped to the active account ----------------
const parseSelectedBundle = [
  takeFunction(appSrc, "isTopstepOrdersImport"),
  takeFunction(appSrc, "applyTopstepOrdersCostEstimate"),
  takeFunction(appSrc, "parseSelectedBulkTrades"),
  "return { parseSelectedBulkTrades };"
].join("\n");
const stateForParse = { settings: { activeAccountId: "acct-50k" } };
const uiForParse = {
  bulkSource: { value: "topstep" },
  bulkInput: { value: tradesCsv }
};
// eslint-disable-next-line no-new-func
const parseSelectedApi = new Function(
  "state",
  "ui",
  "parseTopstepCsv",
  "topstepDuplicateKey",
  "detectTopstepExport",
  "parseTopstepOrdersCsv",
  "topstepOrdersDuplicateKey",
  "TOPSTEP_ORDERS_COST_SCHEDULE",
  "TOPSTEP_COST_SCHEDULE_URL",
  "round",
  "parseBulkTrades",
  parseSelectedBundle
)(
  stateForParse,
  uiForParse,
  parseTopstepCsv,
  topstepDuplicateKey,
  detectTopstepExport,
  parseTopstepOrdersCsv,
  topstepOrdersDuplicateKey,
  ordersCostSchedule,
  ordersCostScheduleUrl,
  (value) => Math.round(Number(value) * 100) / 100,
  () => { throw new Error("generic parser used for a Topstep source"); }
);

const firstAccountTrade = parseSelectedApi.parseSelectedBulkTrades().trades[0];
assert.equal(firstAccountTrade.accountId, "acct-50k");
assert.match(firstAccountTrade.importKey, /:account:acct-50k$/);
assert.deepEqual(firstAccountTrade.eventContext, [], "the app hand-off must explicitly carry no historical event stamp");
assert.equal(firstAccountTrade.enteredAt, "2026-08-12T13:30:00.000Z");
assert.equal(firstAccountTrade.exitedAt, "2026-08-12T14:15:30.000Z");
assert.equal(firstAccountTrade.sourceTimezone, "UTC", "Topstep timestamps must retain their explicit source timezone");
assert.equal(firstAccountTrade.sourceFees, -4.26, "the signed fee value from Topstep must remain available for audit");
assert.equal(firstAccountTrade.sourceCommissions, -2.5, "the signed commission value from Topstep must remain available for audit");
assert.equal(firstAccountTrade.fees, 4.26, "journal costs are stored as nonnegative values");
assert.equal(firstAccountTrade.commissions, 2.5, "journal costs are stored as nonnegative values");

stateForParse.settings.activeAccountId = "acct-funded";
const secondAccountTrade = parseSelectedApi.parseSelectedBulkTrades().trades[0];
assert.equal(secondAccountTrade.accountId, "acct-funded");
assert.match(secondAccountTrade.importKey, /:account:acct-funded$/);
assert.notEqual(
  firstAccountTrade.importKey,
  secondAccountTrade.importKey,
  "the same broker id in two Topstep accounts must not collide"
);

// A current Topstep Orders export auto-routes even if the source selector was
// left on Generic. Raw account/order identifiers are consumed only to create a
// stable fingerprint and are stripped before the row reaches persistence.
uiForParse.bulkSource.value = "generic";
uiForParse.bulkInput.value = ordersCsv;
const reconstructedParse = parseSelectedApi.parseSelectedBulkTrades();
assert.equal(reconstructedParse.fileKind, "orders");
assert.deepEqual(reconstructedParse.errors, []);
assert.equal(reconstructedParse.trades.length, 14);
assert.equal(reconstructedParse.trades.reduce((sum, trade) => sum + trade.sourceOrderCount, 0), 67);
assert.equal(reconstructedParse.trades.reduce((sum, trade) => sum + trade.roundTurnQuantity, 0), 61);
assert.equal(reconstructedParse.trades.reduce((sum, trade) => sum + trade.calculatedGrossPnl, 0), 1095);
assert.equal(reconstructedParse.trades.reduce((sum, trade) => sum + trade.estimatedFees, 0), 86.62);
assert.equal(reconstructedParse.trades.reduce((sum, trade) => sum + trade.estimatedCommissions, 0), 30.5);
assert.equal(reconstructedParse.trades.reduce((sum, trade) => sum + trade.estimatedCosts, 0), 117.12);
assert.equal(reconstructedParse.trades.reduce((sum, trade) => sum + trade.estimatedNetPnl, 0), 977.88);

const reconstructedInput = reconstructedParse.trades[0];
assert.equal(reconstructedInput.importSource, "topstepx-orders");
assert.equal(reconstructedInput.accountId, "acct-funded");
assert.match(reconstructedInput.importKey, /^topstepx-orders:fingerprint:tso_[0-9a-f]{16}:account:acct-funded$/);
assert.equal(reconstructedInput.sourceAccountName, undefined);
assert.equal(reconstructedInput.sourceOrderIds, undefined);
assert.equal(reconstructedInput.sourceExchangeOrderIds, undefined);
assert.equal(reconstructedInput.sourcePlatformOrderIds, undefined);
assert.equal(reconstructedInput.pnlProvenance, "calculated-from-filled-orders");
assert.equal(reconstructedInput.costProvenance, "estimated-topstep-round-turn-schedule");
assert.equal(reconstructedInput.costScheduleUrl, ordersCostScheduleUrl);
assert.ok(reconstructedInput.reconstructedDuration);
assert.equal(reconstructedInput.tradeDuration, "", "Orders holding time must not impersonate Topstep tradeDuration");
const reconstructedJson = JSON.stringify(reconstructedInput);
assert.doesNotMatch(reconstructedJson, /SIM-DEMO|SANITIZED-ORDER|SANITIZED-EXCHANGE|SANITIZED-PLATFORM/);
assert.doesNotMatch(reconstructedJson, /sourceAccountName|sourceOrderIds|sourceExchangeOrderIds|sourcePlatformOrderIds/);

uiForParse.bulkInput.value = ordersCsv.replaceAll("MGCZ6", "MNQZ6");
const unsupportedOrders = parseSelectedApi.parseSelectedBulkTrades();
assert.equal(unsupportedOrders.fileKind, "orders");
assert.equal(unsupportedOrders.trades.length, 0, "unverified futures multipliers must not create journal P&L");
assert.match(unsupportedOrders.errors.join("\n"), /supports MGC and GC.*Export Trades.*MNQ/i);
uiForParse.bulkInput.value = ordersCsv;

// --- 3. buildTradeRecord trusts broker P&L and never fabricates context ----
const buildBundle = [
  takeFunction(appSrc, "isTopstepOrdersImport"),
  takeFunction(appSrc, "isTopstepImport"),
  takeFunction(appSrc, "buildTradeRecord"),
  "return { buildTradeRecord };"
].join("\n");
const stateForBuild = { settings: { activeAccountId: "acct-funded" } };
let stampCalls = 0;
const metrics = {
  netPnl: 987.65,
  autoResult: "Win",
  riskAmount: 100,
  rMultiple: 9.87,
  rrRatio: 4,
  pips: 123,
  pipSize: 0.25,
  pipValuePerLot: 5,
  dollarPerPip: 10
};
const round = (value) => Math.round(Number(value) * 100) / 100;
const ensureNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const ensureNonNegative = (value, fallback) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
const toDateInputValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const today = toDateInputValue(new Date());
// eslint-disable-next-line no-new-func
const buildApi = new Function(
  "state", "calculateTradeMetrics", "round", "ensureNumber", "ensureNonNegative",
  "createId", "toDateInputValue", "stampFromEvents", "terminal", buildBundle
)(
  stateForBuild,
  () => ({ ...metrics }),
  round,
  ensureNumber,
  ensureNonNegative,
  () => "journal-id",
  toDateInputValue,
  () => {
    stampCalls += 1;
    return [{ k: "CPI", t: "CPI", c: "USD", i: "High", m: 3 }];
  },
  { events: [{ title: "today's event" }] }
);

const imported = buildApi.buildTradeRecord({
  status: "closed",
  date: today,
  market: "Futures",
  asset: "MGC",
  contractName: "MGCZ26",
  direction: "Buy",
  entryPrice: 2675.1,
  exitPrice: 2681.375,
  positionSize: 2,
  tradeResult: "Auto",
  brokerPnl: -42.75,
  sourceFees: -4.26,
  sourceCommissions: -2.5,
  fees: 4.26,
  commissions: 2.5,
  costs: 6.76,
  importSource: "topstepx",
  externalSource: "topstepx",
  importBatchId: "batch-1",
  importKey: "topstepx:id:trd-1001:account:acct-funded",
  externalTradeId: "TRD-1001",
  externalFingerprint: "ts_deadbeefdeadbeef",
  enteredAt: "2026-08-12T13:30:00.000Z",
  exitedAt: "2026-08-12T14:15:30.000Z",
  sourceTradeDay: "2026-08-12",
  sourceTimezone: "UTC",
  tradeDuration: "00:45:30"
});

assert.equal(imported.accountId, "acct-funded");
assert.equal(imported.netPnl, -42.75, "brokerPnl must override generic price-model P&L");
assert.equal(imported.result, "Loss", "result must follow brokerPnl, not the calculated Win");
assert.equal(stampCalls, 0, "a Topstep row dated today must not inherit today's event tape");
assert.deepEqual(imported.eventContext, []);
assert.equal(imported.riskAmount, 0);
for (const key of ["rMultiple", "rrRatio", "pips", "pipSize", "pipValuePerLot", "dollarPerPip"]) {
  assert.equal(imported[key], null, `Topstep ${key} is unknown, not calculated`);
}

const reconstructed = buildApi.buildTradeRecord({
  ...reconstructedInput,
  importBatchId: "orders-batch-1"
});
assert.equal(reconstructed.status, "closed");
assert.equal(reconstructed.netPnl, reconstructedInput.estimatedNetPnl);
assert.equal(reconstructed.result, reconstructedInput.estimatedNetPnl > 0 ? "Win" : "Loss");
assert.equal(reconstructed.calculatedGrossPnl, reconstructedInput.calculatedGrossPnl);
assert.equal(reconstructed.estimatedFees, reconstructedInput.estimatedFees);
assert.equal(reconstructed.estimatedCommissions, reconstructedInput.estimatedCommissions);
assert.equal(reconstructed.estimatedCosts, reconstructedInput.estimatedCosts);
assert.equal(reconstructed.estimatedNetPnl, reconstructedInput.estimatedNetPnl);
assert.equal(reconstructed.brokerPnl, null, "Orders must not acquire a broker P&L value");
assert.equal(reconstructed.fees, null, "Orders must not acquire broker-reported fees");
assert.equal(reconstructed.commissions, null, "Orders must not acquire broker-reported commissions");
assert.equal(reconstructed.costs, null, "Orders must keep schedule estimates separate from broker costs");
assert.equal(reconstructed.riskAmount, 0);
for (const key of ["rMultiple", "rrRatio", "pips", "pipSize", "pipValuePerLot", "dollarPerPip"]) {
  assert.equal(reconstructed[key], null, `reconstructed Orders ${key} is unknown`);
}
assert.deepEqual(reconstructed.eventContext, []);
assert.equal(stampCalls, 0, "a reconstructed Orders episode must not inherit today's event tape");
assert.doesNotMatch(JSON.stringify(reconstructed), /SIM-DEMO|SANITIZED-ORDER|SANITIZED-EXCHANGE|SANITIZED-PLATFORM/);

// The journal form only returns editable fields. Broker identity, audit facts,
// and authoritative P&L therefore have to come from existingTrade on edit.
const formOnlyEdit = {
  status: "closed",
  date: today,
  session: "New York",
  market: "Futures",
  asset: "MGC",
  direction: "Buy",
  entryPrice: 2675.1,
  stopLoss: 2670,
  takeProfit: 2685,
  exitPrice: 2682,
  riskPercent: 1,
  positionSize: 2,
  tradeResult: "Auto",
  setupType: "Breakout",
  timeframe: "M5",
  psychology: "Focused",
  executionQuality: "A",
  screenshotName: "",
  screenshotData: "",
  notes: "Edited through the journal form"
};
for (const key of [
  "brokerPnl", "sourceFees", "sourceCommissions", "fees", "commissions", "costs",
  "importSource", "externalSource", "importBatchId", "importKey", "externalTradeId",
  "externalFingerprint", "contractName", "enteredAt", "exitedAt", "sourceTradeDay",
  "sourceTimezone", "tradeDuration"
]) {
  assert.equal(Object.hasOwn(formOnlyEdit, key), false, `${key} must be absent from the simulated form edit`);
}

const edited = buildApi.buildTradeRecord(formOnlyEdit, {
  id: imported.id,
  createdAt: imported.createdAt,
  closedAt: imported.closedAt,
  existingTrade: imported
});
assert.equal(edited.netPnl, -42.75, "editing form fields must not replace Topstep's broker P&L");
assert.equal(edited.result, "Loss", "the edited result must still follow Topstep's broker P&L");
assert.equal(edited.riskAmount, 0);
for (const key of ["rMultiple", "rrRatio", "pips", "pipSize", "pipValuePerLot", "dollarPerPip"]) {
  assert.equal(edited[key], null, `edited Topstep ${key} must remain unknown`);
}
for (const [key, expected] of Object.entries({
  accountId: "acct-funded",
  importBatchId: "batch-1",
  importSource: "topstepx",
  externalSource: "topstepx",
  importKey: "topstepx:id:trd-1001:account:acct-funded",
  externalTradeId: "TRD-1001",
  externalFingerprint: "ts_deadbeefdeadbeef",
  contractName: "MGCZ26",
  enteredAt: "2026-08-12T13:30:00.000Z",
  exitedAt: "2026-08-12T14:15:30.000Z",
  sourceTradeDay: "2026-08-12",
  sourceTimezone: "UTC",
  tradeDuration: "00:45:30",
  brokerPnl: -42.75,
  sourceFees: -4.26,
  sourceCommissions: -2.5,
  fees: 4.26,
  commissions: 2.5,
  costs: 6.76
})) {
  assert.equal(edited[key], expected, `${key} was lost while editing through the journal form`);
}
assert.deepEqual(edited.eventContext, []);
assert.equal(stampCalls, 0, "editing an imported trade must not fabricate event context");

const attemptedReopen = buildApi.buildTradeRecord({ ...formOnlyEdit, status: "open" }, {
  id: imported.id,
  createdAt: imported.createdAt,
  closedAt: imported.closedAt,
  existingTrade: imported
});
assert.equal(attemptedReopen.status, "closed", "a paired Topstep Trades row cannot be changed to in progress");
assert.equal(attemptedReopen.netPnl, -42.75, "an attempted reopen must not remove broker P&L from closed analytics");
assert.equal(attemptedReopen.result, "Loss");
for (const key of ["rMultiple", "rrRatio", "pips", "pipSize", "pipValuePerLot", "dollarPerPip"]) {
  assert.equal(attemptedReopen[key], null, `attempted-reopen Topstep ${key} must remain unknown`);
}

const reconstructedEdit = buildApi.buildTradeRecord({ ...formOnlyEdit, status: "open" }, {
  id: reconstructed.id,
  createdAt: reconstructed.createdAt,
  closedAt: reconstructed.closedAt,
  existingTrade: reconstructed
});
assert.equal(reconstructedEdit.status, "closed", "a reconstructed flat-to-flat episode cannot be reopened");
assert.equal(reconstructedEdit.netPnl, reconstructed.estimatedNetPnl);
assert.equal(reconstructedEdit.result, reconstructed.result);
for (const key of [
  "externalFingerprint", "importKey", "calculatedGrossPnl", "estimatedFees", "estimatedCommissions",
  "estimatedCosts", "estimatedNetPnl", "sourceOrderCount", "entryFillCount", "exitFillCount",
  "reconstructionMethod", "reconstructedDuration", "pnlProvenance", "costProvenance",
  "costScheduleUrl", "costScheduleAsOf"
]) {
  assert.equal(reconstructedEdit[key], reconstructed[key], `Orders ${key} was lost on journal edit`);
}
assert.equal(reconstructedEdit.brokerPnl, null);
assert.equal(reconstructedEdit.fees, null);
assert.equal(reconstructedEdit.commissions, null);
assert.equal(reconstructedEdit.costs, null);

// --- The seam that lost the bracket: parseSelectedBulkTrades end to end ----
// The parser attached the resting stop and target, buildTradeRecord preserved
// them, and the makeup between the two hard zeroed both for every Topstep row.
// Run the REAL parse pipeline on the mid session shape and pin the output.
{
  const midSessionCsv = [
    "Id,AccountName,ContractName,Status,Type,Size,Side,CreatedAt,TradeDay,FilledAt,CancelledAt,TriggeredAt,StopPrice,LimitPrice,ExecutePrice,TriggeredPrice,PositionDisposition,CreationDisposition,RejectionReason,ExchangeOrderId,PlatformOrderId",
    "SANITIZED-LIVE-1,SIM-SANITIZED-001,MGCZ6,Filled,Market,2,Bid,08/17/2026 06:48:35 +08:00,08/17/2026 00:00:00 -05:00,08/17/2026 06:48:35 +08:00,,,,,4436.000000000,,Opening,Trader,,,",
    "SANITIZED-LIVE-TP,SIM-SANITIZED-001,MGCZ6,Open,Limit,2,Ask,08/17/2026 06:48:40 +08:00,08/17/2026 00:00:00 -05:00,,,,,4444.400000000,,,Undetermined,TakeProfit,,,",
    "SANITIZED-LIVE-SL,SIM-SANITIZED-001,MGCZ6,Open,Stop,2,Ask,08/17/2026 06:48:37 +08:00,08/17/2026 00:00:00 -05:00,,,,4430.900000000,,,,Undetermined,StopLoss,,,",
    ""
  ].join("\n");
  uiForParse.bulkSource.value = "topstep";
  uiForParse.bulkInput.value = midSessionCsv;
  const liveParsed = parseSelectedApi.parseSelectedBulkTrades();
  assert.equal(liveParsed.fileKind, "orders");
  assert.deepEqual(liveParsed.errors, [], "a mid session export parses clean end to end");
  assert.equal(liveParsed.trades.length, 1);
  const liveTrade = liveParsed.trades[0];
  assert.equal(liveTrade.status, "open");
  assert.equal(liveTrade.reconstructionMethod, "open-position-v1");
  assert.equal(liveTrade.entryPrice, 4436);
  assert.equal(liveTrade.stopLoss, 4430.9, "the resting stop survives the whole pipeline");
  assert.equal(liveTrade.takeProfit, 4444.4, "the resting target survives the whole pipeline");
  assert.equal(liveTrade.positionSize, 2);
  assert.ok(String(liveTrade.importKey).includes("topstepx-orders:fingerprint:"),
    "an open import carries a stable dedupe key");
  uiForParse.bulkSource.value = "generic";
  uiForParse.bulkInput.value = ordersCsv;
}

// --- An imported OPEN position stays open, with its resting bracket --------
// A mid session Orders export carries a live position: entry at average cost,
// stop and target from the resting bracket. It must land in the journal OPEN
// (the app then watches the price like any command bar trade), even though
// every other Topstep import path forces closed.
const openPosition = buildApi.buildTradeRecord({
  status: "open",
  reconstructionMethod: "open-position-v1",
  market: "Futures",
  asset: "MGC",
  contractName: "MGCZ6",
  direction: "Buy",
  date: today,
  entryPrice: 4436,
  exitPrice: 0,
  positionSize: 2,
  stopLoss: 4430.9,
  takeProfit: 4444.4,
  importSource: "topstepx-orders",
  externalSource: "topstepx-orders",
  externalFingerprint: "tso_openposition1",
  sourceOrderFingerprints: ["tsi_openfill1"],
  calculatedGrossPnl: null,
  tradeResult: "Auto",
  session: "Not recorded",
  setupType: "Not recorded",
  timeframe: "Not recorded",
  psychology: "Not recorded",
  executionQuality: "Not recorded",
  accountId: "acct-funded"
}, {});
assert.equal(openPosition.status, "open", "a mid session open position imports OPEN");
assert.equal(openPosition.closedAt, "", "an open import has no close timestamp");
assert.equal(openPosition.netPnl, 0, "an open import claims no P&L");
assert.equal(openPosition.result, "Open");
assert.equal(openPosition.stopLoss, 4430.9, "the resting stop survives to the journal");
assert.equal(openPosition.takeProfit, 4444.4, "the resting target survives to the journal");
assert.deepEqual(openPosition.sourceOrderFingerprints, ["tsi_openfill1"],
  "the per order fingerprints survive so a later closed import can supersede this row");
// The derived information is DETECTED, not nulled like a closed import: the
// stubbed metrics values must flow straight through to the open record.
assert.equal(openPosition.riskAmount, 100, "risk in dollars is derived from the bracket");
assert.equal(openPosition.rrRatio, 4, "R:R is derived from stop and target");
assert.equal(openPosition.pipSize, 0.25, "the pip scale is the app's own");
assert.equal(openPosition.pipValuePerLot, 5);
assert.equal(openPosition.dollarPerPip, 10);

// The supersede rule exists in the commit path and keys on those fingerprints.
const commitSrc = appSrc;
assert.match(commitSrc, /supersedes the open import/i, "the commit loop documents the supersede rule");
assert.match(commitSrc, /reconstructionMethod === "open-position-v1"/, "the supersede filter targets only open imports");

const loadTradeIntoFormSrc = takeFunction(appSrc, "loadTradeIntoForm");
assert.match(loadTradeIntoFormSrc, /const isTopstep = isTopstepImport\(trade\)/);
assert.match(loadTradeIntoFormSrc, /tradeInProgress\.disabled = isTopstep/);
assert.match(loadTradeIntoFormSrc, /toggleAttribute\("hidden", isTopstep\)/);
assert.match(takeFunction(appSrc, "resetTradeForm"), /tradeInProgress\.disabled = false/);

// The batch guard is independent of the broker-source guard. A historical
// import path that has a batch id but no source still must not inherit now.
const batchOnly = buildApi.buildTradeRecord({
  status: "closed",
  date: today,
  direction: "Buy",
  entryPrice: 100,
  exitPrice: 101,
  positionSize: 1,
  tradeResult: "Auto",
  importBatchId: "legacy-batch"
});
assert.deepEqual(batchOnly.eventContext, []);
assert.equal(stampCalls, 0, "an import batch must suppress event auto-stamping even without a source label");

const manual = buildApi.buildTradeRecord({
  status: "closed",
  date: today,
  direction: "Buy",
  entryPrice: 100,
  exitPrice: 101,
  positionSize: 1,
  tradeResult: "Auto"
});
assert.equal(stampCalls, 1, "the guard must not disable context for a real trade logged today");
assert.equal(manual.eventContext[0].k, "CPI");
assert.equal(manual.netPnl, metrics.netPnl, "manual trades still use calculated P&L");
assert.equal(manual.rMultiple, metrics.rMultiple, "manual R remains calculated");
assert.equal(manual.pips, metrics.pips, "manual pips remain calculated");

// --- 4. Duplicate preview and account reassignment remain truthful --------
const duplicateBundle = [
  takeFunction(appSrc, "isTopstepOrdersImport"),
  takeFunction(appSrc, "genericTradeDuplicateKey"),
  takeFunction(appSrc, "isLikelyDuplicateTrade"),
  takeFunction(appSrc, "markBulkPreviewDuplicates"),
  "return { isLikelyDuplicateTrade, markBulkPreviewDuplicates };"
].join("\n");
const stateForDuplicates = { trades: [] };
// eslint-disable-next-line no-new-func
const duplicateApi = new Function(
  "state", "topstepDuplicateKey", "topstepOrdersDuplicateKey", duplicateBundle
)(stateForDuplicates, topstepDuplicateKey, topstepOrdersDuplicateKey);

const genericRow = {
  date: "2026-08-14", asset: "EURUSD", direction: "Buy",
  entryPrice: 1.1, exitPrice: 1.105, positionSize: 0.5
};
assert.deepEqual(
  duplicateApi.markBulkPreviewDuplicates([genericRow, { ...genericRow }]).map((trade) => trade.previewState),
  ["ready", "duplicate"],
  "generic preview must match the actual sequential-import duplicate result"
);

stateForDuplicates.trades = [reconstructed];
assert.equal(
  duplicateApi.isLikelyDuplicateTrade(reconstructedInput),
  true,
  "Orders dedup must work from the persisted fingerprint after raw order ids are stripped"
);
assert.deepEqual(
  duplicateApi.markBulkPreviewDuplicates([reconstructedInput, { ...reconstructedInput }])
    .map((trade) => trade.previewState),
  ["duplicate", "duplicate"]
);

stateForDuplicates.trades = [{
  importSource: "topstepx",
  externalSource: "topstepx",
  externalTradeId: "TRD-MOVED",
  importKey: "topstepx:id:trd-moved:account:old-account",
  accountId: "new-account"
}];
assert.equal(
  duplicateApi.isLikelyDuplicateTrade({
    importSource: "topstepx",
    externalSource: "topstepx",
    externalTradeId: "TRD-MOVED",
    importKey: "topstepx:id:trd-moved:account:new-account",
    accountId: "new-account"
  }),
  true,
  "dedup must follow the broker trade id after a supported journal-account reassignment"
);

const undoBundle = [takeFunction(appSrc, "getLastImportBatch"), "return { getLastImportBatch };"].join("\n");
const stateForUndo = {
  trades: [{ importBatchId: "demo-sample-journal", createdAt: "2026-08-14T01:00:00Z" }]
};
// eslint-disable-next-line no-new-func
const undoApi = new Function("state", "DEMO_BATCH_ID", undoBundle)(stateForUndo, "demo-sample-journal");
assert.equal(undoApi.getLastImportBatch(), null, "the sample journal is never exposed as an undoable broker import");
stateForUndo.trades.push({ importBatchId: "real-import", createdAt: "2026-08-14T02:00:00Z" });
assert.deepEqual(undoApi.getLastImportBatch(), { id: "real-import", count: 1 });

// --- 5. normalizeTrades preserves the audit whitelist and broker result ----
const normalizeBundle = [
  takeFunction(appSrc, "isTopstepOrdersImport"),
  takeFunction(appSrc, "isTopstepImport"),
  takeFunction(appSrc, "normalizeTrades"),
  "return { normalizeTrades };"
].join("\n");
const normalizeDirection = (value) => {
  const side = String(value || "").trim().toLowerCase();
  return side === "buy" || side === "long" ? "Buy" : side === "sell" || side === "short" ? "Sell" : "";
};
const ensurePositiveNumber = (value, fallback) => Number(value) > 0 ? Number(value) : fallback;
// eslint-disable-next-line no-new-func
const normalizeApi = new Function(
  "normalizeDirection", "ensurePositiveNumber", "ensureNonNegative", "ensureNumber",
  "calculateTradeMetrics", "round", normalizeBundle
)(normalizeDirection, ensurePositiveNumber, ensureNonNegative, ensureNumber, () => ({ ...metrics }), round);

const reloaded = normalizeApi.normalizeTrades([{
  ...imported,
  id: "stored-topstep",
  createdAt: "2026-08-12T14:16:00.000Z",
  updatedAt: "2026-08-12T14:16:00.000Z",
  result: "Win",
  netPnl: 99999,
  eventContext: []
}])[0];

assert.equal(reloaded.netPnl, -42.75, "reload must keep brokerPnl authoritative over stored/calculated values");
assert.equal(reloaded.result, "Loss");
assert.equal(reloaded.status, "closed");
for (const [key, expected] of Object.entries({
  importBatchId: "batch-1",
  importSource: "topstepx",
  externalSource: "topstepx",
  importKey: "topstepx:id:trd-1001:account:acct-funded",
  externalTradeId: "TRD-1001",
  externalFingerprint: "ts_deadbeefdeadbeef",
  contractName: "MGCZ26",
  enteredAt: "2026-08-12T13:30:00.000Z",
  exitedAt: "2026-08-12T14:15:30.000Z",
  sourceTradeDay: "2026-08-12",
  sourceTimezone: "UTC",
  tradeDuration: "00:45:30",
  brokerPnl: -42.75,
  sourceFees: -4.26,
  sourceCommissions: -2.5,
  fees: 4.26,
  commissions: 2.5,
  costs: 6.76,
  accountId: "acct-funded"
})) {
  assert.equal(reloaded[key], expected, `${key} fell out of normalizeTrades' explicit whitelist`);
}
assert.equal(reloaded.riskAmount, 0);
for (const key of ["rMultiple", "rrRatio", "pips", "pipSize", "pipValuePerLot", "dollarPerPip"]) {
  assert.equal(reloaded[key], null, `reloaded Topstep ${key} must remain unknown`);
}

const repairedOpen = normalizeApi.normalizeTrades([{ ...imported, id: "stored-open-topstep", status: "open" }])[0];
assert.equal(repairedOpen.status, "closed", "reload repairs a legacy Topstep row incorrectly saved as open");
assert.equal(repairedOpen.netPnl, -42.75);
assert.equal(repairedOpen.result, "Loss");
assert.equal(repairedOpen.rMultiple, null);
assert.equal(repairedOpen.pips, null);

const reloadedReconstruction = normalizeApi.normalizeTrades([{
  ...reconstructed,
  id: "stored-topstep-orders",
  status: "open",
  netPnl: 99999,
  result: "Loss"
}])[0];
assert.equal(reloadedReconstruction.status, "closed");
assert.equal(reloadedReconstruction.netPnl, reconstructed.estimatedNetPnl);
assert.equal(reloadedReconstruction.result, reconstructed.result);
assert.equal(reloadedReconstruction.brokerPnl, null);
assert.equal(reloadedReconstruction.fees, null);
assert.equal(reloadedReconstruction.commissions, null);
assert.equal(reloadedReconstruction.costs, null);
for (const [key, expected] of Object.entries({
  importSource: "topstepx-orders",
  externalSource: "topstepx-orders",
  externalFingerprint: reconstructed.externalFingerprint,
  importKey: reconstructed.importKey,
  calculatedGrossPnl: reconstructed.calculatedGrossPnl,
  estimatedFees: reconstructed.estimatedFees,
  estimatedCommissions: reconstructed.estimatedCommissions,
  estimatedCosts: reconstructed.estimatedCosts,
  estimatedNetPnl: reconstructed.estimatedNetPnl,
  sourceOrderCount: reconstructed.sourceOrderCount,
  entryFillCount: reconstructed.entryFillCount,
  exitFillCount: reconstructed.exitFillCount,
  reconstructionMethod: "flat-to-flat-v1",
  pnlProvenance: "calculated-from-filled-orders",
  costProvenance: "estimated-topstep-round-turn-schedule",
  costScheduleUrl: ordersCostScheduleUrl,
  costScheduleAsOf: "2026-08-14"
})) {
  assert.equal(reloadedReconstruction[key], expected, `Orders ${key} fell out of normalizeTrades`);
}
for (const key of ["rMultiple", "rrRatio", "pips", "pipSize", "pipValuePerLot", "dollarPerPip"]) {
  assert.equal(reloadedReconstruction[key], null, `reloaded Orders ${key} must remain unknown`);
}
assert.doesNotMatch(JSON.stringify(reloadedReconstruction), /SIM-DEMO|SANITIZED-ORDER|SANITIZED-EXCHANGE|SANITIZED-PLATFORM/);

// --- 6. The dialog gives honest Trades / Orders guidance ------------------
assert.match(dialogHtml, /Trades is preferred/i);
assert.match(dialogHtml, /already pairs entry and exit/i);
assert.match(dialogHtml, /MGC and GC files can be reconstructed as strict flat-to-flat positions/i);
assert.match(dialogHtml, /clearly labelled estimates/i);

console.log(
  "topstepIntegration.check.mjs: OK — Review placement, account scope, broker P&L, audit metadata and unknown metrics pinned"
);
