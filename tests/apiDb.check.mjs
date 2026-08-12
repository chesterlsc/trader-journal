// Headless check for api/_lib/db.js against a fake pg pool.
//
// The point of this one is data safety. The live Railway database holds real
// trading history, so the guarantee that matters is that this module cannot
// change its shape — it issues no DDL at all, and every write is parameterised.
import assert from 'node:assert';
import fs from 'node:fs';
import { createDb, resolveConnectionString, resolveSslOption, sanitizeConnectionString } from '../api/_lib/db.js';

// --- No DDL, anywhere --------------------------------------------------------
// The PHP re-ran ~30 CREATE/ALTER statements on every request. This port runs
// none, so a bug here can never migrate, lock or reshape a populated table.
// Asserted against the source itself, because the claim is about what the file
// *cannot* do, not about what one code path happens to do.
{
  const source = fs.readFileSync(new URL('../api/_lib/db.js', import.meta.url), 'utf8');
  // Strip comments so the prose explaining the rule does not trip the rule.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const forbidden of [
    /\bCREATE\s+TABLE\b/i,
    /\bCREATE\s+INDEX\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bDROP\s+(TABLE|COLUMN|INDEX|DATABASE)\b/i,
    /\bTRUNCATE\b/i,
  ]) {
    assert.ok(!forbidden.test(code), `db.js must contain no DDL, found ${forbidden}`);
  }

  // The one DELETE in the module is the screenshot re-sync inside a save, which
  // is scoped to a single user and matches what the PHP did. Nothing else may
  // delete.
  const deletes = code.match(/DELETE FROM \w+/gi) ?? [];
  assert.deepStrictEqual(deletes, ['DELETE FROM trade_screenshots'], 'only the screenshot re-sync may delete');
}

// --- Fake pool ---------------------------------------------------------------
function makePool(handler) {
  const executed = [];
  return {
    executed,
    async query(text, params) {
      executed.push({ text: String(text).replace(/\s+/g, ' ').trim(), params });
      return handler ? handler(text, params) : { rows: [], rowCount: 0 };
    },
  };
}

// --- Symbol price writes are validated before they reach SQL ------------------
{
  const pool = makePool(() => ({ rows: [], rowCount: 1 }));
  const db = createDb(pool);

  const updated = await db.upsertSymbolPrices([
    { symbol: 'btcusdt', price: '68000.5' },   // lower case and numeric string: accepted
    { symbol: 'XAUUSD', price: 2400 },
    { symbol: 'X', price: 1 },                 // too short
    { symbol: 'HAS SPACE', price: 1 },         // not in the symbol charset
    { symbol: "BAD'; DROP TABLE trades;--", price: 1 },
    { symbol: 'ETHUSDT', price: 0 },           // non-positive
    { symbol: 'ETHUSDT', price: -5 },
    { symbol: 'ETHUSDT', price: 'abc' },
    { symbol: '', price: 5 },
    null,
    'nonsense',
  ]);

  assert.strictEqual(updated, 2, 'only the two valid entries are written');

  const writes = pool.executed.filter((entry) => entry.text.startsWith('INSERT INTO symbol_prices'));
  assert.strictEqual(writes.length, 2);
  assert.deepStrictEqual(writes[0].params, ['BTCUSDT', 68000.5], 'symbols are upper-cased, prices coerced');
  assert.deepStrictEqual(writes[1].params, ['XAUUSD', 2400]);
  // Values are always bound, never interpolated.
  assert.ok(writes.every((entry) => entry.text.includes('$1') && entry.text.includes('$2')));
  assert.ok(!pool.executed.some((entry) => /DROP TABLE/i.test(entry.text)), 'no injected SQL reaches the driver');
}

// --- Session revocation reads the audit trail, not a sessions table -----------
{
  const pool = makePool(() => ({ rows: [{ at: '1754400000' }] }));
  const db = createDb(pool);

  const at = await db.latestSessionInvalidation('  TRADER  ');
  assert.strictEqual(at, 1754400000, 'the epoch comes back as a number');

  const [entry] = pool.executed;
  assert.match(entry.text, /FROM login_info/);
  assert.match(entry.text, /event_type IN \('logout', 'reset'\)/, 'only logout and reset revoke');
  assert.match(entry.text, /success = TRUE/, 'a failed attempt must not revoke anyone');
  assert.deepStrictEqual(entry.params, ['trader'], 'the username is normalised the same way it is stored');
}

