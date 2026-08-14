// Strict TopstepX Orders reconstruction contract.
//
// Run: node tests/topstepOrdersImport.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  detectTopstepExport,
  parseTopstepOrdersCsv,
  topstepOrdersDuplicateKey
} from "../src/lib/topstepOrdersImport.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const fixture = readFileSync(`${ROOT}/tests/fixtures/topstep_orders_reconstruction_sanitized.csv`, "utf8");
const ORDER_HEADERS = [
  "Id", "AccountName", "ContractName", "Status", "Type", "Size", "Side", "CreatedAt", "TradeDay", "FilledAt",
  "CancelledAt", "TriggeredAt", "StopPrice", "LimitPrice", "ExecutePrice", "TriggeredPrice", "PositionDisposition",
  "CreationDisposition", "RejectionReason", "ExchangeOrderId", "PlatformOrderId"
];

const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const makeCsv = (rows, { headers = ORDER_HEADERS, bom = true, prefix = "" } = {}) =>
  `${bom ? "\uFEFF" : ""}${prefix}${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((cells) => cells.map(quote).join(","))
    .join("\r\n")}\r\n`;

function order(overrides = {}) {
  return {
    Id: "SANITIZED-ORDER-1",
    AccountName: "SIM-SANITIZED-001",
    ContractName: "MGCZ6",
    Status: "Filled",
    Type: "Market",
    Size: "1",
    Side: "Bid",
    CreatedAt: "08/13/2026 09:00:00 +08:00",
    TradeDay: "08/13/2026 00:00:00 -05:00",
    FilledAt: "08/13/2026 09:00:00 +08:00",
    CancelledAt: "",
    TriggeredAt: "",
    StopPrice: "",
    LimitPrice: "",
    ExecutePrice: "2000.000000000",
    TriggeredPrice: "",
    PositionDisposition: "Opening",
    CreationDisposition: "Trader",
    RejectionReason: "",
    ExchangeOrderId: "SANITIZED-EXCHANGE-1",
    PlatformOrderId: "SANITIZED-PLATFORM-1",
    ...overrides
  };
}

function pair({ contractName = "MGCZ6", size = "1", entry = "2000", exit = "2001", accountName = "SIM-SANITIZED-001" } = {}) {
  return [
    order({
      Id: "SANITIZED-OPEN",
      AccountName: accountName,
      ContractName: contractName,
      Size: size,
      ExecutePrice: entry,
      ExchangeOrderId: "SANITIZED-EXCHANGE-OPEN",
      PlatformOrderId: "SANITIZED-PLATFORM-OPEN"
    }),
    order({
      Id: "SANITIZED-CLOSE",
      AccountName: accountName,
      ContractName: contractName,
      Size: size,
      Side: "Ask",
      CreatedAt: "08/13/2026 09:05:00 +08:00",
      FilledAt: "08/13/2026 09:05:00 +08:00",
      ExecutePrice: exit,
      PositionDisposition: "Closing",
      CreationDisposition: "ClosePosition",
      ExchangeOrderId: "SANITIZED-EXCHANGE-CLOSE",
      PlatformOrderId: "SANITIZED-PLATFORM-CLOSE"
    })
  ];
}

function expectFailure(rows, pattern, label) {
  const parsed = parseTopstepOrdersCsv(makeCsv(rows));
  assert.equal(parsed.trades.length, 0, `${label}: malformed inventory must fail closed`);
  assert.match(parsed.errors.join("\n"), pattern, label);
}

// --- 1. Strong file-kind detection ----------------------------------------
assert.deepEqual(detectTopstepExport(fixture), { kind: "orders", headerRow: 1 });

const tradesHeader = [
  "Id", "ContractName", "EnteredAt", "ExitedAt", "EntryPrice", "ExitPrice", "Fees", "PnL", "Size", "Type",
  "TradeDay", "TradeDuration"
].map(quote).join(",");
assert.deepEqual(detectTopstepExport(`${tradesHeader}\n`), { kind: "trades", headerRow: 1 });
assert.deepEqual(
  detectTopstepExport("Id,Status,Side,CreatedAt,Price\n1,Filled,Bid,2026-08-13,100\n"),
  { kind: "unknown", headerRow: null },
  "common generic headers must not create a false Topstep Orders match"
);

