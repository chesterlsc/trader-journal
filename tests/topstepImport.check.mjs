// TopstepX Trades export parser. The broker export is already entry/exit
// paired; these checks pin the importer to that contract and make sure an
// Orders export can never be mistaken for completed journal trades.
//
// Run: node tests/topstepImport.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTopstepCsv, topstepDuplicateKey } from "../src/lib/topstepImport.js";

const tradesFixture = readFileSync(
  new URL("./fixtures/topstep_trades_sanitized.csv", import.meta.url),
  "utf8"
);
const ordersFixture = readFileSync(
  new URL("./fixtures/topstep_orders_sanitized.csv", import.meta.url),
  "utf8"
);

// --- 1. The official TradeExportModel header ------------------------------
// BOM + CRLF exercise the common Windows download without needing a binary
// fixture. The fixture itself also has a quoted comma and quoted newline in
// metadata before the real header.
const parsed = parseTopstepCsv(`\uFEFF${tradesFixture.replace(/\n/g, "\r\n")}`);
assert.equal(parsed.headerRow, 5, "metadata (including a quoted newline) must not become the header");
assert.deepEqual(parsed.errors, []);
assert.equal(parsed.trades.length, 3);

const [gold, nasdaq, es] = parsed.trades;
assert.deepEqual(gold, {
  status: "closed",
  market: "Futures",
  asset: "MGC",
  contractName: "MGCZ26",
  direction: "Buy",
  entryPrice: 2675.1,
  exitPrice: 2681.375,
  positionSize: 2,
  // pnL is the broker-reported P&L. The official model does not say it is
  // gross, so fees must NOT be subtracted from it here.
  brokerPnl: 125.5,
  sourceFees: -4.26,
  sourceCommissions: -2.5,
  fees: 4.26,
  commissions: 2.5,
  costs: 6.76,
  enteredAt: "2026-08-12T13:30:00.000Z",
  exitedAt: "2026-08-12T14:15:30.000Z",
  date: "2026-08-12",
  sourceTradeDay: "2026-08-12",
  sourceTimezone: "UTC",
  tradeDuration: "00:45:30",
  externalSource: "topstepx",
  importSource: "topstepx",
  externalTradeId: "TRD-1001",
  externalFingerprint: gold.externalFingerprint
});
assert.match(gold.externalFingerprint, /^ts_[a-f0-9]{16}$/);
assert.ok(!("reportedNetPnl" in gold), "the parser silently derived a net P&L Topstep does not define");
assert.ok(!("grossPnl" in gold), "broker pnL was relabelled as gross without evidence");

// Type may be the numeric enum (0=Long, 1=Short). Size is normalized positive
// while Type remains the sole direction source.
assert.equal(nasdaq.direction, "Sell");
assert.equal(nasdaq.positionSize, 1);
assert.equal(nasdaq.entryPrice, 23450.25, "quoted thousands separators must parse");
assert.equal(nasdaq.asset, "MNQ");
assert.equal(nasdaq.contractName, "MNQU26", "the raw contract survives the display-symbol cleanup");
assert.equal(nasdaq.brokerPnl, 62.5);
assert.equal(nasdaq.sourceFees, 3.74, "the CSV sign is preserved separately from display magnitude");
assert.equal(nasdaq.sourceCommissions, 0);
assert.equal(nasdaq.fees, 3.74);
assert.equal(nasdaq.commissions, 0, "the optional commissions cell may be empty");
assert.equal(nasdaq.costs, 3.74);
assert.equal(nasdaq.date, "2026-08-13");
assert.equal(nasdaq.enteredAt, "2026-08-13T09:05:00");
assert.equal(nasdaq.sourceTimezone, "", "zone-less export timestamps stay zone-unknown in the parser");

assert.equal(es.direction, "Buy", "text Long remains supported alongside numeric Type");
assert.equal(es.asset, "ES");
assert.equal(es.brokerPnl, -25, "parenthesized broker losses retain their sign");
assert.equal(es.costs, 0);

