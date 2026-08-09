// Headless check for the ported API router — api/_lib/router.js.
//
// Runs the real router against a hand-written fake database, so every security
// control the PHP had (CSRF on state-changing POSTs, the DB-backed rate limit,
// the public feed whitelist, auth and admin gating) is exercised with no
// Postgres, no network and no credentials anywhere.
import assert from 'node:assert';
import { ACTION_NAMES, Respond, route } from '../api/_lib/router.js';
import { encodeSession, newCsrfToken } from '../api/_lib/session.js';

const SECRET = 'test-secret-not-a-real-key';

// --- Fake database ----------------------------------------------------------
// Only what the router calls. Every method records its arguments so the tests
// can assert on *how* it was called, not just what came back.
function makeDb(overrides = {}) {
  const calls = [];
  const record = (name, args, result) => {
    calls.push({ name, args });
    return result;
  };

  const base = {
    calls,
    failures: 0,
    revokedAt: null,
    countRecentFailures: async (args) => record('countRecentFailures', args, base.failures),
    latestSessionInvalidation: async (username) => record('latestSessionInvalidation', username, base.revokedAt),
    logLoginEvent: async (args) => record('logLoginEvent', args, undefined),
    findUserByIdentifier: async (identifier) => record('findUserByIdentifier', identifier, null),
    usernameExists: async (name) => record('usernameExists', name, false),
    createAccount: async (args) => record('createAccount', args, 42),
    saveJournalData: async (...args) => record('saveJournalData', args, undefined),
    ensureJournalDataRow: async (...args) => record('ensureJournalDataRow', args, undefined),
    loadJournalData: async (...args) => record('loadJournalData', args, { settings: {}, trades: [] }),
    listRecentTrades: async (userId) => record('listRecentTrades', userId, []),
    findActiveResetRequest: async (hash) => record('findActiveResetRequest', hash, null),
    createPasswordResetRequest: async (args) => record('createPasswordResetRequest', args, undefined),
    applyPasswordReset: async (args) => record('applyPasswordReset', args, undefined),
    upsertSymbolPrices: async (entries) => record('upsertSymbolPrices', entries, entries.length),
    loadCachedSymbolPrices: async (symbols) => record('loadCachedSymbolPrices', symbols, {}),
    firstRegisteredUsername: async () => record('firstRegisteredUsername', null, null),
    listAdminUsers: async () => record('listAdminUsers', null, [{ id: '1' }]),
    listAdminLoginEvents: async () => record('listAdminLoginEvents', null, [{ id: '9' }]),
  };

  return Object.assign(base, overrides);
}

function makeCtx(overrides = {}) {
  const { headers, session, ...rest } = overrides;
  return {
    action: 'session',
    method: 'GET',
    query: {},
    rawBody: '',
    headers: { host: 'journal.example', ...headers },
    env: {},
    db: makeDb(),
    secret: SECRET,
    secure: true,
    session: session ?? null,
    ip: '203.0.113.7',
    userAgent: 'checkbot/1.0',
    fetch: async () => { throw new Error('no network in tests'); },
    ...rest,
  };
}

