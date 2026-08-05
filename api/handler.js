// Vercel serverless entry point for the whole API.
//
// vercel.json rewrites /trade_handler.php here, so the front-end keeps calling
// `trade_handler.php?action=…` exactly as it did against PHP — app.js and
// src/modules/livePrices.js are untouched by this port.
//
// This file does the HTTP plumbing only: read the request, build a ctx, hand it
// to the router, serialise whatever comes back. All behaviour lives in _lib.

import net from 'node:net';
import { createDb, createPool } from './_lib/db.js';
import { decodeSession, parseCookies, resolveSessionSecret, COOKIE_NAME } from './_lib/session.js';
import { Respond, route } from './_lib/router.js';

// One pool per warm instance. No schema step: the port issues no DDL at all —
// db/schema.sql sets a new database up once, by hand.
function boot(env) {
  return createDb(createPool(env));
}

async function readRawBody(req) {
  // The Vercel Node runtime may have already parsed and consumed the stream.
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Only a syntactically valid IP may be written — the column is `inet` and a
// spoofed X-Forwarded-For value would otherwise abort the insert.
function clientIpAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '');
  const candidate = forwarded.split(',')[0].trim();
  if (candidate !== '' && net.isIP(candidate)) return candidate;

  const real = String(req.headers['x-real-ip'] ?? '').trim();
  if (real !== '' && net.isIP(real)) return real;

  const remote = String(req.socket?.remoteAddress ?? '').trim();
  return remote !== '' && net.isIP(remote) ? remote : null;
}

// Plain node response API rather than Vercel's res.status().json() helpers, so
// the same function runs unchanged under `vercel dev` or any bare node server.
function send(res, status, payload, cookie) {
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Authenticated journal data must never sit in a shared cache.
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  const env = process.env;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const secure = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase() === 'https';

  let db;
  try {
    db = await boot(env);
  } catch (error) {
    // Details to the log only — the client gets the same message PHP sent.
    console.error('Database initialization failed:', error.message);
    send(res, 500, { ok: false, error: 'Database initialization failed. Check DATABASE_URL and table schema.' });
    return;
  }

  try {
    const secret = resolveSessionSecret(env);
    const cookies = parseCookies(req.headers.cookie);

    await route({
      action: url.searchParams.get('action') ?? 'load',
      method: req.method,
      query: Object.fromEntries(url.searchParams),
      rawBody: req.method === 'GET' || req.method === 'HEAD' ? '' : await readRawBody(req),
      headers: req.headers,
      env,
      db,
      secret,
      secure,
      session: decodeSession(cookies[COOKIE_NAME], secret),
      ip: clientIpAddress(req),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 500),
      fetch: globalThis.fetch,
    });
  } catch (error) {
    if (error instanceof Respond) {
      send(res, error.status, error.payload, error.cookie);
      return;
    }

    console.error('Server operation failed:', error?.stack ?? error);

    // A database that cannot be reached or authenticated against is by far the
    // likeliest deploy-time misconfiguration, so it keeps the message PHP used.
    // The code is a class of failure, never a detail of one.
    const dbFailure = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', '28P01', '28000', '3D000', '57P03'];
    if (dbFailure.includes(error?.code)) {
      send(res, 500, { ok: false, error: 'Database initialization failed. Check DATABASE_URL and table schema.' });
      return;
    }

    send(res, 500, { ok: false, error: 'Server operation failed.' });
  }
}
