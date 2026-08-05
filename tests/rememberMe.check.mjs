// "Remember me" must change exactly one thing — how long the cookie lives —
// and nothing about how it is signed or protected. The regression this guards
// against is the cookie and its payload disagreeing: before this feature the
// cookie had no Max-Age at all while the payload claimed 7 days, so the claim
// was unreachable and every browser close logged the user out.
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  encodeSession, decodeSession, serializeSessionCookie, sessionMaxAge,
} from '../api/_lib/session.js';

const SECRET = 'remember-me-test-secret';
const base = { username: 'trader', userId: 7, csrf: 'csrf-token' };

// --- the two lifetimes are issued as a matching pair -------------------------
for (const remember of [true, false]) {
  const token = encodeSession({ ...base, rem: remember }, SECRET);
  const cookie = serializeSessionCookie(token, { secure: true, remember });
  const payload = decodeSession(token, SECRET);

  assert.strictEqual(payload.rem, remember, 'rem must survive the round trip');

  const expSeconds = payload.exp - Math.floor(Date.now() / 1000);
  const expected = sessionMaxAge(remember);
  assert.ok(Math.abs(expSeconds - expected) <= 5,
    `payload exp (${expSeconds}s) must match sessionMaxAge (${expected}s)`);

  if (remember) {
    assert.match(cookie, new RegExp(`Max-Age=${expected}`),
      'a remembered cookie must carry a Max-Age matching its payload exp');
  } else {
    assert.ok(!/Max-Age/.test(cookie),
      'an unremembered cookie must be a browser-session cookie (no Max-Age)');
  }

  // Lifetime is the ONLY thing that changes.
  assert.match(cookie, /HttpOnly/, 'HttpOnly must not depend on remember');
  assert.match(cookie, /SameSite=Lax/, 'SameSite must not depend on remember');
  assert.match(cookie, /Secure/, 'Secure must not depend on remember');
  assert.match(cookie, /Path=\//, 'Path must not depend on remember');
}

// --- remember must not weaken the signature ---------------------------------
const forged = encodeSession({ ...base, rem: true }, 'a-different-secret');
assert.strictEqual(decodeSession(forged, SECRET), null,
  'a cookie signed with the wrong key must be rejected regardless of rem');

// --- a tampered rem flag must invalidate the signature ----------------------
const good = encodeSession({ ...base, rem: false }, SECRET);
const [payloadPart, sig] = good.split('.');
const tampered = Buffer.from(
  JSON.stringify({ ...JSON.parse(Buffer.from(payloadPart, 'base64url').toString()), rem: true }),
).toString('base64url');
assert.strictEqual(decodeSession(`${tampered}.${sig}`, SECRET), null,
  'flipping rem in the payload must break the HMAC');

// --- encodeSession must not let a caller choose its own exp -----------------
// It spreads ...data first and sets exp afterwards, so a supplied exp is
// overwritten. That is the property being pinned here.
const attemptedForever = decodeSession(
  encodeSession({ ...base, rem: false, exp: Math.floor(Date.now() / 1000) + 999 * 86400 }, SECRET),
  SECRET,
);
const forcedDays = Math.round((attemptedForever.exp - Date.now() / 1000) / 86400);
assert.strictEqual(forcedDays, 7, 'a caller-supplied exp must be ignored, not honoured');

// --- an expired payload is refused even when correctly signed ---------------
// Built by hand, because encodeSession will not mint one.
const staleBody = Buffer.from(JSON.stringify({
  ...base, rem: true, exp: Math.floor(Date.now() / 1000) - 1,
})).toString('base64url');
const staleSig = crypto.createHmac('sha256', SECRET).update(staleBody).digest('base64url');
assert.strictEqual(decodeSession(`${staleBody}.${staleSig}`, SECRET), null,
  'a correctly-signed but expired payload must still be refused');

console.log('rememberMe.check.mjs — all assertions passed');
