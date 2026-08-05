// Differential check: the ported sanitizers must produce exactly what
// trade_handler.php produced for the same input.
//
// The expected file is not hand-written — it is the literal output of the PHP
// sanitizers (trade_handler.php lines 1418-2169) run over the input fixture
// while the PHP still existed. The fixture deliberately carries the shapes real
// rows in the live database have: snake_case keys from the original schema,
// numeric strings, missing fields, screenshots, and client-added keys the
// backend never knew about.
//
// If this drifts, existing journals silently change shape on the next save.
import assert from 'node:assert';
import fs from 'node:fs';
import {
  collectTradeScreenshots,
  sanitizeReplayNotes,
  sanitizeSettings,
  sanitizeTradesPayload,
  stripTradeScreenshotsFromTrades,
  toRecentTradeRow,
} from '../api/_lib/sanitize.js';

const here = new URL('./fixtures/', import.meta.url);
const input = JSON.parse(fs.readFileSync(new URL('legacyRows.input.json', here), 'utf8'));
const expected = JSON.parse(fs.readFileSync(new URL('legacyRows.expected.json', here), 'utf8'));

const trades = sanitizeTradesPayload(input.trades);

assert.deepStrictEqual(trades, expected.trades, 'trade payload must match PHP byte for byte');
assert.deepStrictEqual(input.settings.map(sanitizeSettings), expected.settings, 'settings must match PHP');
assert.deepStrictEqual(input.replay.map(sanitizeReplayNotes), expected.replay, 'replay notes must match PHP');
assert.deepStrictEqual(trades.map(toRecentTradeRow), expected.recent, 'recent_trades rows must match PHP');
assert.deepStrictEqual(stripTradeScreenshotsFromTrades(trades), expected.stripped, 'stripped trades must match PHP');
assert.deepStrictEqual(collectTradeScreenshots(trades), expected.collected, 'collected screenshots must match PHP');

// --- The invariants the deep-equal above is protecting -----------------------

// A row written years ago in snake_case reads back in the camelCase the
// front-end expects, with its numeric strings coerced to numbers.
const legacy = trades[0];
assert.strictEqual(legacy.date, '2026-03-04', 'trade_date is honoured as the date');
assert.strictEqual(legacy.asset, 'XAUUSD', 'symbol maps to asset');
assert.strictEqual(legacy.entryPrice, 2400.55, 'numeric strings become numbers');
assert.strictEqual(legacy.netPnl, -123.45, 'profit_loss maps to netPnl and keeps its sign');
assert.strictEqual(legacy.status, 'open', 'in_progress maps to the open status');
assert.strictEqual(legacy.closedAt, '', 'an open trade has no close time');
assert.strictEqual(legacy.screenshotName, 'chart.png', 'screenshot names are trimmed');

// Keys the client invented are preserved — playbook tags and checklist state
// live in the trades JSONB and would be destroyed by a strict whitelist here.
assert.strictEqual(trades[1].playbookTag, 'ORB');
assert.deepStrictEqual(trades[1].checklist, { a: true });
assert.deepStrictEqual(trades[4].extraArray, [1, 2]);
assert.deepStrictEqual(trades[4].extraObj, { k: 'v' });

// Junk never becomes a number, and non-objects are dropped rather than stored.
assert.strictEqual(trades[2].entryPrice, 0, '"not a number" must not coerce');
assert.strictEqual(trades[3].netPnl, 1000, 'exponent notation is numeric, as in PHP');
assert.strictEqual(trades.length, 5, 'the string and null entries are dropped');

// A missing date falls back to the created/closed timestamp's date prefix.
assert.strictEqual(trades[3].date, '2025-11-15', 'unparseable date falls back to created_at');
assert.strictEqual(trades[2].date, '2025-12-31', 'updated_at is the last fallback');

// Settings clamp to their defaults rather than storing a nonsense balance.
const [wild, blank, bad] = input.settings.map(sanitizeSettings);
assert.strictEqual(wild.journalName, 'Chester the Trader with ', 'name collapses whitespace, 24 chars');
assert.strictEqual(wild.startingBalance, 25000);
assert.strictEqual(wild.balanceOverride, 0, 'a negative override falls back to 0');
assert.strictEqual(wild.equityGoal, 15000, 'a zero equity goal falls back to the default');
assert.strictEqual(blank.startingBalance, 10000, 'an empty settings object yields the defaults');
assert.strictEqual(bad.journalName, 'Your');
assert.strictEqual(bad.equityGoal, 15000);

// Screenshots are split out of the trades payload so the JSONB column stays
// small, and merged back on load.
assert.ok(!('screenshotData' in stripTradeScreenshotsFromTrades(trades)[0]), 'screenshots leave the payload');
assert.strictEqual(collectTradeScreenshots(trades).length, 1, 'only trades with a screenshot are stored');

console.log('apiSanitize.check.mjs: all assertions passed');
