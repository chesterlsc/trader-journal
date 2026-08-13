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
// BITCOIN IS NOT CONJUNCTIVE, AND THAT IS THE POINT. The conjunction above is a
// relevance filter for GOLD's polysemy and nothing else. Bitcoin has none:
// sampled 100 live articles on the bare query and 75 were market or policy
// relevant, 2 promotional, the rest genuine bitcoin coverage, against 26% for a
// bare gold query.
//
// The conjunctive bitcoin query that shipped first was starved by it. 65 of its
// 165 hourly buckets were ZERO, 39.4% against gold's 7.2%, which tripped the
// sparsity gate in src/lib/newsEdge.js and produced no reading at all. Dropping
// the conjunction cut the holes to 12.7% and the p99 from 24.53 to 7.50. Both
// captures are committed, the rejected one as gdelt-bitcoin-conjunctive.json,
// because it is the evidence for the gate.
//
// EVERY ASSET CARRIES ITS OWN BANDS, measured on its own capture, because a
// percentile only means anything against the distribution it came from.
// Lending bitcoin gold's numbers fires "heavy" on 7% of its hours, not 1%.
//
// DO NOT "improve" a query without recapturing and recomputing its bands: the
// reading is relative to that query's own seven day history, so a change
// silently rebases the ratio, makes every stored reading incomparable, AND
// invalidates the three numbers sitting next to it.
export const NEWS_ASSETS = [
  // p25 0.74, p90 2.30, p99 3.44 over 166 complete buckets, 7.2% zero.
  { id: 'gold', label: 'GOLD', symbol: 'XAUUSD',
    query: '(gold OR bullion) (fed OR inflation OR "interest rate" OR dollar OR "safe haven") sourcelang:eng',
    bands: { quiet: 0.75, elevated: 2.3, heavy: 3.45 } },
  // p25 0.63, p90 2.75, p99 7.50 over 165 complete buckets, 12.7% zero.
  { id: 'btc', label: 'BITCOIN', symbol: 'BTCUSDT',
    query: 'bitcoin sourcelang:eng',
    bands: { quiet: 0.63, elevated: 2.75, heavy: 7.5 } },
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
    // Both pulls inside ONE claim, so the limiter sees a single burst every
    // 1800s rather than two independent callers. Sequential, not concurrent,
    // for the same reason: two simultaneous requests is exactly the shape that
    // gets an egress IP throttled.
    const reading = await pullVolume(fetchImpl, target);
    const headlines = await pullHeadlines(fetchImpl, target);
    try {
      if (reading !== null) {
        snapshot = {
          ...snapshot,
          // Headlines are kept from the PREVIOUS cycle when this one's artlist
          // call was refused, because a stale headline is worth more than a
          // blank space and it carries its own timestamp to be judged by.
          [target.id]: {
            ...reading,
            headlines: headlines ?? snapshot[target.id]?.headlines ?? [],
            at: now.getTime(),
          },
        };
        await db.writeFeedPayload(FEED_SOURCE, snapshot);
        await db.markFeedSuccess(FEED_SOURCE, `ok:${target.id}${headlines === null ? ':nohl' : ''}`);
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
        headlines: Array.isArray(row?.headlines) ? row.headlines : [],
        through: row?.through ?? null,
        stale: !row || now.getTime() - Number(row.at ?? 0) > STALE_AFTER_MS,
      };
    }),
    asOf: newest > 0 ? new Date(newest).toISOString() : null,
    stale: newest === 0 || now.getTime() - newest > STALE_AFTER_MS,
  };
}

// HEADLINES: the honest stand-in for a broadcast transcript.
//
// The wall shows live TV and the obvious next question is "what are they
// SAYING". A cross-origin iframe cannot answer it: no browser API exposes an
// embedded player's audio, caption track or DOM to the parent page, and doing
// it server-side would mean re-encoding someone's broadcast, which contradicts
// the wall's own "nothing is stored or rebroadcast" promise.
//
// So: what the PRESS is publishing on the same query, right now. It is not the
// anchor's words, and the pane never pretends it is. It is better in three ways
// that matter here: it is attributable, it is linkable, and it is the same
// corpus the ratio above is computed from, so the headline and the number are
// measuring one thing rather than two.
//
// Titles and sources only, never article bodies.
const HEADLINE_COUNT = 3;

async function pullHeadlines(fetchImpl, asset) {
  try {
    const url = `${GDELT_URL}?query=${encodeURIComponent(asset.query)}` +
      // NO sort param, deliberately. GDELT's default for artlist is its own
      // relevance ordering, which is the one I verified returns usable
      // headlines; sort=datedesc on the same query returned an Amex Gold Card
      // ad and a coin auction, because most-recent is not most-relevant. An
      // explicit sort value is also one more thing the API can reject, and a
      // rejection here is silent: it soft-fails to no headlines at all.
      '&mode=artlist&maxrecords=8&timespan=12h&format=json';
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'TraderJournal/1.0 (+https://www.traderjournal.space)' },
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    // artlist is rate limited too, just more permissively than timelinevol, and
    // it refuses the same way: HTTP 200 carrying prose. Same sniff, and headline
    // failure must never cost the reading, which is why this is a separate
    // soft-fail rather than part of pullVolume.
    if (!response.ok || !text.trimStart().startsWith('{')) return null;
    const rows = JSON.parse(text)?.articles;
    if (!Array.isArray(rows)) return null;
    const headlines = rows
      .map((row) => ({
        // GDELT pads punctuation, so a title arrives as "Fed path ." and
        // "50 %". Collapse the runs, then close the gap before punctuation.
        title: String(row?.title ?? '')
          .replace(/\s+/g, ' ')
          .replace(/\s+([.,;:!?%'’)\]])/g, '$1')
          .replace(/([(\[‘])\s+/g, '$1')
          .trim()
          .slice(0, 160),
        domain: String(row?.domain ?? '').trim().slice(0, 60),
        url: String(row?.url ?? '').trim().slice(0, 400),
        at: String(row?.seendate ?? '').trim().slice(0, 20),
      }))
      .filter((h) => h.title !== '' && /^https?:\/\//.test(h.url))
      .slice(0, HEADLINE_COUNT);
    return headlines.length === 0 ? null : headlines;
  } catch { return null; }
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
    const read = coverageRead(parseTimeline(JSON.parse(text)), asset.bands);
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