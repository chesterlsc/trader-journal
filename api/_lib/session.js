// Stateless session + CSRF, replacing PHP's server-side $_SESSION.
//
// PHP kept session state in a file on the container's disk. Vercel functions
// share no disk and no memory between invocations, so the session has to travel
// with the request. It rides in the same HttpOnly cookie as before, but the
// contents are now a signed payload: base64url(json).base64url(hmac-sha256).
// The signature is what makes it unforgeable — a client can read its own
// username and CSRF token (both already known to it) but cannot mint a new one.

import crypto from 'node:crypto';

export const COOKIE_NAME = 'tj_session';

// PHP's session cookie had lifetime 0 (cleared when the browser closes). The
// cookie stays a session cookie; this bounds how long a stolen one stays valid.
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function sign(payload, secret) {
  return base64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

// crypto.timingSafeEqual throws on length mismatch, so compare digests of the
// inputs — equal length always, and still constant-time on the comparison.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false;
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

export function newCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function newResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// The signing key. SESSION_SECRET is the documented knob; when it is absent we
// derive a key from DATABASE_URL rather than falling back to any constant, so
// an un-configured deploy is still unforgeable instead of trivially forgeable.
// Rotating either value just logs everyone out.
export function resolveSessionSecret(env) {
  const explicit = String(env.SESSION_SECRET ?? '').trim();
  if (explicit !== '') return explicit;

  const databaseUrl = String(env.DATABASE_URL ?? env.POSTGRES_URL ?? '').trim();
  if (databaseUrl !== '') {
    return crypto.createHash('sha256').update(`trader-journal-session|${databaseUrl}`).digest('hex');
  }

  throw new Error('No session key material: set SESSION_SECRET or DATABASE_URL.');
}

export function parseCookies(cookieHeader) {
  const result = {};
  for (const part of String(cookieHeader ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    if (key === '') continue;
    try {
      result[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      result[key] = part.slice(index + 1).trim();
    }
  }
  return result;
}

export function encodeSession(data, secret) {
  const payload = base64url(JSON.stringify({
    ...data,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  }));
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeSession(token, secret) {
  if (typeof token !== 'string' || token === '') return null;

  const dot = token.indexOf('.');
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(payload, secret))) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (typeof data.exp !== 'number' || data.exp * 1000 <= Date.now()) return null;

  return data;
}

export function serializeSessionCookie(token, { secure }) {
  const flags = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) flags.push('Secure');
  return flags.join('; ');
}

export function serializeClearedCookie({ secure }) {
  const flags = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) flags.push('Secure');
  return flags.join('; ');
}