// The router always settles by throwing a Respond.
async function call(ctx) {
  try {
    await route(ctx);
  } catch (error) {
    if (error instanceof Respond) return error;
    throw error;
  }
  throw new Error(`route() returned without responding for action ${ctx.action}`);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const loggedInSession = (csrf, extra = {}) => ({
  username: 'trader', userId: 7, csrf, iat: nowSeconds(), ...extra,
});

// ===========================================================================
// 1. Router dispatch
// ===========================================================================

// The fifteen actions the PHP served, plus everything added since — listed
// explicitly so a new action is a deliberate edit here, never a silent one.
assert.deepStrictEqual(new Set(ACTION_NAMES), new Set([
  'session', 'register', 'login', 'forgot_password', 'validate_reset_token',
  'reset_password', 'logout', 'save', 'load', 'recent_trades',
  'public_recent_trades', 'live_prices', 'update_prices', 'login_logs', 'users_admin',
  // Terminal Pro: the public economic calendar. requireAuth, GET, no tier gate
  // (nothing premium sits behind it — see the action's own comment).
  'market_calendar',
  // Phase 2 archive integrity. NOT session-gated: it is called by Vercel Cron
  // with a bearer secret, so its whole security model is requireCronAuth.
  'cron_ingest',
]));
assert.strictEqual(ACTION_NAMES.length, 17, 'the 15 PHP actions + market_calendar + cron_ingest');

// --- cron_ingest is gated by a bearer secret, and fails CLOSED ------------
// It is a GET on a public path with no session and no CSRF, so this gate is
// the only thing in front of it. Every refusal must be byte-identical to the
// unknown-action 400, or the endpoint confirms it exists to anyone probing.
{
  const unknown = await call(makeCtx({ action: 'not_a_real_action' }));
  const shape = JSON.stringify(unknown.payload);

  // No CRON_SECRET set at all: the action must not exist. A forgotten env var
  // cannot be allowed to leave an open ingest trigger on the internet.
  const noSecret = await call(makeCtx({ action: 'cron_ingest', env: {} }));
  assert.strictEqual(noSecret.status, 400, 'cron_ingest must fail closed with no secret configured');
  assert.strictEqual(JSON.stringify(noSecret.payload), shape, 'refusal must be indistinguishable from an unknown action');

  // Set but too short to be a real secret: still closed.
  const weak = await call(makeCtx({
    action: 'cron_ingest', env: { CRON_SECRET: 'short' },
    headers: { authorization: 'Bearer short' },
  }));
  assert.strictEqual(weak.status, 400, 'a sub-16-char secret must not open the gate');

  const GOOD = 'a-sufficiently-long-cron-secret';
  // Right length, wrong value.
  const wrong = await call(makeCtx({
    action: 'cron_ingest', env: { CRON_SECRET: GOOD },
    headers: { authorization: 'Bearer not-the-right-secret-at-all' },
  }));
  assert.strictEqual(wrong.status, 400, 'a wrong bearer must be refused');

  // Missing header entirely.
  const bare = await call(makeCtx({ action: 'cron_ingest', env: { CRON_SECRET: GOOD } }));
  assert.strictEqual(bare.status, 400, 'a missing Authorization header must be refused');

  // The correct secret gets through, with NO session anywhere in the context.
  // The upstream fetch fails on purpose: fetchCalendarEvents soft-fails to
  // whatever the archive holds, so an unreachable feed must not throw.
  const ok = await call(makeCtx({
    action: 'cron_ingest',
    env: { CRON_SECRET: GOOD },
    headers: { authorization: `Bearer ${GOOD}` },
    db: makeDb({
      claimFeedFetch: async () => false,
      loadMarketEvents: async () => [],
      getFeedSuccessAt: async () => null,
    }),
  }));
  // 503, not 500: the archive genuinely has not advanced, and that is exactly
  // the state the Cron Jobs panel should colour red.
  assert.strictEqual(ok.status, 503, 'an unadvanced archive reports unhealthy, it does not crash');
  assert.strictEqual(ok.payload.source, 'ff_calendar');
  assert.strictEqual(ok.payload.asOf, null);
}

{
  const response = await call(makeCtx({ action: 'not_a_real_action' }));
  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(response.payload, { ok: false, error: 'Unknown action.' });
}

// An action name lifted from Object.prototype must not resolve to a function.
for (const action of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '']) {
  const response = await call(makeCtx({ action }));
  assert.strictEqual(response.status, 400, `action ${JSON.stringify(action)} must not dispatch`);
  assert.strictEqual(response.payload.error, 'Unknown action.');
}

// Every action is reachable — none throws its way out instead of responding.
for (const action of ACTION_NAMES) {
  const response = await call(makeCtx({ action, method: 'GET' }));
  assert.ok(response instanceof Respond, `${action} must respond`);
  assert.ok(typeof response.status === 'number' && response.status >= 200);
  assert.strictEqual(typeof response.payload.ok, 'boolean');
}

// Wrong verb is rejected before any work happens.
for (const action of ['register', 'login', 'logout', 'save', 'reset_password', 'update_prices']) {
  const csrf = newCsrfToken();
  const response = await call(makeCtx({ action, method: 'GET', session: loggedInSession(csrf) }));
  assert.strictEqual(response.status, 405, `${action} over GET must be 405`);
}