const missingCurrentColumn = ORDER_HEADERS.filter((header) => header !== "PlatformOrderId");
assert.deepEqual(detectTopstepExport(makeCsv([], { headers: missingCurrentColumn })), { kind: "unknown", headerRow: null });
assert.match(
  parseTopstepOrdersCsv(makeCsv([], { headers: missingCurrentColumn })).errors[0],
  /exact 21-column TopstepX Orders header/
);

// Header detection survives metadata and physical newlines in quoted cells.
const multilineAccount = "SIM, SANITIZED\nDESK";
const quotedMultiline = makeCsv(pair({ accountName: multilineAccount }), {
  prefix: `${quote("TopstepX Orders report")},${quote("sanitized fixture")}\r\n`
});
assert.deepEqual(detectTopstepExport(quotedMultiline), { kind: "orders", headerRow: 2 });
const multilineParsed = parseTopstepOrdersCsv(quotedMultiline);
assert.equal(multilineParsed.errors.length, 0);
assert.equal(multilineParsed.trades[0].sourceAccountName, multilineAccount);

// --- 2. The sanitized real-file shape reconstructs 14 episodes ------------
assert.equal((fixture.match(/,"Filled",/g) || []).length, 67);
assert.equal((fixture.match(/,"Cancelled",/g) || []).length, 18);
const parsed = parseTopstepOrdersCsv(fixture);
assert.deepEqual(parsed.errors, []);
assert.equal(parsed.headerRow, 1);
assert.equal(parsed.trades.length, 14);
assert.equal(parsed.trades.reduce((sum, trade) => sum + trade.sourceOrderIds.length, 0), 67);
assert.equal(parsed.trades.reduce((sum, trade) => sum + trade.roundTurnQuantity, 0), 61);
assert.ok(parsed.trades.every((trade) => trade.positionSize === trade.peakPositionSize));
// This line used to assert that SOME episode in the fixture had more round
// turns than peak position. It cannot: every one of the 14 episodes here opens
// fully and then closes, never re-entering after a partial exit, so opening
// contracts, closing contracts and peak position are equal episode by episode.
// The assertion was also unsatisfiable ALONGSIDE its neighbours. Round turns
// can never be fewer than the peak (you cannot hold 9 contracts having bought
// fewer than 9), the line above pins the total at 61, and the fixture's peaks
// also total 61. Non negative differences summing to zero are all zero, so
// every episode must have round turns EQUAL to its peak, which the previous
// line then restates. Making it pass would have meant reporting fewer round
// turns than contracts opened, and round turns are what the cost schedule bills
// on, so the "fix" would have mispriced fees.
// Pin the real per episode vector instead. It is strictly stronger than the sum.
assert.deepEqual(
  parsed.trades.map((trade) => trade.roundTurnQuantity),
  [2, 2, 5, 3, 9, 6, 4, 6, 6, 2, 5, 2, 5, 4]
);

// Re entry after a partial exit is the one shape where round turns DO exceed
// the peak, and the fixture has none of it. Build the minimal case so the
// behaviour the line above was reaching for is still covered:
// open 2, close 1, open 1, close 2. Peak is 2, round turns are 3.
const reEntry = parseTopstepOrdersCsv(
  makeCsv([
    order({ Id: "SANITIZED-RE-1", Size: "2" }),
    order({
      Id: "SANITIZED-RE-2",
      Size: "1",
      Side: "Ask",
      PositionDisposition: "Closing",
      CreationDisposition: "ClosePosition",
      CreatedAt: "08/13/2026 09:01:00 +08:00",
      FilledAt: "08/13/2026 09:01:00 +08:00",
    }),
    order({
      Id: "SANITIZED-RE-3",
      Size: "1",
      CreatedAt: "08/13/2026 09:02:00 +08:00",
      FilledAt: "08/13/2026 09:02:00 +08:00",
    }),
    order({
      Id: "SANITIZED-RE-4",
      Size: "2",
      Side: "Ask",
      PositionDisposition: "Closing",
      CreationDisposition: "ClosePosition",
      CreatedAt: "08/13/2026 09:03:00 +08:00",
      FilledAt: "08/13/2026 09:03:00 +08:00",
    }),
  ])
).trades[0];
assert.deepEqual(
  {
    roundTurnQuantity: reEntry.roundTurnQuantity,
    positionSize: reEntry.positionSize,
    peakPositionSize: reEntry.peakPositionSize,
    entryFillCount: reEntry.entryFillCount,
    exitFillCount: reEntry.exitFillCount,
  },
  { roundTurnQuantity: 3, positionSize: 2, peakPositionSize: 2, entryFillCount: 2, exitFillCount: 2 }
);
assert.ok(
  reEntry.roundTurnQuantity > reEntry.positionSize,
  "round turns exceed peak position when a position is re entered after a partial exit"
);
assert.deepEqual(parsed.trades.map((trade) => trade.entryFillCount), [1, 2, 5, 1, 9, 6, 2, 3, 4, 1, 3, 1, 4, 4]);
assert.deepEqual(parsed.trades.map((trade) => trade.exitFillCount), [1, 1, 4, 2, 2, 2, 1, 2, 1, 1, 1, 1, 1, 1]);

