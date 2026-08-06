// The router: all fifteen actions trade_handler.php served, on the same
// query-string contract (`/trade_handler.php?action=…`).
//
// Nothing in here reaches for a database, a clock or an environment directly —
// it all arrives on `ctx`. That is what lets the tests drive every action,
// including the security controls, against a fake db object with no Postgres
// anywhere near them.

import bcrypt from 'bcryptjs';
import {
  encodeSession,
  newCsrfToken,
  newResetToken,
  safeEqual,
  serializeClearedCookie,
  serializeSessionCookie,
  sha256Hex,
} from './session.js';
import { fetchLivePrices } from './prices.js';
import { UniqueViolation } from './db.js';
import { journalDefaults, sanitizeArray, sanitizeReplayNotes, sanitizeSettings, str } from './sanitize.js';

// PHP's respond() ended the request with `exit`. Throwing does the same job
// here: any action can bail from any depth and the handler sends what it threw.
export class Respond extends Error {
  constructor(status, payload, cookie) {
    super(`respond:${status}`);
    this.status = status;
    this.payload = payload;
    this.cookie = cookie;
  }
}

const respond = (status, payload, cookie) => {
  throw new Respond(status, payload, cookie);
};

// PHP's password_hash(PASSWORD_DEFAULT) under php:8.3 produced bcrypt cost 10.
const BCRYPT_COST = 10;

// `$2y$`, `$2a$` and `$2b$` are the same algorithm — the letter is a marker, not
// a parameter. bcryptjs reads all three (which is what lets every existing PHP
// `$2y$` hash keep working) but writes `$2b$`. New hashes are stored with the
// prefix rewritten to `$2y$` so the password_hash column stays uniform and a
// rollback to trade_handler.php still logs everyone in. Both directions are
// pinned against real PHP output in tests/bcryptCompat.check.mjs.
async function hashPassword(password) {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  return `$2y$${hash.slice(4)}`;
}

const CSRF_EXEMPT_ACTIONS = new Set(['login', 'register', 'forgot_password', 'reset_password']);

const RATE_LIMIT_MAX_FAILURES = 6;

const PUBLIC_TRADES_LIMIT = 20;