{
  // No logout or reset on record: nothing is revoked.
  const db = createDb(makePool(() => ({ rows: [{ at: null }] })));
  assert.strictEqual(await db.latestSessionInvalidation('trader'), null);
}

// --- Reset lookups carry the username, so a reset can be logged and revoke ----
{
  const pool = makePool(() => ({ rows: [{ id: '4', user_id: '9', username: 'trader' }] }));
  const db = createDb(pool);

  const request = await db.findActiveResetRequest('a'.repeat(64));
  assert.strictEqual(request.username, 'trader');

  const [entry] = pool.executed;
  assert.match(entry.text, /used_at IS NULL/, 'a used token must not be reusable');
  assert.match(entry.text, /expires_at > NOW\(\)/, 'an expired token must not be usable');
  assert.deepStrictEqual(entry.params, ['a'.repeat(64)], 'lookups are by token hash, never by token');
}

// --- Connection string handling ----------------------------------------------
assert.strictEqual(sanitizeConnectionString('  postgres://u:p@h:5432/d  '), 'postgres://u:p@h:5432/d');
assert.strictEqual(sanitizeConnectionString('"postgres://u:p@h/d"'), 'postgres://u:p@h/d');
// An unexpanded template or placeholder is a misconfiguration, not a URL.
assert.strictEqual(sanitizeConnectionString('${{ Postgres.DATABASE_URL }}'), '');
assert.strictEqual(sanitizeConnectionString('<paste your url here>'), '');
assert.strictEqual(sanitizeConnectionString(''), '');
assert.strictEqual(sanitizeConnectionString(undefined), '');

assert.strictEqual(resolveConnectionString({ DATABASE_URL: 'postgres://a/b' }), 'postgres://a/b');
assert.strictEqual(
  resolveConnectionString({ DATABASE_URL: '${unset}', POSTGRES_URL: 'postgres://c/d' }),
  'postgres://c/d',
  'a placeholder falls through to the next candidate',
);
assert.strictEqual(resolveConnectionString({}), '');

// TLS: encrypted by default (matching libpq "prefer", which the PHP used), with
// real chain verification available on request.
assert.deepStrictEqual(resolveSslOption('postgres://u:p@h/d', {}), { rejectUnauthorized: false });
assert.strictEqual(resolveSslOption('postgres://u:p@h/d?sslmode=disable', {}), false);
assert.deepStrictEqual(resolveSslOption('postgres://u:p@h/d?sslmode=verify-full', {}), { rejectUnauthorized: true });
assert.strictEqual(resolveSslOption('postgres://u:p@h/d', { PGSSLMODE: 'disable' }), false);

console.log('apiDb.check.mjs: all assertions passed');

// --- THE CACHED PRICE READ MUST BE AGE BOUNDED -----------------------------
// This read backfills any symbol the upstreams could not answer, and the
// live_prices response carries no timestamp, so an unbounded row reaches the
// client looking live and can close an open trade at a level the market never
// reached. The bound is the only thing standing between a months-old row and a
// fabricated fill. idx_symbol_prices_updated_at exists for exactly this.
{
  const sql = fs.readFileSync(new URL("../api/_lib/db.js", import.meta.url), "utf8");
  const fn = sql.slice(sql.indexOf("async loadCachedSymbolPrices"));
  const body = fn.slice(0, fn.indexOf("return result;"));
  assert.match(body, /FROM symbol_prices/, "sanity: found the right function");
  assert.match(
    body,
    /updated_at\s*>\s*NOW\(\)\s*-/i,
    "loadCachedSymbolPrices must exclude rows older than the freshness window"
  );
  assert.ok(
    /maxAgeSeconds/.test(body),
    "the window must be a parameter, not a magic literal buried in the SQL"
  );
}