const first = parsed.trades[0];
assert.deepEqual(
  {
    status: first.status,
    market: first.market,
    asset: first.asset,
    contractName: first.contractName,
    direction: first.direction,
    entryPrice: first.entryPrice,
    exitPrice: first.exitPrice,
    positionSize: first.positionSize,
    date: first.date,
    enteredAt: first.enteredAt,
    exitedAt: first.exitedAt,
    sourceTimezone: first.sourceTimezone,
    sourceTradeDay: first.sourceTradeDay,
    sourceTradeDayTimezone: first.sourceTradeDayTimezone,
    importSource: first.importSource,
    externalSource: first.externalSource,
    pnlBasis: first.pnlBasis,
    contractMultiplier: first.contractMultiplier,
    calculatedGrossPnl: first.calculatedGrossPnl
  },
  {
    status: "closed",
    market: "Futures",
    asset: "MGC",
    contractName: "MGCZ6",
    direction: "Buy",
    entryPrice: 2000,
    exitPrice: 2002,
    positionSize: 2,
    date: "2026-08-13",
    enteredAt: "2026-08-13T01:00:00.000Z",
    exitedAt: "2026-08-13T01:02:00.000Z",
    sourceTimezone: "UTC+08:00",
    sourceTradeDay: "2026-08-13",
    sourceTradeDayTimezone: "UTC-05:00",
    importSource: "topstepx-orders",
    externalSource: "topstepx-orders",
    pnlBasis: "calculated-gross",
    contractMultiplier: 10,
    calculatedGrossPnl: 40
  }
);
assert.equal(first.sourceAccountName, "SIM-DEMO-001");
assert.match(first.sourceAccountFingerprint, /^tsa_[0-9a-f]{16}$/);
assert.equal(first.sourceOrderIds.length, 2);
assert.equal(first.sourceOrderFingerprints.length, 2);
assert.ok(first.sourceOrderFingerprints.every((value) => /^tsi_[0-9a-f]{16}$/.test(value)));
assert.match(first.externalFingerprint, /^tso_[0-9a-f]{16}$/);
assert.doesNotMatch(first.externalFingerprint, /DEMO|ORDER/i, "raw ids belong only in source metadata");

for (const key of [
  "session", "setupType", "timeframe", "psychology", "executionQuality", "stopLoss", "takeProfit", "riskPercent",
  "tradeResult", "screenshotName", "screenshotData", "notes", "preTradeRules", "preTradeRulesAsked", "eventContext"
]) {
  assert.ok(Object.hasOwn(first, key), `${key} is missing from the journal basics`);
}
for (const trade of parsed.trades) {
  for (const unsupportedClaim of ["brokerPnl", "reportedNetPnl", "netPnl", "fees", "commissions", "costs"]) {
    assert.equal(Object.hasOwn(trade, unsupportedClaim), false, `${unsupportedClaim} must not be invented from Orders`);
  }
  assert.equal(trade.pnlBasis, "calculated-gross");
  assert.equal(topstepOrdersDuplicateKey(trade), `topstepx-orders:fingerprint:${trade.externalFingerprint}`);
}
assert.equal(new Set(parsed.trades.map((trade) => trade.externalFingerprint)).size, 14);

// Scale-in VWAP and short-side gross calculation are exact: 1 @ 2001 plus
// 1 @ 1999, then 2 out @ 1995 = (2000 - 1995) * 2 * $10 = $100 gross.
const scaledShort = parsed.trades[1];
assert.equal(scaledShort.direction, "Sell");
assert.equal(scaledShort.entryPrice, 2000);
assert.equal(scaledShort.exitPrice, 1995);
assert.equal(scaledShort.positionSize, 2);
assert.equal(scaledShort.calculatedGrossPnl, 100);