// Deciding "did the user type an email or a username" and validating the
// forgot-password field. Usernames are [a-z0-9._-] and cannot contain "@",
// so the two never overlap.
const EMAIL_PATTERN = /^[^\s@"'<>()[\],;:\\]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

function isEmail(value) {
  return value.length <= 190 && EMAIL_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function requireMethod(ctx, method) {
  if (ctx.method !== method) {
    respond(405, { ok: false, error: `Use ${method} for this action.` });
  }
}

function readJsonBody(ctx) {
  const raw = str(ctx.rawBody ?? '');
  if (raw.trim() === '') {
    respond(400, { ok: false, error: 'Empty request body.' });
  }

  let decoded;
  try {
    decoded = JSON.parse(raw);
  } catch {
    respond(400, { ok: false, error: 'Invalid JSON payload.' });
  }
  if (decoded === null || typeof decoded !== 'object') {
    respond(400, { ok: false, error: 'Invalid JSON payload.' });
  }

  return decoded;
}

function readCredentials(ctx, forRegister = false) {
  const decoded = readJsonBody(ctx);
  const identifier = str(decoded.identifier ?? decoded.email ?? decoded.username ?? '').trim().toLowerCase();
  let email = decoded.email !== undefined && decoded.email !== null
    ? str(decoded.email).trim().toLowerCase()
    : '';
  const password = decoded.password !== undefined && decoded.password !== null ? str(decoded.password) : '';

  if (identifier === '') {
    respond(422, { ok: false, error: 'Enter a username or email address.' });
  }
  // PHP's strlen() counts bytes, so a short multi-byte passphrase is judged the
  // same way it was before the port.
  if (Buffer.byteLength(password, 'utf8') < 8) {
    respond(422, { ok: false, error: 'Password must be at least 8 characters.' });
  }

  if (forRegister) {
    if (isEmail(identifier)) {
      email = identifier;
    } else if (!USERNAME_PATTERN.test(identifier)) {
      respond(422, { ok: false, error: 'Username must be 3-32 chars or use a valid email address.' });
    }
  }

  return { identifier, password, email };
}

// ---------------------------------------------------------------------------
// Session / CSRF
// ---------------------------------------------------------------------------

function currentUsername(ctx) {
  const username = str(ctx.session?.username ?? '');
  return username !== '' ? username : null;
}

// Reads the "Remember me" box. Only login and register may set it — every other
// action inherits whatever the current session already chose.
function wantsRemember(ctx) {
  const value = ctx.body?.remember;
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

// Mints the cookie carrying the session. Called wherever PHP wrote $_SESSION.
// `iat` is what makes the cookie revocable — see assertSessionNotRevoked.
function issueSessionCookie(ctx, data) {
  const csrf = str(data.csrf ?? ctx.session?.csrf ?? '') || newCsrfToken();
  // "Remember me" is sticky: an explicit rem on this call wins, otherwise the
  // existing session's choice carries forward. Without the carry-forward the
  // `session` action — which re-mints the cookie on every page load — would
  // quietly downgrade a remembered login back to a browser-session cookie.
  const remember = data.rem === undefined ? ctx.session?.rem === true : data.rem === true;
  const payload = { ...data, csrf, rem: remember, iat: Math.floor(Date.now() / 1000) };
  return {
    csrf,
    cookie: serializeSessionCookie(encodeSession(payload, ctx.secret), {
      secure: ctx.secure,
      remember,
    }),
  };
}

// A signed cookie has no server-side state to destroy, so logging out would
// otherwise leave a stolen cookie working until it expired — a regression on
// PHP, which destroyed the session server-side. login_info already records
// every logout, so a cookie minted before the user's newest successful logout
// (or password reset) is treated as gone. No sessions table, no schema change.
async function assertSessionNotRevoked(ctx) {
  const username = currentUsername(ctx);
  if (username === null) return;

  const revokedAt = await ctx.db.latestSessionInvalidation(username);
  const issuedAt = Number(ctx.session?.iat ?? 0);
  // Strictly greater: a login in the same second as a preceding logout — an
  // ordinary "log out, log straight back in" — must survive.
  if (revokedAt !== null && revokedAt > issuedAt) {
    ctx.session = null;
  }
}

function requireCsrfToken(ctx) {
  const expected = str(ctx.session?.csrf ?? '');
  const provided = str(ctx.headers['x-csrf-token'] ?? '');
  if (!safeEqual(expected, provided)) {
    respond(403, { ok: false, error: 'Invalid or missing CSRF token. Reload the page and try again.' });
  }
}

async function requireAuth(ctx) {
  const username = currentUsername(ctx);
  if (username === null) {
    respond(401, { ok: false, error: 'Not authenticated. Please login first.' });
  }

  const sessionUserId = ctx.session?.userId;
  if (Number.isInteger(sessionUserId) && sessionUserId > 0) {
    return { id: sessionUserId, username };
  }

  const user = await ctx.db.findUserByIdentifier(username);
  if (user === null) {
    respond(
      401,
      { ok: false, error: 'Session expired. Please login again.' },
      serializeClearedCookie({ secure: ctx.secure }),
    );
  }

  return { id: user.id, username: user.username };
}

async function isAdminUsername(ctx, username) {
  const candidate = str(username).trim().toLowerCase();
  if (candidate === '') return false;

  const configured = str(ctx.env.ADMIN_USERNAMES ?? '').trim() || str(ctx.env.ADMIN_USERNAME ?? '').trim();
  if (configured !== '') {
    const admins = configured.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    return admins.includes(candidate);
  }

  // "First registered user is admin" stays opt-in: without the flag, an
  // unconfigured deploy grants nobody the admin views.
  const bootstrap = str(ctx.env.ALLOW_BOOTSTRAP_ADMIN ?? '').trim().toLowerCase();
  if (!['1', 'true', 'yes'].includes(bootstrap)) return false;

  const first = await ctx.db.firstRegisteredUsername();
  return first !== null && candidate === first;
}

async function requireAdmin(ctx, auth) {
  if (!(await isAdminUsername(ctx, auth.username))) {
    respond(403, { ok: false, error: 'Admin access required.' });
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

// Six failures from one IP (and username, where the action has one) inside a
// rolling ten minute window. The counter lives in login_info, so it survives
// cold starts — which a per-instance in-memory counter could not.
async function assertNotRateLimited(ctx, eventType, username = '') {
  const failures = await ctx.db.countRecentFailures({ eventType, ip: ctx.ip, username });
  if (failures >= RATE_LIMIT_MAX_FAILURES) {
    respond(429, { ok: false, error: 'Too many attempts. Please wait 10 minutes and try again.' });
  }
}

function logEvent(ctx, { userId, username, eventType, success }) {
  return ctx.db.logLoginEvent({
    userId,
    username,
    eventType,
    success,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

// ---------------------------------------------------------------------------
// Registration helpers
// ---------------------------------------------------------------------------

async function createUsernameFromEmail(ctx, email) {
  const at = email.indexOf('@');
  const localPart = at > 0 ? email.slice(0, at) : 'user';
  // Note the order: PHP stripped disallowed characters before lower-casing, so
  // uppercase letters were dropped rather than folded. Preserved deliberately —
  // changing it would generate different usernames than every existing account.
  const local = localPart.replace(/[^a-z0-9._-]+/g, '').toLowerCase();
  let base = local.replace(/^[._-]+/, '').replace(/[._-]+$/, '');
  if (base === '') base = 'user';
  base = base.slice(0, 24);

  let candidate = base;
  let counter = 1;
  while (await ctx.db.usernameExists(candidate)) {
    const suffix = String(counter);
    candidate = base.slice(0, Math.max(1, 32 - suffix.length)) + suffix;
    counter += 1;
  }

  return candidate;
}

function resolveRegistrationUsername(ctx, identifier, email) {
  return email !== '' ? createUsernameFromEmail(ctx, email) : identifier;
}

// ---------------------------------------------------------------------------
// Password reset mail
// ---------------------------------------------------------------------------

function buildResetUrl(ctx, token) {
  let baseUrl = str(ctx.env.APP_URL ?? '').trim();
  if (baseUrl === '') {
    const vercelUrl = str(ctx.env.VERCEL_PROJECT_PRODUCTION_URL ?? ctx.env.VERCEL_URL ?? '').trim();
    if (vercelUrl !== '') baseUrl = `https://${vercelUrl}`;
  }
  if (baseUrl === '') {
    const host = str(ctx.headers.host ?? '').trim();
    if (host !== '') baseUrl = `${ctx.secure ? 'https' : 'http'}://${host}`;
  }
  if (baseUrl === '') return `?reset=${encodeURIComponent(token)}`;

  return `${baseUrl.replace(/\/+$/, '')}/?reset=${encodeURIComponent(token)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]
  ));
}

async function sendPasswordResetEmail(ctx, email, resetUrl, username) {
  const apiKey = str(ctx.env.RESEND_API_KEY ?? '').trim();
  const fromAddress = str(ctx.env.MAIL_FROM ?? '').trim();
  // PHP fell back to the container's mail(); a Vercel function has no MTA, so
  // without Resend configured no mail goes out. The response is identical
  // either way, which is what keeps the endpoint from confirming addresses.
  if (apiKey === '' || fromAddress === '') return false;

  const safeUsername = username !== '' ? username : 'trader';
  const fromName = str(ctx.env.MAIL_FROM_NAME ?? '').trim();

  const text = [
    `Hello ${safeUsername},`,
    '',
    'A password reset was requested for your Trader Journal account.',
    'Open the link below to set a new password:',
    resetUrl,
    '',
    'This link expires in 60 minutes.',
    'If you did not request this, you can ignore this email.',
  ].join('\r\n');

  const html = [
    `<p>Hello ${escapeHtml(safeUsername)},</p>`,
    '<p>A password reset was requested for your Trader Journal account.</p>',
    `<p><a href="${escapeHtml(resetUrl)}">Open your reset link</a></p>`,
    '<p>This link expires in 60 minutes. If you did not request this, you can ignore this email.</p>',
  ].join('');

  try {
    const response = await ctx.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromName !== '' ? `${fromName} <${fromAddress}>` : fromAddress,
        to: [email],
        subject: 'Trader Journal password reset',
        text,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch (error) {
    console.error('Password reset email failed:', error.message);
    return false;
  }
}

async function ensurePasswordResetRequest(ctx, email) {
  const user = await ctx.db.findUserByIdentifier(email);
  // No account, or an account with no address to mail — either way the caller
  // still gets the same "if the email exists" answer.
  if (user === null || str(user.email ?? '') === '') return;

  const token = newResetToken();
  await ctx.db.createPasswordResetRequest({ email, userId: user.id, tokenHash: sha256Hex(token) });
  await sendPasswordResetEmail(ctx, email, buildResetUrl(ctx, token), str(user.username));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const actions = {
  async session(ctx) {
    const username = currentUsername(ctx);
    const isAdmin = username !== null ? await isAdminUsername(ctx, username) : false;
    const { csrf, cookie } = issueSessionCookie(ctx, {
      username: username ?? '',
      userId: ctx.session?.userId ?? null,
    });

    respond(200, {
      ok: true,
      authenticated: username !== null,
      username,
      isAdmin,
      csrfToken: csrf,
    }, cookie);
  },

  async register(ctx) {
    requireMethod(ctx, 'POST');
    const { identifier, password, email } = readCredentials(ctx, true);
    await assertNotRateLimited(ctx, 'register');

    const username = await resolveRegistrationUsername(ctx, identifier, email);
    const passwordHash = await hashPassword(password);

    let userId;
    try {
      userId = await ctx.db.createAccount({
        username,
        email,
        passwordHash,
        defaults: journalDefaults(),
      });
    } catch (error) {
      if (error instanceof UniqueViolation) {
        await logEvent(ctx, { userId: null, username, eventType: 'register', success: false });
        respond(409, { ok: false, error: 'Account already exists for that username or email.' });
      }
      throw error;
    }

    // Fresh CSRF token, not the pre-login one. PHP carried $_SESSION across
    // session_regenerate_id(), which meant a token planted before login stayed
    // valid after it; a new token on every privilege change closes that.
    const { csrf, cookie } = issueSessionCookie(ctx, {
      username,
      userId,
      csrf: newCsrfToken(),
      rem: wantsRemember(ctx),
    });
    await logEvent(ctx, { userId, username, eventType: 'register', success: true });

    respond(200, {
      ok: true,
      username,
      isAdmin: await isAdminUsername(ctx, username),
      csrfToken: csrf,
    }, cookie);
  },

  async login(ctx) {
    requireMethod(ctx, 'POST');
    const { identifier, password } = readCredentials(ctx, false);
    await assertNotRateLimited(ctx, 'login', identifier);

    const user = await ctx.db.findUserByIdentifier(identifier);
    // bcryptjs reads the `$2y$` prefix PHP wrote, so every existing password
    // still verifies against the hash already in the row.
    const verified = user !== null && await bcrypt.compare(password, user.passwordHash);
    if (!verified) {
      await logEvent(ctx, {
        userId: user?.id ?? null,
        username: identifier,
        eventType: 'login',
        success: false,
      });
      respond(401, { ok: false, error: 'Invalid username or password.' });
    }

    // New CSRF token on the privilege change — see the note in register().
    const { csrf, cookie } = issueSessionCookie(ctx, {
      username: user.username,
      userId: user.id,
      csrf: newCsrfToken(),
      rem: wantsRemember(ctx),
    });

    await ctx.db.ensureJournalDataRow(user.id, journalDefaults());
    await logEvent(ctx, { userId: user.id, username: user.username, eventType: 'login', success: true });

    respond(200, {
      ok: true,
      username: user.username,
      isAdmin: await isAdminUsername(ctx, user.username),
      csrfToken: csrf,
    }, cookie);
  },

  async forgot_password(ctx) {
    requireMethod(ctx, 'POST');
    const decoded = readJsonBody(ctx);
    const email = str(decoded.email ?? '').trim().toLowerCase();
    if (email === '' || !isEmail(email)) {
      respond(422, { ok: false, error: 'Enter a valid email address.' });
    }

    await assertNotRateLimited(ctx, 'forgot', email);
    // Every request counts against the limit — the failure row is the counter.
    await logEvent(ctx, { userId: null, username: email, eventType: 'forgot', success: false });

    await ensurePasswordResetRequest(ctx, email);
    // Deliberately identical whether or not the account exists, and the reset
    // URL is never echoed back.
    respond(200, { ok: true, message: 'If the email exists, a reset link has been sent.' });
  },

  async validate_reset_token(ctx) {
    const token = str(ctx.query.token ?? '').trim();
    if (token === '') {
      respond(422, { ok: false, error: 'Reset token is required.' });
    }

    await assertNotRateLimited(ctx, 'reset');
    const request = await ctx.db.findActiveResetRequest(sha256Hex(token));
    if (request === null) {
      await logEvent(ctx, { userId: null, username: 'reset-token', eventType: 'reset', success: false });
      respond(422, { ok: false, error: 'Reset link is invalid or expired.' });
    }

    respond(200, { ok: true, valid: true });
  },

  async reset_password(ctx) {
    requireMethod(ctx, 'POST');
    const decoded = readJsonBody(ctx);
    const token = str(decoded.token ?? '').trim();
    const password = decoded.password !== undefined && decoded.password !== null ? str(decoded.password) : '';

    if (token === '') {
      respond(422, { ok: false, error: 'Reset token is required.' });
    }
    if (Buffer.byteLength(password, 'utf8') < 8) {
      respond(422, { ok: false, error: 'Password must be at least 8 characters.' });
    }

    await assertNotRateLimited(ctx, 'reset');

    const request = await ctx.db.findActiveResetRequest(sha256Hex(token));
    if (request === null) {
      await logEvent(ctx, { userId: null, username: 'reset-token', eventType: 'reset', success: false });
      respond(422, { ok: false, error: 'Reset link is invalid or expired.' });
    }

    const userId = Number(request.user_id);
    await ctx.db.applyPasswordReset({
      requestId: Number(request.id),
      userId,
      passwordHash: await hashPassword(password),
    });

    // The PHP logged nothing on a successful reset, which left every session
    // opened with the old password still live. This row is both the missing
    // audit entry and the signal that revokes those cookies. It records
    // success=true, so it never counts toward the reset rate limit.
    await logEvent(ctx, {
      userId,
      username: str(request.username ?? ''),
      eventType: 'reset',
      success: true,
    });

    respond(200, { ok: true, message: 'Password updated. You can log in now.' });
  },

  async logout(ctx) {
    requireMethod(ctx, 'POST');
    const username = currentUsername(ctx);
    if (username !== null) {
      const userId = Number.isInteger(ctx.session?.userId) ? ctx.session.userId : null;
      await logEvent(ctx, { userId, username, eventType: 'logout', success: true });
    }

    respond(200, { ok: true }, serializeClearedCookie({ secure: ctx.secure }));
  },

  async save(ctx) {
    requireMethod(ctx, 'POST');
    const auth = await requireAuth(ctx);
    const decoded = readJsonBody(ctx);

    await ctx.db.saveJournalData(auth.id, {
      settings: sanitizeSettings(decoded.settings ?? {}),
      trades: sanitizeArray(decoded.trades ?? []),
      reflections: sanitizeArray(decoded.reflections ?? []),
      replayNotes: sanitizeReplayNotes(decoded.replayNotes ?? {}),
    });

    respond(200, { ok: true, message: 'Journal data saved.', updatedAt: new Date().toISOString() });
  },

  async load(ctx) {
    const auth = await requireAuth(ctx);
    const data = await ctx.db.loadJournalData(auth.id, journalDefaults());
    respond(200, { ok: true, data });
  },

  async recent_trades(ctx) {
    const auth = await requireAuth(ctx);
    respond(200, { ok: true, trades: await ctx.db.listRecentTrades(auth.id) });
  },

  async public_recent_trades(ctx) {
    const userId = await resolvePublicRecentTradesUserId(ctx);
    const trades = userId !== null ? await ctx.db.listRecentTrades(userId) : [];

    // The landing page tape is unauthenticated, so it gets a whitelist rather
    // than a redaction: fields built by hand, capped at twenty rows. The feed
    // owner chose to publish entry/stop/target alongside symbol and result —
    // it is their own journal on display. Size, P&L amounts and trade ids
    // still cannot leave through here even if the stored trade grows fields.
    respond(200, {
      ok: true,
      trades: trades.slice(0, PUBLIC_TRADES_LIMIT).map((trade) => ({
        symbol: trade.symbol,
        date: trade.date,
        direction: trade.direction,
        status: trade.status,
        entry_price: trade.entry_price,
        stop_loss: trade.stop_loss,
        take_profit: trade.take_profit,
        result: trade.status === 'closed'
          ? (trade.profit_loss > 0 ? 'win' : (trade.profit_loss < 0 ? 'loss' : 'flat'))
          : '',
      })),
    });
  },

  async live_prices(ctx) {
    const raw = ctx.query.symbols ?? '';
    const symbols = Array.isArray(raw) ? raw : String(raw).split(',');
    respond(200, { ok: true, prices: await fetchLivePrices(ctx.db, symbols, ctx.fetch) });
  },

  async update_prices(ctx) {
    requireMethod(ctx, 'POST');
    await requireAuth(ctx);
    const decoded = readJsonBody(ctx);
    const prices = Array.isArray(decoded.prices) ? decoded.prices : [];
    respond(200, { ok: true, updated: await ctx.db.upsertSymbolPrices(prices) });
  },

  async login_logs(ctx) {
    const auth = await requireAuth(ctx);
    await requireAdmin(ctx, auth);
    respond(200, { ok: true, logs: await ctx.db.listAdminLoginEvents() });
  },

  async users_admin(ctx) {
    const auth = await requireAuth(ctx);
    await requireAdmin(ctx, auth);
    respond(200, { ok: true, users: await ctx.db.listAdminUsers() });
  },
};

async function resolvePublicRecentTradesUserId(ctx) {
  const configuredId = str(ctx.env.PUBLIC_RECENT_TRADES_USER_ID ?? '').trim();
  if (/^\d+$/.test(configuredId) && Number(configuredId) > 0) return Number(configuredId);

  const identifier = str(ctx.env.PUBLIC_RECENT_TRADES_USERNAME ?? '').trim().toLowerCase();
  if (identifier === '') return null;

  const user = await ctx.db.findUserByIdentifier(identifier);
  return user !== null ? user.id : null;
}

export const ACTION_NAMES = Object.freeze(Object.keys(actions));

// Entry point. Always settles by throwing a Respond — including for unknown
// actions — so the handler has exactly one shape to serialise.
export async function route(ctx) {
  // Before anything reads the session, check it has not been revoked.
  await assertSessionNotRevoked(ctx);

  // Every state-changing POST carries the CSRF token, except the four
  // pre-session actions, which have no session to hold a token yet and are
  // guarded by the DB-backed rate limit instead.
  if (ctx.method === 'POST' && !CSRF_EXEMPT_ACTIONS.has(ctx.action)) {
    requireCsrfToken(ctx);
  }

  const action = Object.prototype.hasOwnProperty.call(actions, ctx.action) ? actions[ctx.action] : null;
  if (action === null) {
    respond(400, { ok: false, error: 'Unknown action.' });
  }

  await action(ctx);
  respond(400, { ok: false, error: 'Unknown action.' });
}
