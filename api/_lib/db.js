// PostgreSQL layer. Every statement here is the same SQL trade_handler.php ran,
// so it reads and writes the existing Railway database unchanged: same tables,
// same columns, same JSONB shapes. No column is dropped, retyped or renamed.
//
// The router never touches this module directly — it receives whatever object
// `createDb` returns. That is the seam the tests use to run the whole router
// with a hand-written fake and no database at all.

import pg from 'pg';
import {
  collectTradeScreenshots,
  compareRecentTrades,
  isNumeric,
  mergeTradeScreenshots,
  sanitizeArray,
  sanitizeReplayNotes,
  sanitizeSettings,
  sanitizeTradesPayload,
  str,
  stripTradeScreenshotsFromTrades,
  toRecentTradeRow,
} from './sanitize.js';

export class UniqueViolation extends Error {}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

// PHP read a list of candidate env names because Railway injects several. Kept,
// minus the Railway-private ones: a Vercel function lives outside Railway's
// network and can only reach the database over its public URL.
const URL_ENV_NAMES = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRESQL_URL', 'DATABASE_PUBLIC_URL'];

export function sanitizeConnectionString(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed === '') return '';

  const unquoted = trimmed.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  // An unexpanded "${...}" placeholder or an "<paste here>" template is a
  // misconfiguration, not a connection string.
  if (unquoted.includes('${') || unquoted.includes('<')) return '';

  return unquoted;
}

export function resolveConnectionString(env) {
  for (const name of URL_ENV_NAMES) {
    const url = sanitizeConnectionString(env[name]);
    if (url !== '') return url;
  }
  return '';
}