// Row order in an export does not affect chronology, VWAP, or duplicate ids.
const fixtureLines = fixture.trimEnd().split(/\r?\n/);
const reordered = `${fixtureLines[0]}\n${fixtureLines.slice(1).reverse().join("\n")}\n`;
const reparsed = parseTopstepOrdersCsv(reordered);
assert.deepEqual(reparsed.errors, []);
assert.deepEqual(
  reparsed.trades.map((trade) => trade.externalFingerprint),
  parsed.trades.map((trade) => trade.externalFingerprint)
);
assert.deepEqual(
  reparsed.trades.map((trade) => [trade.entryPrice, trade.exitPrice, trade.calculatedGrossPnl]),
  parsed.trades.map((trade) => [trade.entryPrice, trade.exitPrice, trade.calculatedGrossPnl])
);

// GC is $100/point; unsupported roots remain explicitly uncalculated.
const gc = parseTopstepOrdersCsv(makeCsv(pair({ contractName: "GCZ6" }))).trades[0];
assert.equal(gc.asset, "GC");
assert.equal(gc.contractMultiplier, 100);
assert.equal(gc.calculatedGrossPnl, 100);
assert.equal(gc.pnlBasis, "calculated-gross");

const mnq = parseTopstepOrdersCsv(makeCsv(pair({ contractName: "MNQZ6" }))).trades[0];
assert.equal(mnq.asset, "MNQ");
assert.equal(mnq.contractMultiplier, null);
assert.equal(mnq.calculatedGrossPnl, null);
assert.equal(mnq.pnlBasis, "not-calculated");

// Cancelled lifecycle records never enter inventory or source-order metadata.
const withIgnoredCancellation = parseTopstepOrdersCsv(makeCsv([
  pair()[0],
  order({
    Id: "SANITIZED-CANCEL",
    Status: "Cancelled",
    AccountName: "",
    ContractName: "",
    Size: "",
    Side: "",
    FilledAt: "",
    ExecutePrice: ""
  }),
  pair()[1]
]));
assert.deepEqual(withIgnoredCancellation.errors, []);
assert.equal(withIgnoredCancellation.trades.length, 1);
assert.deepEqual(withIgnoredCancellation.trades[0].sourceOrderIds, ["SANITIZED-OPEN", "SANITIZED-CLOSE"]);

// Inventory is independent per source account and contract even when fills
// are interleaved in the file.
const secondAccountPair = pair({ contractName: "GCZ6", accountName: "SIM-SANITIZED-002" }).map((row, index) => ({
  ...row,
  Id: `SANITIZED-SECOND-${index + 1}`,
  CreatedAt: `08/13/2026 09:0${index + 1}:00 +08:00`,
  FilledAt: `08/13/2026 09:0${index + 1}:00 +08:00`
}));
const grouped = parseTopstepOrdersCsv(makeCsv([pair()[0], ...secondAccountPair, pair()[1]]));
assert.equal(grouped.trades.length, 0);
assert.match(grouped.errors.join("\n"), /more than one Topstep account.*Export one account at a time/i);

