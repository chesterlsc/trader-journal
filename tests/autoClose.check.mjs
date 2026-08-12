// Auto-close triggers are the money path: a wrong inequality closes trades
// that should ride, or leaves a stopped-out position bleeding as "open".
// openTradeTriggerLevel is pure — every direction/level case is pinned here.
// Run: node tests/autoClose.check.mjs
import assert from "node:assert/strict";
import { openTradeTriggerLevel, normalizeDirection, priceCanCloseTrade } from "../src/lib/core.js";

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

// --- A STALE PRICE MUST NEVER CLOSE A TRADE --------------------------------
// api/_lib/prices.js backfills any symbol its upstreams could not answer from
// the symbol_prices table, and live_prices returns { ok, prices } with NO
// timestamp, so a frozen price is indistinguishable from a live one on the
// wire. Binance answers 451 from the deploy region, so crypto takes that
// fallback constantly. Meanwhile state.marketData.currentPrices is merge-only
// and never expires, and the landing ticker seeds it from sessionStorage at
// arbitrary age. Net effect before this gate: open the tab after a night, the
// one immediate poll gets rate-limited, an hours-old price arrives looking
// live, and the open trade stops out against a level the market never reached.
{
  const now = 1_700_000_000_000;
  const MAX = 60_000;

  assert.equal(priceCanCloseTrade(now, now, MAX), true, "a price confirmed this instant may close");
  assert.equal(priceCanCloseTrade(now - 5_000, now, MAX), true, "one poll ago is fine");
  assert.equal(priceCanCloseTrade(now - MAX, now, MAX), true, "exactly at the bound still counts");
  assert.equal(priceCanCloseTrade(now - MAX - 1, now, MAX), false, "one ms past the bound does not");
  assert.equal(priceCanCloseTrade(now - 3_600_000, now, MAX), false, "an hour old must never close a trade");

  // Never confirmed at all: a price seeded from sessionStorage for the ticker,
  // or a symbol that dropped out of the response and is merely lingering.
  for (const missing of [undefined, null, NaN, "", "1700000000000"]) {
    assert.equal(priceCanCloseTrade(missing, now, MAX), false, `unconfirmed (${JSON.stringify(missing)}) must not close`);
  }

  // A clock that moved under us is refused rather than trusted.
  assert.equal(priceCanCloseTrade(now + 10_000, now, MAX), false, "a future stamp is not freshness");
  assert.equal(priceCanCloseTrade(now, NaN, MAX), false);
  assert.equal(priceCanCloseTrade(now, now, NaN), false);
}

// --- THE PRICE MUST BE THE MARKET'S, NOT A PAST ONE ------------------------
// Reported twice: "auto close is hitting even if the market didnt hit at the
// first place... use the market logic not the past price."
//
// The cause was measured, not guessed. api.gold-api.com refreshes roughly every
// 30 seconds and STAMPS each quote with updatedAt; the source adapter read
// body.price and discarded that stamp. Polling every 5s therefore turned one
// 30-second-old quote into six "fresh" ticks, and a frozen upstream read as
// live indefinitely. The client then stamped freshness with its own receipt
// time, which measures when we asked rather than when the market traded.
//
// priceCanCloseTrade is unchanged; what changed is the clock handed to it.
{
  const MAX = 60_000;
  const quoteTime = Date.parse("2026-08-12T23:20:39Z");   // the upstream's stamp
  const fetchedAt = Date.parse("2026-08-12T23:21:30Z");   // when we asked, 51s later

  // Judged on the upstream's clock the quote is still usable at 51s...
  assert.equal(priceCanCloseTrade(quoteTime, fetchedAt, MAX), true);
  // ...and stops being usable once IT ages out, regardless of how recently we
  // fetched it. Receipt time would have said "fresh" forever.
  assert.equal(priceCanCloseTrade(quoteTime, quoteTime + MAX + 1, MAX), false);

  // A source that does not stamp its quotes yields no time at all, and unknown
  // must never read as now: it may be displayed, never used to close.
  assert.equal(priceCanCloseTrade(undefined, fetchedAt, MAX), false);
  assert.equal(priceCanCloseTrade(NaN, fetchedAt, MAX), false);
}
