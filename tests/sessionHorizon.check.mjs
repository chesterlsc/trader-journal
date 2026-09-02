// The Session Horizon band's math. Fixed instants, real zones — Intl does the
// DST, the assertions pin the states the band would print.
import assert from "node:assert/strict";
import { getSessionStates, formatCountdown } from "../src/lib/sessions.js";

// Wednesday 2026-09-02 05:00 Manila = 2026-09-01 21:00 UTC.
// Sydney (AEST +10): 07:00 Wed — 3h before the 10:00 ASX open → pre? No: the
// pre window is 2h, so 07:00 is CLOSED with 180m to open.
// Tokyo (JST +9): 06:00 Wed — closed, 180m to the 09:00 open.
// London (BST +1): 22:00 Tue — closed.
// New York (EDT -4): 17:00 Tue — closed (NYSE closed 16:00).
{
  const now = new Date(Date.UTC(2026, 8, 1, 21, 0));
  const states = Object.fromEntries(getSessionStates(now).map((s) => [s.key, s]));
  assert.equal(states.sydney.state, "closed");
  assert.equal(states.sydney.countdownMinutes, 180);
  assert.equal(states.sydney.localClock, "07:00");
  assert.equal(states.tokyo.state, "closed");
  assert.equal(states.tokyo.countdownMinutes, 180);
  assert.equal(states.london.state, "closed");
  assert.equal(states.london.localClock, "22:00");
  assert.equal(states.newyork.state, "closed");
  assert.equal(states.newyork.localClock, "17:00");
}

// Wednesday 2026-09-02 01:30 UTC: Sydney 11:30 (OPEN, 4.5h left, 25% elapsed),
// Tokyo 10:30 (OPEN), London 02:30 (closed), New York 21:30 Tue (closed).
{
  const now = new Date(Date.UTC(2026, 8, 2, 1, 30));
  const states = Object.fromEntries(getSessionStates(now).map((s) => [s.key, s]));
  assert.equal(states.sydney.state, "open");
  assert.equal(states.sydney.countdownMinutes, 270);
  assert.ok(Math.abs(states.sydney.elapsedFrac - 0.25) < 1e-9);
  assert.equal(states.tokyo.state, "open");
  assert.equal(states.london.state, "closed");
  assert.equal(states.newyork.state, "closed");
}

// Wednesday 2026-09-02 07:30 UTC: London 08:30 (OPEN), Tokyo 16:30 (closed,
// next open Thursday = 990m), New York 03:30 (closed), Sydney 17:30 (closed).
{
  const now = new Date(Date.UTC(2026, 8, 2, 7, 30));
  const states = Object.fromEntries(getSessionStates(now).map((s) => [s.key, s]));
  assert.equal(states.london.state, "open");
  assert.equal(states.london.label, "closes in");
  assert.equal(states.tokyo.state, "closed");
  assert.equal(states.tokyo.countdownMinutes, 990);
}

// Pre-market: Wednesday 13:00 UTC = New York 09:00 EDT, 30m before the bell.
{
  const now = new Date(Date.UTC(2026, 8, 2, 13, 0));
  const states = Object.fromEntries(getSessionStates(now).map((s) => [s.key, s]));
  assert.equal(states.newyork.state, "pre");
  assert.equal(states.newyork.countdownMinutes, 30);
}

// Weekend roll: Saturday 2026-09-05 01:00 UTC (Sydney 11:00 Sat) → closed, and
// the countdown reaches across the weekend to Monday's open (47h = 2820m).
{
  const now = new Date(Date.UTC(2026, 8, 5, 1, 0));
  const states = Object.fromEntries(getSessionStates(now).map((s) => [s.key, s]));
  assert.equal(states.sydney.state, "closed");
  assert.equal(states.sydney.countdownMinutes, 2820);
}

assert.equal(formatCountdown(180), "3h");
assert.equal(formatCountdown(150), "2h 30m");

console.log("sessionHorizon.check.mjs: all assertions passed");