// ===========================================================================
// 2. CSRF enforcement
// ===========================================================================

const CSRF_PROTECTED = ['save', 'logout', 'update_prices'];
const CSRF_EXEMPT = ['login', 'register', 'forgot_password', 'reset_password'];

for (const action of CSRF_PROTECTED) {
  const csrf = newCsrfToken();

  // No token header at all.
  let response = await call(makeCtx({
    action, method: 'POST', rawBody: '{}', session: loggedInSession(csrf),
  }));
  assert.strictEqual(response.status, 403, `${action}: missing CSRF token must be rejected`);
  assert.match(response.payload.error, /CSRF/);

  // Wrong token.
  response = await call(makeCtx({
    action, method: 'POST', rawBody: '{}',
    headers: { 'x-csrf-token': newCsrfToken() },
    session: loggedInSession(csrf),
  }));
  assert.strictEqual(response.status, 403, `${action}: a mismatched CSRF token must be rejected`);

  // Right token — must get past the CSRF gate.
  response = await call(makeCtx({
    action, method: 'POST', rawBody: '{"prices":[]}',
    headers: { 'x-csrf-token': csrf },
    session: loggedInSession(csrf),
  }));
  assert.strictEqual(response.status, 200, `${action}: the correct CSRF token must be accepted`);
}

// A session with no CSRF token cannot satisfy the check with an empty header —
// the "" === "" trap.
{
  const response = await call(makeCtx({
    action: 'save', method: 'POST', rawBody: '{}',
    headers: { 'x-csrf-token': '' },
    session: { username: 'trader', userId: 7, csrf: '' },
  }));
  assert.strictEqual(response.status, 403, 'empty token must never match an empty session token');
}

// An unauthenticated POST to a protected action fails CSRF before it can even
// report "not authenticated" — no session, no token.
{
  const response = await call(makeCtx({ action: 'save', method: 'POST', rawBody: '{}', session: null }));
  assert.strictEqual(response.status, 403);
}

// The four pre-session actions are exempt (they have no session yet) and are
// covered by the rate limit instead. None of them may answer 403/CSRF.
for (const action of CSRF_EXEMPT) {
  const response = await call(makeCtx({ action, method: 'POST', rawBody: '{}', session: null }));
  assert.notStrictEqual(response.status, 403, `${action} must be CSRF-exempt`);
}

// GET actions never require a token.
{
  const response = await call(makeCtx({ action: 'load', method: 'GET', session: loggedInSession(newCsrfToken()) }));
  assert.strictEqual(response.status, 200);
}

// A tampered session cookie decodes to null upstream, so the request is simply
// unauthenticated — it can never be treated as a valid session.
{
  const forged = `${encodeSession(loggedInSession('x'), 'the-wrong-secret')}`;
  const { decodeSession } = await import('../api/_lib/session.js');
  assert.strictEqual(decodeSession(forged, SECRET), null, 'a cookie signed with another key must be rejected');

  const valid = encodeSession(loggedInSession('abc'), SECRET);
  assert.strictEqual(decodeSession(valid, SECRET).username, 'trader');
  // Flip one character of the payload; the signature no longer matches.
  const tampered = `${valid[0] === 'e' ? 'f' : 'e'}${valid.slice(1)}`;
  assert.strictEqual(decodeSession(tampered, SECRET), null, 'a mutated payload must be rejected');
}

// ===========================================================================
// 3. Rate limit window logic
// ===========================================================================

// The threshold: 6 failures inside the window closes the door.
for (const [failures, expected] of [[0, false], [5, false], [6, true], [99, true]]) {
  const db = makeDb();
  db.failures = failures;
  const response = await call(makeCtx({
    action: 'login', method: 'POST',
    rawBody: JSON.stringify({ identifier: 'trader', password: 'password123' }),
    db,
  }));
  const limited = response.status === 429;
  assert.strictEqual(limited, expected, `${failures} recent failures -> limited=${expected}`);
  if (limited) assert.match(response.payload.error, /10 minutes/);
}