// --- 2. Header aliases, casing, and all supported delimiters ---------------
const semicolon = [
  "sep=;",
  "TRADE ID;contract;Entered At;Exited At;Average Entry Price;Average Exit Price;Total Fees;P&L;Qty;Trade Type;Trade Date;Total Commissions;Trade Duration",
  "ALIAS-1;NQH27;8/15/2026 9:00 AM;8/15/2026 9:10 AM;25000;24990;-$3.20;$200.00;2;Short;8/15/2026;$1.00;00:10:00"
].join("\n");
const aliasParsed = parseTopstepCsv(semicolon);
assert.equal(aliasParsed.headerRow, 2);
assert.deepEqual(aliasParsed.errors, []);
assert.equal(aliasParsed.trades[0].asset, "NQ");
assert.equal(aliasParsed.trades[0].brokerPnl, 200);
assert.equal(aliasParsed.trades[0].fees, 3.2);
assert.equal(aliasParsed.trades[0].commissions, 1);
assert.equal(aliasParsed.trades[0].costs, 4.2);
assert.equal(aliasParsed.trades[0].tradeDuration, "00:10:00");

const tabHeader = [
  "id", "contractname", "enteredat", "exitedat", "entryprice", "exitprice",
  "fees", "pnl", "size", "type", "tradeday", "tradeduration"
].join("\t");
const tabRow = [
  "TAB-1", "RTYZ26", "2026-08-16T10:00:00-04:00", "2026-08-16T10:05:00-04:00",
  "2250", "2251", "1.20", "5.00", "1", "0", "2026-08-16", "00:05:00"
].join("\t");
const tabParsed = parseTopstepCsv(`metadata\n${tabHeader}\n${tabRow}`);
assert.deepEqual(tabParsed.errors, []);
assert.equal(tabParsed.headerRow, 2);
assert.equal(tabParsed.trades[0].enteredAt, "2026-08-16T14:00:00.000Z");
assert.equal(tabParsed.trades[0].asset, "RTY");

// --- 3. Bad rows are skipped with their physical source row ---------------
const header = "Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type,TradeDay,TradeDuration";
const invalidCsv = [
  header,
  "GOOD,MESZ26,2026-08-17T10:00:00,2026-08-17T10:02:00,6500,6501,1.24,5.00,1,0,2026-08-17,00:02:00",
  ",MESZ26,2026-08-17T10:00:00,2026-08-17T10:02:00,6500,6501,1.24,5.00,1,0,2026-08-17,00:02:00",
  "BAD-TYPE,MESZ26,2026-08-17T10:00:00,2026-08-17T10:02:00,6500,6501,1.24,5.00,1,2,2026-08-17,00:02:00",
  "BAD-NUM,MESZ26,2026-08-17T10:00:00,not-a-time,zero,6501,nope,5.00,0,0,2026-08-17,00:02:00",
  "BAD-PNL,MESZ26,2026-08-17T10:00:00,2026-08-17T10:02:00,6500,6501,1.24,unknown,1,0,2026-08-17,00:02:00",
  "BAD-DAY,MESZ26,2026-08-17T10:00:00,2026-08-17T10:02:00,6500,6501,1.24,5.00,1,0,not-a-date,00:02:00",
  "BAD-DURATION,MESZ26,2026-08-17T10:00:00,2026-08-17T10:02:00,6500,6501,1.24,5.00,1,0,2026-08-17,"
].join("\n");
const invalid = parseTopstepCsv(invalidCsv);
assert.equal(invalid.trades.length, 1);
assert.equal(invalid.trades[0].date, "2026-08-17");
assert.equal(invalid.errors.length, 6);
assert.match(invalid.errors[0], /^Row 3: Id is required\./);
assert.match(invalid.errors[1], /^Row 4: Type must be 0\/1 or Long\/Short\./);
assert.match(invalid.errors[2], /^Row 5: /);
assert.match(invalid.errors[2], /ExitedAt is not a valid timestamp/);
assert.match(invalid.errors[2], /EntryPrice must be a positive number/);
assert.match(invalid.errors[2], /Size must be a non-zero whole number/);
assert.match(invalid.errors[2], /Fees must be a number/);
assert.match(invalid.errors[3], /^Row 6: PnL must be a number\./);
assert.match(invalid.errors[4], /^Row 7: TradeDay must be a valid date\./);
assert.match(invalid.errors[5], /^Row 8: TradeDuration is required\./);