// libpq's "prefer"/"require" (what the PHP used) encrypt without validating the
// certificate chain, so rejectUnauthorized:false is parity, not a downgrade.
// Ask for verify-full in the URL to get real chain validation.
export function resolveSslOption(connectionString, env) {
  let sslmode = '';
  try {
    sslmode = new URL(connectionString).searchParams.get('sslmode') ?? '';
  } catch {
    sslmode = '';
  }
  if (sslmode === '') sslmode = String(env.PGSSLMODE ?? '').trim();

  if (sslmode === 'disable') return false;
  if (sslmode === 'verify-full' || sslmode === 'verify-ca') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

// Cached on globalThis, not in a module variable: bundling can leave more than
// one copy of a module in a function, and each copy would otherwise open its own
// pool against the database.
const POOL_KEY = Symbol.for('traderJournal.pgPool');

export function createPool(env) {
  if (globalThis[POOL_KEY]) return globalThis[POOL_KEY];

  const connectionString = resolveConnectionString(env);
  if (connectionString === '') {
    throw new Error('Missing DB env vars. Set DATABASE_URL on the Vercel project.');
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: resolveSslOption(connectionString, env),
    // One socket per warm function instance. Serverless scales by process, so
    // a larger pool per instance only multiplies connections against Postgres.
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  // A pool that emits 'error' with no listener takes the process down.
  pool.on('error', (error) => console.error('pg pool error:', error.message));

  globalThis[POOL_KEY] = pool;
  return pool;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
//
// There is deliberately none. The PHP re-ran ~30 CREATE TABLE IF NOT EXISTS /
// ADD COLUMN IF NOT EXISTS statements on every single request; this module
// issues no DDL at all, ever. The live database already matches db/schema.sql,
// and the strongest data-safety guarantee available is that the new code
// *cannot* alter it — no DROP, no ALTER, no CREATE, not even a guarded one.
//
// A brand-new database is set up once, by hand, with db/schema.sql. That is a
// deployment step, not something a request handler should be doing.

// ---------------------------------------------------------------------------
// Query layer
// ---------------------------------------------------------------------------

export function createDb(pgPool) {
  const query = (text, params) => pgPool.query(text, params);

  // Runs fn against a single checked-out client inside a transaction.
  async function transaction(fn) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn((text, params) => client.query(text, params));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch { /* the connection is already gone; the original error matters */ }
      throw error;
    } finally {
      client.release();
    }
  }

  // Both journal tables plus the screenshot side-table, written together so a
  // half-saved journal can never be observed.
  async function writeJournalData(run, userId, payload) {
    const sanitizedTrades = sanitizeTradesPayload(payload.trades ?? []);
    const settingsJson = JSON.stringify(sanitizeSettings(payload.settings ?? {}));
    const tradesJson = JSON.stringify(stripTradeScreenshotsFromTrades(sanitizedTrades));
    const reflectionsJson = JSON.stringify(sanitizeArray(payload.reflections ?? []));
    const replayNotesJson = JSON.stringify(sanitizeReplayNotes(payload.replayNotes ?? {}));

    const notes = await run(
      `UPDATE journal_notes
         SET settings = CAST($2 AS jsonb),
             reflections = CAST($3 AS jsonb),
             replay_notes = CAST($4 AS jsonb),
             updated_at = NOW()
       WHERE user_id = $1`,
      [userId, settingsJson, reflectionsJson, replayNotesJson],
    );
    if (notes.rowCount === 0) {
      await run(
        `INSERT INTO journal_notes (user_id, settings, reflections, replay_notes, updated_at)
         VALUES ($1, CAST($2 AS jsonb), CAST($3 AS jsonb), CAST($4 AS jsonb), NOW())`,
        [userId, settingsJson, reflectionsJson, replayNotesJson],
      );
    }

    const trades = await run(
      `UPDATE trades SET payload = CAST($2 AS jsonb), updated_at = NOW() WHERE user_id = $1`,
      [userId, tradesJson],
    );
    if (trades.rowCount === 0) {
      await run(
        `INSERT INTO trades (user_id, payload, updated_at) VALUES ($1, CAST($2 AS jsonb), NOW())`,
        [userId, tradesJson],
      );
    }

    await run('DELETE FROM trade_screenshots WHERE user_id = $1', [userId]);
    for (const shot of collectTradeScreenshots(sanitizedTrades)) {
      await run(
        `INSERT INTO trade_screenshots (user_id, trade_id, screenshot_name, screenshot_data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [userId, shot.tradeId, shot.screenshotName, shot.screenshotData],
      );
    }
  }

  async function readTradesPayload(userId) {
    const { rows } = await query('SELECT payload::text AS payload FROM trades WHERE user_id = $1 LIMIT 1', [userId]);
    if (rows.length === 0) return null;
    try {
      return JSON.parse(rows[0].payload ?? 'null');
    } catch {
      return null;
    }
  }

  let bootstrapAdmin;

  return {
    // Session revocation without a sessions table. PHP destroyed the server-side
    // session on logout; a signed cookie has no server state to destroy, so the
    // audit trail already in login_info stands in for it: a cookie minted before
    // the user's most recent successful logout or password reset is refused.
    // Keyed on username because idx_login_info_username already exists — this
    // adds no schema and no index.
    async latestSessionInvalidation(username) {
      const { rows } = await query(
        `SELECT EXTRACT(EPOCH FROM MAX(created_at))::bigint AS at
           FROM login_info
          WHERE username = $1
            AND success = TRUE
            AND event_type IN ('logout', 'reset')`,
        [str(username).trim().toLowerCase().slice(0, 32)],
      );
      const at = rows[0]?.at;
      return at === null || at === undefined ? null : Number(at);
    },

    async findUserByIdentifier(identifier) {
      const { rows } = await query(
        `SELECT id, username, email, auth_provider, password_hash
           FROM journal_users
          WHERE username = $1 OR email = $1
          LIMIT 1`,
        [identifier],
      );
      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        id: Number(row.id),
        username: str(row.username),
        email: str(row.email ?? ''),
        provider: str(row.auth_provider ?? 'email'),
        passwordHash: str(row.password_hash),
      };
    },

    async usernameExists(candidate) {
      const { rows } = await query(
        'SELECT 1 FROM journal_users WHERE username = $1 OR email = $1 LIMIT 1',
        [candidate],
      );
      return rows.length > 0;
    },

    async createAccount({ username, email, passwordHash, defaults }) {
      try {
        return await transaction(async (run) => {
          const { rows } = await run(
            `INSERT INTO journal_users (username, email, auth_provider, password_hash)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [username, email !== '' ? email : null, 'email', passwordHash],
          );
          const userId = Number(rows[0]?.id ?? 0);
          if (!(userId > 0)) throw new Error('Failed to create account id.');

          await writeJournalData(run, userId, defaults);
          return userId;
        });
      } catch (error) {
        if (error?.code === '23505') throw new UniqueViolation('Account already exists.');
        throw error;
      }
    },

    async saveJournalData(userId, payload) {
      await transaction((run) => writeJournalData(run, userId, payload));
    },

    async ensureJournalDataRow(userId, defaults) {
      const notes = await query('SELECT user_id FROM journal_notes WHERE user_id = $1 LIMIT 1', [userId]);
      const trades = await query('SELECT user_id FROM trades WHERE user_id = $1 LIMIT 1', [userId]);
      if (notes.rows.length > 0 && trades.rows.length > 0) return;

      await transaction((run) => writeJournalData(run, userId, defaults));
    },

    async loadJournalData(userId, defaults) {
      const notes = await query(
        `SELECT settings::text AS settings, reflections::text AS reflections, replay_notes::text AS replay_notes
           FROM journal_notes WHERE user_id = $1 LIMIT 1`,
        [userId],
      );
      const trades = await query('SELECT payload::text AS payload FROM trades WHERE user_id = $1 LIMIT 1', [userId]);

      if (notes.rows.length === 0 && trades.rows.length === 0) {
        await transaction((run) => writeJournalData(run, userId, defaults));
        return defaults;
      }

      const parse = (text) => {
        try {
          return JSON.parse(text ?? 'null');
        } catch {
          return null;
        }
      };
      const notesRow = notes.rows[0] ?? {};
      const tradeList = sanitizeTradesPayload(parse(trades.rows[0]?.payload) ?? []);

      const shots = await query(
        `SELECT trade_id, screenshot_name, screenshot_data
           FROM trade_screenshots WHERE user_id = $1
          ORDER BY updated_at DESC, id DESC`,
        [userId],
      );
      const screenshots = {};
      for (const row of shots.rows) {
        const tradeId = str(row.trade_id ?? '').trim();
        if (tradeId === '' || tradeId in screenshots) continue;
        screenshots[tradeId] = {
          screenshotName: str(row.screenshot_name ?? ''),
          screenshotData: str(row.screenshot_data ?? ''),
        };
      }

      return {
        settings: sanitizeSettings(parse(notesRow.settings) ?? {}),
        trades: mergeTradeScreenshots(tradeList, screenshots),
        reflections: sanitizeArray(parse(notesRow.reflections)),
        replayNotes: sanitizeReplayNotes(parse(notesRow.replay_notes)),
      };
    },

    async listRecentTrades(userId) {
      const payload = await readTradesPayload(userId);
      if (payload === null) return [];

      const trades = sanitizeTradesPayload(payload);
      trades.sort(compareRecentTrades);
      return trades.map(toRecentTradeRow);
    },

    // DB-backed rate limit: failures for this IP (and username, when the action
    // has one) inside the sliding 10 minute window. login_info doubles as the
    // counter store, exactly as the PHP had it.
    async countRecentFailures({ eventType, ip, username = '' }) {
      const params = [eventType, ip ?? null];
      let sql = `SELECT COUNT(*)::int AS failures
                   FROM login_info
                  WHERE event_type = $1
                    AND success = FALSE
                    AND created_at > NOW() - INTERVAL '10 minutes'
                    AND ip_address IS NOT DISTINCT FROM CAST($2 AS inet)`;
      if (username !== '') {
        params.push(username.trim().toLowerCase().slice(0, 32));
        sql += ` AND username = $3`;
      }

      const { rows } = await query(sql, params);
      return Number(rows[0]?.failures ?? 0);
    },

    async logLoginEvent({ userId, username, eventType, success, ip, userAgent }) {
      await query(
        `INSERT INTO login_info (user_id, username, event_type, success, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, CAST($5 AS inet), $6)`,
        [
          userId ?? null,
          str(username).trim().toLowerCase().slice(0, 32),
          str(eventType).slice(0, 24),
          Boolean(success),
          ip ?? null,
          userAgent ?? '',
        ],
      );
    },

    async createPasswordResetRequest({ email, userId, tokenHash }) {
      await query(
        `INSERT INTO password_reset_requests (email, user_id, token_hash, requested_at, expires_at, used_at)
         VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '60 minutes', NULL)`,
        [email, userId, tokenHash],
      );
    },

    // The username comes along so a successful reset can be written to
    // login_info, which is what revokes any session still holding the old
    // password's cookie.
    async findActiveResetRequest(tokenHash) {
      const { rows } = await query(
        `SELECT r.id, r.user_id, COALESCE(u.username, '') AS username
           FROM password_reset_requests r
           LEFT JOIN journal_users u ON u.id = r.user_id
          WHERE r.token_hash = $1
            AND r.used_at IS NULL
            AND r.expires_at IS NOT NULL
            AND r.expires_at > NOW()
          ORDER BY r.requested_at DESC
          LIMIT 1`,
        [tokenHash],
      );
      return rows[0] ?? null;
    },

    async applyPasswordReset({ requestId, userId, passwordHash }) {
      await transaction(async (run) => {
        await run('UPDATE journal_users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
        await run('UPDATE password_reset_requests SET used_at = NOW() WHERE id = $1', [requestId]);
        // Any other live reset link for this account dies with it.
        await run(
          'UPDATE password_reset_requests SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL AND id <> $2',
          [userId, requestId],
        );
      });
    },

    async upsertSymbolPrices(entries) {
      let updated = 0;
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;

        const symbol = str(entry.symbol ?? '').trim().toUpperCase();
        const price = entry.price;
        if (symbol === '' || !/^[A-Z0-9._=-]{2,24}$/.test(symbol) || !isNumeric(price)) continue;

        const priceValue = Number(price);
        if (!(priceValue > 0)) continue;

        await query(
          `INSERT INTO symbol_prices (symbol, price, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (symbol) DO UPDATE SET price = EXCLUDED.price, updated_at = NOW()`,
          [symbol, priceValue],
        );
        updated += 1;
      }
      return updated;
    },

    async loadCachedSymbolPrices(symbols) {
      if (symbols.length === 0) return {};

      const { rows } = await query('SELECT symbol, price FROM symbol_prices WHERE symbol = ANY($1::text[])', [symbols]);
      const result = {};
      for (const row of rows) {
        const symbol = str(row.symbol ?? '').trim().toUpperCase();
        if (symbol !== '' && isNumeric(row.price) && Number(row.price) > 0) {
          result[symbol] = Number(row.price);
        }
      }
      return result;
    },

    async firstRegisteredUsername() {
      if (bootstrapAdmin !== undefined) return bootstrapAdmin;

      const { rows } = await query('SELECT username FROM journal_users ORDER BY created_at ASC, id ASC LIMIT 1');
      const username = str(rows[0]?.username ?? '').trim();
      bootstrapAdmin = username === '' ? null : username.toLowerCase();
      return bootstrapAdmin;
    },

    async listAdminUsers() {
      const { rows } = await query(
        `SELECT
            u.id,
            u.username,
            u.created_at::text AS created_at,
            CASE WHEN COALESCE(u.password_hash, '') <> '' THEN 'Hashed' ELSE 'Not Set' END AS password_status,
            CASE WHEN t.payload IS NOT NULL AND jsonb_typeof(t.payload) = 'array'
                 THEN jsonb_array_length(t.payload) ELSE 0 END AS trades_count,
            CASE WHEN n.reflections IS NOT NULL AND jsonb_typeof(n.reflections) = 'array'
                 THEN jsonb_array_length(n.reflections) ELSE 0 END AS reflections_count,
            COALESCE(latest.event_type, '') AS last_event,
            COALESCE(latest.success, FALSE) AS last_success,
            COALESCE(latest.created_at::text, '') AS last_login_at,
            COALESCE(latest.user_agent, '') AS last_user_agent
         FROM journal_users u
         LEFT JOIN journal_notes n ON n.user_id = u.id
         LEFT JOIN trades t ON t.user_id = u.id
         LEFT JOIN LATERAL (
            SELECT li.event_type, li.success, li.created_at, li.user_agent
              FROM login_info li
             WHERE li.user_id = u.id OR li.username = u.username
             ORDER BY li.created_at DESC
             LIMIT 1
         ) latest ON TRUE
         ORDER BY u.created_at DESC
         LIMIT 500`,
      );
      return rows;
    },

    async listAdminLoginEvents() {
      const { rows } = await query(
        `SELECT
            id, username, event_type, success,
            COALESCE(ip_address::text, '') AS ip_address,
            COALESCE(user_agent, '') AS user_agent,
            created_at::text AS created_at
         FROM login_info
         ORDER BY created_at DESC
         LIMIT 500`,
      );
      return rows;
    },
  };
}