// The window is scoped correctly per action: login and forgot are scoped by
// identity as well as IP, register and reset by IP alone.
{
  const cases = [
    { action: 'login', body: { identifier: 'Trader', password: 'password123' }, eventType: 'login', username: 'trader' },
    { action: 'register', body: { identifier: 'newname', password: 'password123' }, eventType: 'register', username: '' },
    { action: 'forgot_password', body: { email: 'Someone@Example.com' }, eventType: 'forgot', username: 'someone@example.com' },
    { action: 'reset_password', body: { token: 'abc', password: 'password123' }, eventType: 'reset', username: '' },
  ];

  for (const { action, body, eventType, username } of cases) {
    const db = makeDb();
    await call(makeCtx({ action, method: 'POST', rawBody: JSON.stringify(body), db, ip: '198.51.100.4' }));

    const check = db.calls.find((entry) => entry.name === 'countRecentFailures');
    assert.ok(check, `${action} must consult the rate limiter`);
    assert.strictEqual(check.args.eventType, eventType, `${action} counts its own event type`);
    assert.strictEqual(check.args.username ?? '', username, `${action} scopes by ${username || 'IP only'}`);
    assert.strictEqual(check.args.ip, '198.51.100.4', `${action} scopes by client IP`);
  }
}

// The rate limit is checked before credentials are looked at, so a limited
// caller cannot use the endpoint as an account oracle.
{
  const db = makeDb();
  db.failures = 6;
  const response = await call(makeCtx({
    action: 'login', method: 'POST',
    rawBody: JSON.stringify({ identifier: 'trader', password: 'password123' }),
    db,
  }));
  assert.strictEqual(response.status, 429);
  assert.ok(
    !db.calls.some((entry) => entry.name === 'findUserByIdentifier'),
    'a rate-limited login must not touch the user table',
  );
}

// A failed login writes the failure row that the limiter counts — without it
// the window never fills and the limit is decorative.
{
  const db = makeDb({ findUserByIdentifier: async () => null });
  await call(makeCtx({
    action: 'login', method: 'POST',
    rawBody: JSON.stringify({ identifier: 'ghost', password: 'password123' }),
    db,
  }));
  const logged = db.calls.find((entry) => entry.name === 'logLoginEvent');
  assert.ok(logged, 'a failed login must be logged');
  assert.strictEqual(logged.args.success, false);
  assert.strictEqual(logged.args.eventType, 'login');
}

// Every forgot_password request counts, existing account or not — otherwise the
// endpoint is an unlimited address-enumeration oracle.
{
  const db = makeDb();
  const response = await call(makeCtx({
    action: 'forgot_password', method: 'POST',
    rawBody: JSON.stringify({ email: 'nobody@example.com' }), db,
  }));
  const logged = db.calls.find((entry) => entry.name === 'logLoginEvent');
  assert.strictEqual(logged.args.success, false, 'forgot_password logs a failure row as its counter');
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.payload.message, 'If the email exists, a reset link has been sent.');
}

// Identical answer for an address that does exist: no enumeration, no reset URL.
{
  const db = makeDb({
    findUserByIdentifier: async () => ({ id: 3, username: 'trader', email: 'real@example.com', passwordHash: 'x' }),
  });
  const response = await call(makeCtx({
    action: 'forgot_password', method: 'POST',
    rawBody: JSON.stringify({ email: 'real@example.com' }), db,
  }));
  assert.deepStrictEqual(response.payload, { ok: true, message: 'If the email exists, a reset link has been sent.' });
  assert.ok(!JSON.stringify(response.payload).includes('reset='), 'the reset URL must never be returned');
  assert.ok(db.calls.some((entry) => entry.name === 'createPasswordResetRequest'));
  // Only the hash is stored, never the token itself.
  const stored = db.calls.find((entry) => entry.name === 'createPasswordResetRequest');
  assert.match(stored.args.tokenHash, /^[0-9a-f]{64}$/);
}

// ===========================================================================
// 4. public_recent_trades — field whitelist and cap
// ===========================================================================