const dateOnlyTimestamp = parseTopstepCsv(
  `${header}\nDATE-ONLY,MESZ26,2026-08-17,2026-08-17T10:02:00,6500,6501,1.24,5.00,1,0,2026-08-17,00:02:00`
);
assert.equal(dateOnlyTimestamp.trades.length, 0);
assert.match(dateOnlyTimestamp.errors[0], /EnteredAt is not a valid timestamp/);

const dottedContract = parseTopstepCsv(
  `${header}\nDOTTED,CON.F.US.MNQ.U26,2026-08-17T10:00:00Z,2026-08-17T10:02:00Z,6500,6501,1.24,5.00,1,0,2026-08-17,00:02:00`
).trades[0];
assert.equal(dottedContract.asset, "MNQ", "a dotted ProjectX contract derives only its display root");
assert.equal(dottedContract.contractName, "CON.F.US.MNQ.U26", "the full broker contract remains auditable");

// --- 4. Orders and incomplete exports are refused before row parsing -------
const orders = parseTopstepCsv(ordersFixture);
assert.equal(orders.headerRow, null);
assert.deepEqual(orders.trades, []);
assert.equal(orders.errors.length, 1);
assert.match(orders.errors[0], /Orders export/);
assert.match(orders.errors[0], /export Trades instead/i);

const incomplete = parseTopstepCsv("Id,ContractName,EnteredAt\n1,MESZ26,2026-08-17T10:00:00");
assert.equal(incomplete.headerRow, null);
assert.match(incomplete.errors[0], /Missing required columns: ExitedAt, EntryPrice, ExitPrice, Fees, PnL, Size, Type, TradeDay, TradeDuration/);

const malformed = parseTopstepCsv(`${header}\n"BROKEN,MESZ26`);
assert.equal(malformed.headerRow, null);
assert.match(malformed.errors[0], /Row 2: CSV contains an unclosed quoted field/);

// --- 5. Stable identity and integration duplicate keys --------------------
const duplicateRows = [header, parsedRow("SAME-ID", 10), parsedRow("SAME-ID", 11)].join("\n");
const duplicateIds = parseTopstepCsv(duplicateRows).trades;
assert.equal(duplicateIds.length, 2);
assert.equal(topstepDuplicateKey(duplicateIds[0]), topstepDuplicateKey(duplicateIds[1]), "Topstep id is authoritative");

const sameTradeDifferentIds = parseTopstepCsv(
  [header, parsedRow("FIRST-ID", 10), parsedRow("SECOND-ID", 10)].join("\n")
).trades;
assert.equal(
  sameTradeDifferentIds[0].externalFingerprint,
  sameTradeDifferentIds[1].externalFingerprint,
  "the economic fingerprint is stable and independent of Topstep's id"
);
assert.notEqual(
  topstepDuplicateKey(sameTradeDifferentIds[0]),
  topstepDuplicateKey(sameTradeDifferentIds[1]),
  "distinct broker ids remain distinct authoritative records"
);

const legacyA = { ...sameTradeDifferentIds[0], externalTradeId: "" };
const legacyB = { ...sameTradeDifferentIds[1], externalTradeId: "" };
assert.equal(topstepDuplicateKey(legacyA), topstepDuplicateKey(legacyB), "fingerprint is the legacy duplicate fallback");
assert.equal(topstepDuplicateKey(null), "");
assert.equal(topstepDuplicateKey({}), "", "a manual journal row is not relabelled as Topstep");
assert.equal(
  topstepDuplicateKey({ externalSource: "vantage", externalTradeId: "SAME-ID" }),
  "",
  "another broker's id is outside this helper's namespace"
);

function parsedRow(id, exitPrice) {
  return `${id},MESZ26,2026-08-18T10:00:00,2026-08-18T10:02:00,9,${exitPrice},1.00,5.00,1,0,2026-08-18,00:02:00`;
}

console.log(
  "topstepImport.check.mjs: OK — official Trades schema, dialects, row errors, Orders rejection and duplicate identity pinned"
);