// --- 3. Every ambiguous inventory boundary fails closed -------------------
expectFailure(
  [order({ ExecutePrice: "" }), pair()[1]],
  /Row 2: .*ExecutePrice must be a positive number/,
  "missing execution price"
);
expectFailure(
  [order({ AccountName: "" }), pair()[1]],
  /Row 2: .*AccountName is required/,
  "missing grouping field"
);
expectFailure(
  [order({ Size: "0" }), pair()[1]],
  /Row 2: .*Size must be a positive whole number/,
  "invalid fill size"
);
expectFailure(
  [order({ PositionDisposition: "Undetermined" }), pair()[1]],
  /Row 2: .*PositionDisposition must be Opening or Closing/,
  "missing inventory disposition"
);
expectFailure(
  [order({ Status: "Cancelled" })],
  /Row 2: non-Filled order contains execution data and may be partially filled/,
  "non-Filled row with execution evidence"
);
expectFailure(
  [order({ CreationDisposition: "ReversePosition" }), pair()[1]],
  /Row 2: .*ReversePosition orders are not supported/,
  "explicit reverse-position order"
);
expectFailure(
  [order({ FilledAt: "08\/13\/2026 09:00:00" }), pair()[1]],
  /Row 2: .*FilledAt must be an explicit timestamp/,
  "timestamp without source offset"
);
expectFailure(
  [order({ TradeDay: "08\/13\/2026 00:00:00" }), pair()[1]],
  /Row 2: .*TradeDay must be a valid date with an explicit UTC offset/,
  "TradeDay without source offset"
);
expectFailure(
  [
    pair()[0],
    order({
      Id: "SANITIZED-WRONG-OPEN",
      Side: "Ask",
      CreatedAt: "08/13/2026 09:01:00 +08:00",
      FilledAt: "08/13/2026 09:01:00 +08:00"
    })
  ],
  /Row 3: Opening fill is on the wrong side and would reverse/,
  "wrong-side opening reversal"
);
expectFailure(
  [pair()[0], order({
    Id: "SANITIZED-WRONG-CLOSE",
    Side: "Bid",
    CreatedAt: "08/13/2026 09:05:00 +08:00",
    FilledAt: "08/13/2026 09:05:00 +08:00",
    PositionDisposition: "Closing"
  })],
  /Row 3: Closing fill is on the wrong side/,
  "wrong-side close"
);
expectFailure(
  [pair()[0], order({
    Id: "SANITIZED-OVERCLOSE",
    Side: "Ask",
    Size: "2",
    CreatedAt: "08/13/2026 09:05:00 +08:00",
    FilledAt: "08/13/2026 09:05:00 +08:00",
    PositionDisposition: "Closing"
  })],
  /Row 3: Closing fill would over-close and reverse/,
  "over-close reversal"
);
expectFailure(
  [pair()[0], {
    ...pair()[1],
    CreatedAt: pair()[0].CreatedAt,
    FilledAt: pair()[0].FilledAt
  }],
  /Row 2: fills with different sides or position dispositions share a timestamp, so execution order is ambiguous/,
  "same-timestamp opposite-side fills"
);
expectFailure(
  [
    order({ Id: "SANITIZED-OPEN-A", Size: "2" }),
    order({
      Id: "SANITIZED-CLOSE-A",
      Size: "1",
      Side: "Ask",
      PositionDisposition: "Closing",
      CreatedAt: "08/13/2026 09:01:00 +08:00",
      FilledAt: "08/13/2026 09:01:00 +08:00"
    }),
    order({
      Id: "SANITIZED-OPEN-B",
      Side: "Bid",
      PositionDisposition: "Opening",
      CreatedAt: "08/13/2026 09:01:00 +08:00",
      FilledAt: "08/13/2026 09:01:00 +08:00"
    })
  ],
  /different sides or position dispositions share a timestamp/,
  "same-time close and scale-in"
);
expectFailure(
  [order({ Size: "1,2" }), pair()[1]],
  /Row 2: .*Size must be a positive whole number/,
  "malformed numeric grouping"
);
expectFailure(
  [order({ Side: "Ask", PositionDisposition: "Closing" })],
  /Row 2: Closing fill cannot be applied because the position is flat/,
  "close while flat"
);
expectFailure(
  [pair()[0]],
  /Row 2: incomplete position remains open/,
  "incomplete date range"
);
expectFailure(
  [pair()[0], { ...pair()[1], Id: "SANITIZED-OPEN" }],
  /Row 3: Id duplicates another Filled order/,
  "duplicate execution id"
);

assert.equal(topstepOrdersDuplicateKey({ importSource: "topstepx", externalFingerprint: first.externalFingerprint }), "");
const noStoredFingerprint = { ...first };
delete noStoredFingerprint.externalFingerprint;
assert.equal(
  topstepOrdersDuplicateKey(noStoredFingerprint),
  `topstepx-orders:fingerprint:${first.externalFingerprint}`,
  "the contributing order ids provide the stable dedupe fallback"
);

const privacyOnlyFingerprint = { ...first };
delete privacyOnlyFingerprint.externalFingerprint;
delete privacyOnlyFingerprint.sourceAccountName;
delete privacyOnlyFingerprint.sourceOrderIds;
assert.match(
  topstepOrdersDuplicateKey(privacyOnlyFingerprint),
  /^topstepx-orders:fingerprint:tso_[0-9a-f]{16}$/,
  "hashed account and order provenance remains usable without raw identifiers"
);

console.log(
  "topstepOrdersImport.check.mjs: OK — strict 21-column detection, 14 flat-to-flat episodes, VWAP, gross basis and rejection guards pinned"
);
