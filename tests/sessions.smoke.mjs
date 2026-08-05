// Headless check for src/lib/sessions.js — the dashboard greeting countdown.
// Fixed instants, so it fails if the zone maths, the DST handling or the
// weekend roll-forward ever break.
import assert from "node:assert";
import { getNextSessionOpen, formatCountdown, zoneNow } from "../src/lib/sessions.js";

// 2026-08-05 is a Wednesday. 06:18 UTC = 07:18 London (BST, UTC+1), so the
// 08:00 London open is 42 minutes out — the mockup's exact case.
const wed = new Date("2026-08-05T06:18:00Z");
assert.deepStrictEqual(getNextSessionOpen(wed), { name: "London", minutes: 42 });

// Winter: London is UTC+0, so the same wall-clock gap needs a different UTC
// instant. If the offset were hard-coded this would come out an hour wrong.
const jan = new Date("2026-01-07T07:18:00Z");
assert.deepStrictEqual(getNextSessionOpen(jan), { name: "London", minutes: 42 });

// Tokyo opens 09:00 JST = 00:00 UTC. At 23:30 UTC Wednesday that is 30m out.
assert.deepStrictEqual(getNextSessionOpen(new Date("2026-08-05T23:30:00Z")), {
  name: "Asia",
  minutes: 30
});

// Saturday must roll forward, never report a weekend open.
const sat = new Date("2026-08-08T12:00:00Z");
const weekend = getNextSessionOpen(sat);
assert.ok(weekend.minutes > 1440, `weekend open must skip a day, got ${weekend.minutes}m`);
assert.strictEqual(zoneNow("Asia/Tokyo", sat).weekday, 6, "Tokyo is still Saturday at 12:00 UTC");

// New York 09:30 ET is the only half-hour open; it must survive the maths.
const nyEve = new Date("2026-08-05T13:00:00Z"); // 09:00 ET
assert.deepStrictEqual(getNextSessionOpen(nyEve), { name: "New York", minutes: 30 });

assert.strictEqual(formatCountdown(42), "42m");
assert.strictEqual(formatCountdown(60), "1h");
assert.strictEqual(formatCountdown(195), "3h 15m");
assert.strictEqual(formatCountdown(0), "0m");

console.log("OK — session countdown, DST, weekend roll-forward, formatting");