// Everything the private feed exposes, including the fields that must not leak.
const sensitiveTrade = (index) => ({
  id: `trade-${index}`,
  symbol: 'XAUUSD',
  date: `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
  direction: 'Buy',
  entry_price: 2400.5,
  stop_loss: 2390,
  take_profit: 2450,
  exit_price: 2440,
  profit_loss: index % 3 === 0 ? 250 : (index % 3 === 1 ? -80 : 0),
  pips: 40,
  status: 'closed',
  created_at: '2026-07-01T10:00:00Z',
  closed_at: '2026-07-01T12:00:00Z',
});

{
  const rows = Array.from({ length: 45 }, (_, index) => sensitiveTrade(index));
  const db = makeDb({ listRecentTrades: async () => rows });
  const response = await call(makeCtx({
    action: 'public_recent_trades',
    db,
    env: { PUBLIC_RECENT_TRADES_USER_ID: '5' },
  }));

  assert.strictEqual(response.status, 200);
  const { trades } = response.payload;

  // The cap.
  assert.strictEqual(trades.length, 20, 'the public tape is capped at 20 rows');

  // The whitelist, built by hand. Entry/stop/target are published by the
  // feed owner's choice — it is their own journal on display.
  const allowed = ['symbol', 'date', 'direction', 'status', 'result', 'entry_price', 'stop_loss', 'take_profit'];
  for (const trade of trades) {
    assert.deepStrictEqual(Object.keys(trade).sort(), [...allowed].sort(), 'only whitelisted fields may appear');
  }

  // Nothing that could reveal size, P&L amounts or internal ids survives
  // anywhere in the body — entry/stop/target are deliberate, the rest stays
  // sealed even if the stored trade grows fields.
  const serialized = JSON.stringify(response.payload);
  for (const leak of ['exit_price', 'profit_loss', '"pips"', 'created_at', 'closed_at', 'trade-0', '"id"']) {
    assert.ok(!serialized.includes(leak), `public feed must not leak ${leak}`);
  }

  // P&L is reduced to a three-way outcome, never a number.
  assert.deepStrictEqual(
    trades.slice(0, 3).map((trade) => trade.result),
    ['win', 'loss', 'flat'],
  );
}

// An open trade has no outcome to report.
{
  const db = makeDb({
    listRecentTrades: async () => [{ ...sensitiveTrade(0), status: 'open', profit_loss: 999 }],
    findUserByIdentifier: async () => ({ id: 5, username: 'trader', email: '', passwordHash: 'x' }),
  });
  const response = await call(makeCtx({
    action: 'public_recent_trades', db, env: { PUBLIC_RECENT_TRADES_USERNAME: 'trader' },
  }));
  assert.strictEqual(response.payload.trades[0].result, '');
  assert.strictEqual(response.payload.trades[0].status, 'open');
  assert.ok(!JSON.stringify(response.payload).includes('999'));
}

// With no public user configured the endpoint returns nothing rather than
// defaulting to somebody's real journal.
{
  const db = makeDb({ listRecentTrades: async () => [sensitiveTrade(0)] });
  const response = await call(makeCtx({ action: 'public_recent_trades', db, env: {} }));
  assert.deepStrictEqual(response.payload, { ok: true, trades: [] });
  assert.ok(!db.calls.some((entry) => entry.name === 'listRecentTrades'));
}

// The private feed, by contrast, is authenticated and keeps its full shape.
{
  const db = makeDb({ listRecentTrades: async () => [sensitiveTrade(0)] });
  let response = await call(makeCtx({ action: 'recent_trades', db, session: null }));
  assert.strictEqual(response.status, 401, 'recent_trades requires auth');

  response = await call(makeCtx({ action: 'recent_trades', db, session: loggedInSession('t') }));
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.payload.trades[0].profit_loss, 250);
}

// ===========================================================================
// 5. Auth and admin gating
// ===========================================================================

for (const action of ['load', 'recent_trades', 'login_logs', 'users_admin']) {
  const response = await call(makeCtx({ action, session: null }));
  assert.strictEqual(response.status, 401, `${action} must require authentication`);
}

// update_prices is authenticated too — it writes to symbol_prices.
{
  const csrf = newCsrfToken();
  const response = await call(makeCtx({
    action: 'update_prices', method: 'POST',
    rawBody: JSON.stringify({ prices: [{ symbol: 'BTCUSDT', price: 1 }] }),
    headers: { 'x-csrf-token': csrf },
    session: { csrf }, // valid CSRF, but not logged in
  }));
  assert.strictEqual(response.status, 401, 'update_prices must require authentication, not just CSRF');
}

// Admin views: authenticated but non-admin gets 403, never the data.
for (const action of ['login_logs', 'users_admin']) {
  let response = await call(makeCtx({ action, session: loggedInSession('t'), env: {} }));
  assert.strictEqual(response.status, 403, `${action} must be admin-only when no admin is configured`);

  response = await call(makeCtx({
    action, session: loggedInSession('t'), env: { ADMIN_USERNAMES: 'someone-else,another' },
  }));
  assert.strictEqual(response.status, 403, `${action} must reject a non-listed user`);

  response = await call(makeCtx({
    action, session: loggedInSession('t'), env: { ADMIN_USERNAMES: 'other, TRADER ' },
  }));
  assert.strictEqual(response.status, 200, `${action} admits a listed admin (case/space tolerant)`);
}

// The "first registered user is admin" fallback stays opt-in.
{
  const db = makeDb({ firstRegisteredUsername: async () => 'trader' });
  let response = await call(makeCtx({ action: 'users_admin', db, session: loggedInSession('t'), env: {} }));
  assert.strictEqual(response.status, 403, 'bootstrap admin must be off by default');

  response = await call(makeCtx({
    action: 'users_admin', db, session: loggedInSession('t'), env: { ALLOW_BOOTSTRAP_ADMIN: 'true' },
  }));
  assert.strictEqual(response.status, 200, 'bootstrap admin works when explicitly enabled');
}

// ===========================================================================
// 5b. Session revocation
// ===========================================================================
// A signed cookie cannot be deleted server-side, so logging out has to revoke
// it some other way: login_info already records every logout and every
// completed password reset, and a cookie older than the newest such row is
// refused. Without this, a cookie captured before logout would keep working.

{
  // Logged out five minutes ago; the cookie predates that.
  const db = makeDb();
  db.revokedAt = nowSeconds() - 300;
  const response = await call(makeCtx({
    action: 'load', db, session: loggedInSession('t', { iat: nowSeconds() - 600 }),
  }));
  assert.strictEqual(response.status, 401, 'a cookie older than the last logout must be refused');
}

{
  // Logged out, then logged back in: the newer cookie survives.
  const db = makeDb();
  db.revokedAt = nowSeconds() - 300;
  const response = await call(makeCtx({
    action: 'load', db, session: loggedInSession('t', { iat: nowSeconds() - 60 }),
  }));
  assert.strictEqual(response.status, 200, 'a cookie minted after the logout must still work');
}

{
  // Same second: a logout immediately followed by a login must not lock the
  // user straight back out.
  const at = nowSeconds();
  const db = makeDb();
  db.revokedAt = at;
  const response = await call(makeCtx({ action: 'load', db, session: loggedInSession('t', { iat: at }) }));
  assert.strictEqual(response.status, 200, 'log out then straight back in must work');
}

{
  // Nothing on record revokes nothing.
  const db = makeDb();
  db.revokedAt = null;
  const response = await call(makeCtx({ action: 'load', db, session: loggedInSession('t') }));
  assert.strictEqual(response.status, 200);
}

{
  // An anonymous visitor's cookie carries no username, so no lookup happens —
  // the check must not cost a query on every public page view.
  const db = makeDb();
  await call(makeCtx({ action: 'public_recent_trades', db, session: { csrf: 'x', username: '', iat: nowSeconds() } }));
  assert.ok(
    !db.calls.some((entry) => entry.name === 'latestSessionInvalidation'),
    'an anonymous session must not trigger a revocation lookup',
  );
}

{
  // A completed password reset writes the row that revokes live sessions —
  // the gap PHP had, where changing your password left old sessions running.
  const db = makeDb({
    findActiveResetRequest: async () => ({ id: '4', user_id: '9', username: 'trader' }),
  });
  const response = await call(makeCtx({
    action: 'reset_password', method: 'POST',
    rawBody: JSON.stringify({ token: 'a'.repeat(64), password: 'a new password' }), db,
  }));
  assert.strictEqual(response.status, 200);

  const logged = db.calls.filter((entry) => entry.name === 'logLoginEvent').map((entry) => entry.args);
  const resetRow = logged.find((args) => args.eventType === 'reset' && args.success === true);
  assert.ok(resetRow, 'a successful reset must be recorded');
  assert.strictEqual(resetRow.username, 'trader');
  assert.strictEqual(resetRow.userId, 9);

  // The new password is stored as a $2y$ bcrypt hash, never in clear.
  const applied = db.calls.find((entry) => entry.name === 'applyPasswordReset').args;
  assert.match(applied.passwordHash, /^\$2y\$10\$/, 'reset hashes keep the $2y$ prefix PHP reads');
  assert.ok(!applied.passwordHash.includes('a new password'));
}

// ===========================================================================
// 6. Session issuance and input validation
// ===========================================================================

// The session action always hands out a CSRF token and a signed cookie, even to
// an anonymous visitor — that is how the front-end gets a token to POST with.
{
  const response = await call(makeCtx({ action: 'session', session: null }));
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.payload.authenticated, false);
  assert.match(response.payload.csrfToken, /^[0-9a-f]{64}$/);
  assert.match(response.cookie, /^tj_session=/);
  assert.match(response.cookie, /HttpOnly/);
  assert.match(response.cookie, /SameSite=Lax/);
  assert.match(response.cookie, /Secure/);
}

// Over plain http the Secure flag is dropped, or the cookie would never be set.
{
  const response = await call(makeCtx({ action: 'session', session: null, secure: false }));
  assert.ok(!/Secure/.test(response.cookie));
}

// Logging out clears the cookie.
{
  const csrf = newCsrfToken();
  const response = await call(makeCtx({
    action: 'logout', method: 'POST', headers: { 'x-csrf-token': csrf }, session: loggedInSession(csrf),
  }));
  assert.strictEqual(response.status, 200);
  assert.match(response.cookie, /Max-Age=0/);
}

// The full cookie round trip: what the router puts in Set-Cookie must survive
// the parse api/handler.js does on the way back in. A mismatch here would log
// everyone out on every request, so it is pinned rather than assumed.
{
  const { parseCookies, decodeSession, COOKIE_NAME } = await import('../api/_lib/session.js');
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash('the right password', 10);

  const login = await call(makeCtx({
    action: 'login', method: 'POST',
    rawBody: JSON.stringify({ identifier: 'trader', password: 'the right password' }),
    db: makeDb({
      findUserByIdentifier: async () => ({ id: 3, username: 'trader', email: '', passwordHash: hash }),
    }),
  }));

  // Exactly what a browser would send back on the next request.
  const cookieHeader = login.cookie.split(';')[0];
  const restored = decodeSession(parseCookies(cookieHeader)[COOKIE_NAME], SECRET);

  assert.ok(restored, 'the cookie the router issued must decode again');
  assert.strictEqual(restored.username, 'trader');
  assert.strictEqual(restored.userId, 3);
  assert.strictEqual(restored.csrf, login.payload.csrfToken, 'the CSRF token in the cookie matches the one returned');

  // Logging in rotates the token, so one planted before login cannot be used
  // after it.
  const planted = newCsrfToken();
  const afterLogin = await call(makeCtx({
    action: 'login', method: 'POST',
    rawBody: JSON.stringify({ identifier: 'trader', password: 'the right password' }),
    session: { csrf: planted },
    db: makeDb({
      findUserByIdentifier: async () => ({ id: 3, username: 'trader', email: '', passwordHash: hash }),
    }),
  }));
  assert.notStrictEqual(afterLogin.payload.csrfToken, planted, 'login must mint a new CSRF token');

  // And that restored session really does authorise the next request.
  const next = await call(makeCtx({
    action: 'save', method: 'POST', rawBody: '{"trades":[]}',
    headers: { 'x-csrf-token': restored.csrf },
    session: restored,
  }));
  assert.strictEqual(next.status, 200, 'the round-tripped session authenticates and satisfies CSRF');
}

// Credential validation mirrors the PHP: 8-character minimum, identifier
// required, and a body that is not JSON is rejected outright.
{
  const short = await call(makeCtx({
    action: 'login', method: 'POST', rawBody: JSON.stringify({ identifier: 'trader', password: 'short' }),
  }));
  assert.strictEqual(short.status, 422);
  assert.match(short.payload.error, /at least 8 characters/);

  const missing = await call(makeCtx({
    action: 'login', method: 'POST', rawBody: JSON.stringify({ password: 'password123' }),
  }));
  assert.strictEqual(missing.status, 422);

  const empty = await call(makeCtx({ action: 'login', method: 'POST', rawBody: '' }));
  assert.strictEqual(empty.status, 400);
  assert.strictEqual(empty.payload.error, 'Empty request body.');

  const garbage = await call(makeCtx({ action: 'login', method: 'POST', rawBody: 'not json' }));
  assert.strictEqual(garbage.status, 400);
  assert.strictEqual(garbage.payload.error, 'Invalid JSON payload.');

  const scalar = await call(makeCtx({ action: 'login', method: 'POST', rawBody: '"just a string"' }));
  assert.strictEqual(scalar.status, 400);
}

// Registration stores a $2y$ bcrypt hash — the prefix PHP's password_verify()
// reads, so a rollback to trade_handler.php still logs the new account in.
{
  const db = makeDb();
  const response = await call(makeCtx({
    action: 'register', method: 'POST',
    rawBody: JSON.stringify({ identifier: 'newtrader', password: 'a good long password' }), db,
  }));
  assert.strictEqual(response.status, 200);

  const created = db.calls.find((entry) => entry.name === 'createAccount').args;
  assert.match(created.passwordHash, /^\$2y\$10\$/, 'new accounts get a $2y$ cost-10 hash');
  assert.ok(!created.passwordHash.includes('a good long password'), 'the password is never stored');
  assert.strictEqual(created.username, 'newtrader');

  // A brand new account starts with the default journal, in the same write.
  assert.strictEqual(created.defaults.settings.startingBalance, 10000);
  assert.deepStrictEqual(created.defaults.trades, []);
}

// A wrong password and an unknown account are indistinguishable.
{
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash('the right password', 10);
  const db = makeDb({
    findUserByIdentifier: async () => ({ id: 3, username: 'trader', email: '', passwordHash: hash }),
  });

  const wrong = await call(makeCtx({
    action: 'login', method: 'POST',
    rawBody: JSON.stringify({ identifier: 'trader', password: 'the wrong password' }), db,
  }));
  const unknown = await call(makeCtx({
    action: 'login', method: 'POST',
    rawBody: JSON.stringify({ identifier: 'ghost', password: 'the wrong password' }),
    db: makeDb({ findUserByIdentifier: async () => null }),
  }));
  assert.strictEqual(wrong.status, 401);
  assert.deepStrictEqual(wrong.payload, unknown.payload, 'wrong password and unknown user answer identically');

  // The right password logs in and issues a fresh signed cookie.
  const good = await call(makeCtx({
    action: 'login', method: 'POST',
    rawBody: JSON.stringify({ identifier: 'trader', password: 'the right password' }), db,
  }));
  assert.strictEqual(good.status, 200);
  assert.strictEqual(good.payload.username, 'trader');
  assert.match(good.cookie, /^tj_session=/);
  assert.match(good.payload.csrfToken, /^[0-9a-f]{64}$/);
}

// Nothing in an error response ever carries an exception detail.
{
  const db = makeDb({
    loadJournalData: async () => { throw new Error('connection to 10.0.0.1:5432 refused, password=hunter2'); },
  });
  let threw = null;
  try {
    await call(makeCtx({ action: 'load', db, session: loggedInSession('t') }));
  } catch (error) {
    threw = error;
  }
  // The router lets it escape; api/handler.js turns it into a generic 500 and
  // logs the detail server-side. What matters is that the router never wraps
  // the message into a payload of its own.
  assert.ok(threw instanceof Error);
  assert.ok(!(threw instanceof Respond), 'an unexpected failure must not become a client-visible payload');
}

console.log('apiRouter.check.mjs: all assertions passed');
