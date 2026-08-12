// Auto-close triggers are the money path: a wrong inequality closes trades
// that should ride, or leaves a stopped-out position bleeding as "open".
// openTradeTriggerLevel is pure — every direction/level case is pinned here.
// Run: node tests/autoClose.check.mjs
import assert from "node:assert/strict";
import { openTradeTriggerLevel, normalizeDirection } from "../src/lib/core.js";

const buy = { status: "open", direction: "Buy", stopLoss: 4200, takeProfit: 4300 };
const sell = { status: "open", direction: "Sell", stopLoss: 4244, takeProfit: 4214 };

// Long: stop below entry — price AT or under the stop fills at the stop.
assert.deepEqual(openTradeTriggerLevel(buy, 4200), { level: "stop", fill: 4200 });
assert.deepEqual(openTradeTriggerLevel(buy, 4188.4), { level: "stop", fill: 4200 });
// Long target: price at or above the target fills at the target.
assert.deepEqual(openTradeTriggerLevel(buy, 4300), { level: "target", fill: 4300 });
assert.deepEqual(openTradeTriggerLevel(buy, 4351), { level: "target", fill: 4300 });
// In between: the trade rides.
assert.equal(openTradeTriggerLevel(buy, 4250), null);

// Short: stop above entry, target below.
assert.deepEqual(openTradeTriggerLevel(sell, 4244), { level: "stop", fill: 4244 });
assert.deepEqual(openTradeTriggerLevel(sell, 4260.2), { level: "stop", fill: 4244 });
assert.deepEqual(openTradeTriggerLevel(sell, 4214), { level: "target", fill: 4214 });
assert.deepEqual(openTradeTriggerLevel(sell, 4180), { level: "target", fill: 4214 });
assert.equal(openTradeTriggerLevel(sell, 4230), null);

// No target set: only the stop can fire; a run in the profit direction rides.
const noTp = { ...sell, takeProfit: 0 };
assert.equal(openTradeTriggerLevel(noTp, 4100), null);
assert.deepEqual(openTradeTriggerLevel(noTp, 4250), { level: "stop", fill: 4244 });

// When a price satisfies both checks at once (only possible with a
// misconfigured level pair), the stop wins — pessimistic and honest.
const inverted = { status: "open", direction: "Buy", stopLoss: 4225, takeProfit: 4210 };
assert.deepEqual(openTradeTriggerLevel(inverted, 4205), { level: "stop", fill: 4225 });

// Closed trades, bad prices, and missing input never trigger.
assert.equal(openTradeTriggerLevel({ ...sell, status: "closed" }, 4300), null);
assert.equal(openTradeTriggerLevel(sell, NaN), null);
assert.equal(openTradeTriggerLevel(sell, 0), null);
assert.equal(openTradeTriggerLevel(null, 4300), null);

console.log("autoClose.check.mjs — all trigger cases pinned");

// --- THE BUG THIS FILE MISSED ----------------------------------------------
// The header above claimed "every direction/level case is pinned here" while
// only ever passing the exact strings "Buy" and "Sell". A user reported a trade
// they had marked IN PROGRESS closing itself. Cause: openTradeTriggerLevel
// compared `direction === "Sell"` literally, and nothing enforced the value
// (app.js normalizeTrades did `String(item.direction || "Buy")`, the server
// sanitizer did `str(item.direction ?? 'Buy')`). So a short stored as "SELL",
// "short" or "" read as a LONG, and a short's stop sits ABOVE its entry, which
// made `price <= stop` true on the first poll: an instant stop-out at a price
// that never moved.
{
  // A real short: entry 1.0900, stop above it, target below it.
  const short = { status: "open", direction: "Sell", stopLoss: 1.095, takeProfit: 1.08 };
  const untouched = 1.0901; // barely off entry, nothing should fire

  assert.equal(openTradeTriggerLevel(short, untouched), null, "the canonical short must ride");

  // Every readable spelling must behave exactly like the canonical one.
  for (const spelling of ["Sell", "SELL", "sell", " Sell ", "Short", "short", "SHORT", "s"]) {
    assert.equal(
      openTradeTriggerLevel({ ...short, direction: spelling }, untouched),
      null,
      `a short written "${spelling}" must not stop out at a price that never moved`
    );
    assert.deepEqual(
      openTradeTriggerLevel({ ...short, direction: spelling }, 1.0955),
      { level: "stop", fill: 1.095 },
      `a short written "${spelling}" must still stop out when price really crosses`
    );
  }

  // FAIL CLOSED. A side that cannot be read is never assumed to be long:
  // guessing closes a real position at a price that never traded.
  for (const unreadable of ["", "   ", "1", "0", "n/a", null, undefined, 7, {}]) {
    assert.equal(
      openTradeTriggerLevel({ ...short, direction: unreadable }, untouched),
      null,
      `an unreadable direction (${JSON.stringify(unreadable)}) must never trigger a close`
    );
    assert.equal(
      openTradeTriggerLevel({ ...short, direction: unreadable }, 0.5),
      null,
      "not even at a wildly crossed price: an unreadable side rides until the trader closes it"
    );
  }

  // Long spellings keep long semantics.
  const long = { status: "open", direction: "Buy", stopLoss: 1.085, takeProfit: 1.095 };
  for (const spelling of ["Buy", "BUY", "buy", " Buy ", "Long", "long", "b", "l"]) {
    assert.equal(openTradeTriggerLevel({ ...long, direction: spelling }, 1.0901), null);
    assert.deepEqual(
      openTradeTriggerLevel({ ...long, direction: spelling }, 1.0849),
      { level: "stop", fill: 1.085 },
      `a long written "${spelling}" must stop out below its stop`
    );
  }
}

// --- normalizeDirection is the single reading of a side ---------------------
assert.equal(normalizeDirection("Sell"), "Sell");
assert.equal(normalizeDirection("SHORT"), "Sell");
assert.equal(normalizeDirection(" sell "), "Sell");
assert.equal(normalizeDirection("Buy"), "Buy");
assert.equal(normalizeDirection("long"), "Buy");
assert.equal(normalizeDirection(""), "", "empty is unreadable, not a long");
assert.equal(normalizeDirection("1"), "", "a broker code is unreadable, not a long");
assert.equal(normalizeDirection(null), "");
assert.equal(normalizeDirection(undefined), "");
// "sell" must win inside a compound value: SELL_LIMIT is still a short.
assert.equal(normalizeDirection("SELL_LIMIT"), "Sell");
assert.equal(normalizeDirection("buy stop"), "Buy");
