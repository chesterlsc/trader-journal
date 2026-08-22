// WHO CLOSED THE TRADE: the stop, the target, or the trader's own hand.
//
// Topstep stamps every filled order with a CreationDisposition (StopLoss,
// TakeProfit, Trader). On a CLOSING fill that is the only surviving record of
// whether the plan closed the position or the trader reached in and did it
// manually, and it is the one discipline question a fill log can answer that
// a hand written journal cannot answer honestly, because nobody writes down
// "I bailed early" at the time.
//
// The importer read this column for resting brackets on open positions and
// discarded it everywhere else. These checks pin it back on.
import assert from "node:assert/strict";
import { parseTopstepOrdersCsv } from "../src/lib/topstepOrdersImport.js";

const HEAD = "Id,AccountName,ContractName,Status,Type,Size,Side,CreatedAt,TradeDay,FilledAt,CancelledAt,TriggeredAt,StopPrice,LimitPrice,ExecutePrice,TriggeredPrice,PositionDisposition,CreationDisposition,RejectionReason,ExchangeOrderId,PlatformOrderId";

let seq = 0;
function row({ size, side, at, price, disposition, creation, type = "Market" }) {
  seq += 1;
  const stamp = `08/17/2026 ${at} +00:00`;
  return [
    `90000${seq}`, "ACC-1", "MGCZ6", "Filled", type, size, side,
    stamp, "08/17/2026 00:00:00 -05:00", stamp, "", "", "", "",
    price, "", disposition, creation, "", "", ""
  ].join(",");
}

function parseOne(rows) {
  const result = parseTopstepOrdersCsv([HEAD, ...rows].join("\n"));
  assert.equal(result.errors.length, 0, `unexpected parse errors: ${result.errors.join(" | ")}`);
  assert.equal(result.trades.length, 1, `expected exactly one reconstructed episode, got ${result.trades.length}`);
  return result.trades[0];
}

// A stop did it.
assert.equal(parseOne([
  row({ size: 1, side: "Bid", at: "06:00:00", price: "4400", disposition: "Opening", creation: "Trader" }),
  row({ size: 1, side: "Ask", at: "07:00:00", price: "4380", disposition: "Closing", creation: "StopLoss", type: "Stop" })
]).exitKind, "stop");

// The target did it.
assert.equal(parseOne([
  row({ size: 1, side: "Bid", at: "06:00:00", price: "4400", disposition: "Opening", creation: "Trader" }),
  row({ size: 1, side: "Ask", at: "07:00:00", price: "4460", disposition: "Closing", creation: "TakeProfit", type: "Limit" })
]).exitKind, "target");

// The trader did it, by hand.
assert.equal(parseOne([
  row({ size: 1, side: "Bid", at: "06:00:00", price: "4400", disposition: "Opening", creation: "Trader" }),
  row({ size: 1, side: "Ask", at: "07:00:00", price: "4410", disposition: "Closing", creation: "Trader" })
]).exitKind, "manual");

// WEIGHTED BY CONTRACTS, not by fill count: a 3 lot stop is not outvoted by a
// 1 lot manual scratch, which is exactly what a fill-count majority would do.
assert.equal(parseOne([
  row({ size: 4, side: "Bid", at: "06:00:00", price: "4400", disposition: "Opening", creation: "Trader" }),
  row({ size: 1, side: "Ask", at: "07:00:00", price: "4405", disposition: "Closing", creation: "Trader" }),
  row({ size: 3, side: "Ask", at: "07:30:00", price: "4380", disposition: "Closing", creation: "StopLoss", type: "Stop" })
]).exitKind, "stop");

// A genuine split says so rather than picking a winner: half out at the
// target and half stopped really did happen both ways.
assert.equal(parseOne([
  row({ size: 2, side: "Bid", at: "06:00:00", price: "4400", disposition: "Opening", creation: "Trader" }),
  row({ size: 1, side: "Ask", at: "07:00:00", price: "4460", disposition: "Closing", creation: "TakeProfit", type: "Limit" }),
  row({ size: 1, side: "Ask", at: "07:30:00", price: "4380", disposition: "Closing", creation: "StopLoss", type: "Stop" })
]).exitKind, "mixed");

// An export without the column cannot be guessed at, and says so.
const noColumn = parseTopstepOrdersCsv([
  HEAD,
  row({ size: 1, side: "Bid", at: "06:00:00", price: "4400", disposition: "Opening", creation: "" }),
  row({ size: 1, side: "Ask", at: "07:00:00", price: "4410", disposition: "Closing", creation: "" })
].join("\n"));
assert.equal(noColumn.trades[0].exitKind, "unknown");

console.log("topstepExitKind.check.mjs: OK — stop, target, manual, size weighted, mixed and unknown all pinned");
