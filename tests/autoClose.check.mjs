// Auto-close triggers are the money path: a wrong inequality closes trades
// that should ride, or leaves a stopped-out position bleeding as "open".
// openTradeTriggerLevel is pure — every direction/level case is pinned here.
// Run: node tests/autoClose.check.mjs
import assert from "node:assert/strict";
import { openTradeTriggerLevel } from "../src/lib/core.js";

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
