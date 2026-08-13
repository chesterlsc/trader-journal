import { coverageRead, parseTimeline, NEWS_MIN_POINTS } from '../../src/lib/newsEdge.js';

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
// ponytail: reuses the seeded, unread 'mw_headlines' feed_state row rather than
// adding one, because db/schema.sql is hand-applied to a live database and this
// feature does not need a migration to exist. Rename to 'gdelt_news' the next
// time the schema is touched by hand.
const FEED_SOURCE = 'mw_headlines';
const SUCCESS_TTL_SECONDS = 1800;
const FAILURE_TTL_SECONDS = 900;
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

// CONJUNCTIVE ON PURPOSE, and measured. A bare "(gold OR bullion)" query is
// dominated by mining-company earnings, Indian gold-loan marketing and
// jewellery: of 140 top articles on a live capture, 36 were macro-relevant and
// 104 were not, including Congressional Award Gold Medals and a Karnataka
// cycling championship. That is gold-equity and gold-jewellery news, not the
// XAUUSD driver, and a ratio built on it measures the wrong world.
// BOTH queries are verified HTTP 200 and both captures are committed under
// tests/fixtures. They did not end up equal, though, and the bitcoin one is
// why src/lib/newsEdge.js grew a sparsity gate: 65 of its 165 complete hourly
// buckets are ZERO, 39.4% against gold's 7.2%, which drags the median to
// 0.0165 and turns one article in a quiet hour into a huge multiple. It
// therefore gets no ratio at all rather than a confident wrong one, and the
// pane says so in as many words.
// THE FIX FOR BITCOIN IS A WIDER QUERY, not a second set of constants tuned to
// a degenerate distribution. Requiring a macro term ALONGSIDE bitcoin is what
// makes it this thin; dropping the conjunction, or widening it to include the
// terms crypto coverage actually uses, is the thing to measure next. Recapture
// and recompute the percentiles before changing it.
//
// DO NOT "improve" these without re-measuring: the reading is relative to this
// query's own seven day history, so changing the query silently rebases the
// ratio, every stored reading becomes incomparable, AND the bands in
// src/lib/newsEdge.js are percentiles of this exact query's distribution.
export const NEWS_ASSETS = [
  { id: 'gold', label: 'GOLD', symbol: 'XAUUSD',
    query: '(gold OR bullion) (fed OR inflation OR "interest rate" OR dollar OR "safe haven") sourcelang:eng' },
  { id: 'btc', label: 'BITCOIN', symbol: 'BTCUSDT',
    query: '(bitcoin OR BTC) (fed OR inflation OR "interest rate" OR ETF OR dollar) sourcelang:eng' },
];

/** Whichever asset's stored reading is oldest. Absent beats stale. */
export function oldestAsset(snapshot, assets = NEWS_ASSETS) {
  return [...assets].sort(
    (a, b) => Number(snapshot?.[a.id]?.at ?? 0) - Number(snapshot?.[b.id]?.at ?? 0)
  )[0];
}

/** Soft-fail ingest. Never throws. */
export async function fetchNewsVolume(db, fetchImpl = fetch, now = new Date()) {
  let snapshot = null;
  try { snapshot = await db.readFeedPayload(FEED_SOURCE); } catch { snapshot = null; }
  // feed_state.payload defaults to '[]'::jsonb, an ARRAY, while this stores an
  // OBJECT. Anything that is not our object is a fresh row. Do not remove.
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) snapshot = {};

  // Before claiming, not after: the claim is an UPDATE, so with no row it
  // matches nothing and this feature would be silently dead forever rather
  // than loudly broken once.
  try { await db.ensureFeedSource?.(FEED_SOURCE); } catch { /* the claim below just fails shut */ }

  let claimed = false;
  try { claimed = await db.claimFeedFetch(FEED_SOURCE, SUCCESS_TTL_SECONDS); } catch { claimed = false; }

  if (claimed) {
    // ONE upstream call per claimed run, round-robin. Two assets at a 1800s TTL
    // refreshes each hourly, which is exactly GDELT's own resolution.
    const target = oldestAsset(snapshot);
    const reading = await pullVolume(fetchImpl, target);
    try {
      if (reading !== null) {
        snapshot = { ...snapshot, [target.id]: { ...reading, at: now.getTime() } };
        await db.writeFeedPayload(FEED_SOURCE, snapshot);
        await db.markFeedSuccess(FEED_SOURCE, `ok:${target.id}`);
      } else {
        await db.markFeedFailure(FEED_SOURCE, `empty:${target.id}`, FAILURE_TTL_SECONDS);
      }
    } catch { /* the stored row is the floor: a write failure must not fail the request */ }
  }

  const newest = Math.max(0, ...NEWS_ASSETS.map((a) => Number(snapshot[a.id]?.at ?? 0)));
  return {
    // Always every asset, in a stable order, so the pane's two rows never
    // reorder or vanish. A never-read asset arrives with ratio null, which the
    // renderer already has an empty state for.
    assets: NEWS_ASSETS.map((asset) => {
      const row = snapshot[asset.id];
      return {
        id: asset.id, label: asset.label, symbol: asset.symbol,
        ratio: row?.ratio ?? null, band: row?.band ?? 'unknown', n: row?.n ?? 0,
        // Carried through so newsLine can tell "the window is full of holes"
        // apart from "the window is not there yet". Without it the renderer
        // would have to guess, and it would guess wrong for bitcoin.
        zeroShare: row?.zeroShare ?? null,
        through: row?.through ?? null,
        stale: !row || now.getTime() - Number(row.at ?? 0) > STALE_AFTER_MS,
      };
    }),
    asOf: newest > 0 ? new Date(newest).toISOString() : null,
    stale: newest === 0 || now.getTime() - newest > STALE_AFTER_MS,
  };
}

async function pullVolume(fetchImpl, asset) {
  try {
    // ponytail: mode=timelinevol, 8KB. mode=timelinevolinfo returns the same
    // series PLUS toparts headlines in one call, but it is a 348KB response.
    // Switch to it if the pane ever needs to say what a spike is about.
    const url = `${GDELT_URL}?query=${encodeURIComponent(asset.query)}` +
      '&mode=timelinevol&timespan=7d&format=json';
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'TraderJournal/1.0 (+https://www.traderjournal.space)' },
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    // THE BODY IS THE ONLY RELIABLE TELL, the rule calendar.js already uses for
    // ForexFactory's 429 HTML page. GDELT answers a rate limit with 444 bytes of
    // plain prose beginning "Please limit requests", so JSON.parse would throw
    // rather than soft-fail. I hit this on 3 of 4 probes at TWELVE seconds of
    // spacing, because the egress IP is shared. Never refactor this into a
    // status check.
    if (!response.ok || !text.trimStart().startsWith('{')) return null;
    const read = coverageRead(parseTimeline(JSON.parse(text)));
    // STORE THE READING, NOT THE FEED: ~200 bytes instead of 8KB.
    //
    // A null ratio is NOT the same as no data, and discarding both alike was a
    // bug: bitcoin's window is complete and measured, it is simply too sparse
    // to band, and throwing it away made the pane print "needs 48 complete
    // hourly buckets, has 0" over a query that had 165 of them. That sends
    // someone away waiting for a reading that is never coming. Anything with a
    // full enough window is stored, ratio or no ratio, so the sentence can say
    // which refusal it is. Only a genuinely short window is nothing to keep.
    return read.n < NEWS_MIN_POINTS ? null : read;
  } catch { return null; }
}