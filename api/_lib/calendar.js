// Economic calendar ingest, ported to the shape api/_lib/prices.js already
// proves out: injected `db`, injected `fetchImpl`, and a dead upstream returns
// the cached rows rather than throwing. Nothing here issues DDL.
//
// SOURCE: ForexFactory's weekly XML mirror. It is keyless and free, and it is
// the only piece of the terminal that costs nothing and is exact: scheduled
// releases carry a real impact rating, a forecast and the previous print.
//
// TIMEZONE — the one fact everything downstream depends on. Feed times are UTC.
// Verified 2026-08-09 against five independent zones in a single file, which is
// what rules out every fixed-offset candidate at once:
//     USD CPI m/m          12:30pm  = 08:30 EDT  (-4)
//     AUD Cash Rate         4:30am  = 14:30 AEST (+10)
//     GBP GDP m/m           6:00am  = 07:00 BST  (+1)
//     JPY Bank Lending     11:50pm  = 08:50 JST  (+9, next day)
//     NZD Inflation Expect  3:00am  = 15:00 NZST (+12)
// Only UTC satisfies all five. America/New_York would print CPI at 8:30am and
// Europe/London at 1:30pm; both read differently, so both are dead. That means
// NO DST handling and NO Intl in the parser — Intl is for display only.
// A publisher can still change a default that a proof cannot prevent, so
// assertCalendarAnchor() below turns that into a log line instead of a silent
// multi-hour lie.

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
const FEED_SOURCE = 'ff_calendar';
const SUCCESS_TTL_SECONDS = 900;
const FAILURE_TTL_SECONDS = 300;

const MONTH_MS = 12;

// "08-12-2026" + "12:30pm" -> epoch ms UTC. Returns null for the feed's
// non-instants ("All Day", "Tentative", ""), which must never be given a
// fictional midnight deadline by a countdown.
export function parseCalendarTime(dateStr, timeStr) {
  const date = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(dateStr ?? '').trim());
  if (date === null) return null;

  const month = Number(date[1]);
  const day = Number(date[2]);
  const year = Number(date[3]);
  if (month < 1 || month > MONTH_MS || day < 1 || day > 31) return null;

  const raw = String(timeStr ?? '').trim().toLowerCase();
  const time = /^(\d{1,2}):(\d{2})(am|pm)$/.exec(raw);
  if (time === null) return null;

  // Validate BEFORE the modulo: "25:00pm" would otherwise wrap to 13:00 and
  // silently become a real instant on a countdown.
  const clockHour = Number(time[1]);
  const minute = Number(time[2]);
  if (clockHour < 1 || clockHour > 12 || minute > 59) return null;

  let hour = clockHour % 12;
  if (time[3] === 'pm') hour += 12;

  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

// The FF url carries a stable numeric family id:
//   https://www.forexfactory.com/calendar/78-us-cpi-mm -> "78-us-cpi-mm"
// Grouping on this instead of a normalised title is what makes the edge file
// survive a rewording, and it keeps "Core CPI" from ever merging into "CPI" —
// the publisher already separates them (79-us-core-cpi-mm vs 78-us-cpi-mm).
export function eventKeyFromUrl(url) {
  const match = /\/calendar\/([A-Za-z0-9-]+)/.exec(String(url ?? ''));
  return match === null ? '' : match[1];
}

function unwrap(block, tag) {
  // Titles/countries are plain text; the rest are CDATA; empty fields
  // self-close (<forecast />). One expression covers all three shapes.
  const match = new RegExp(
    `<${tag}\\s*/>|<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`
  ).exec(block);
  return match === null || match[1] === undefined ? '' : match[1].trim();
}

const IMPACTS = new Set(['High', 'Medium', 'Low', 'Holiday']);

/**
 * Pure: XML text -> normalised event rows. Never throws; a malformed block is
 * skipped rather than poisoning the batch.
 * @returns {{key,startsAt,currency,title,impact,forecast,previous,url,allDay}[]}
 */
export function parseForexFactoryXml(text) {
  const body = String(text ?? '');
  if (!body.includes('<weeklyevents')) return [];

  const events = [];
  for (const match of body.matchAll(/<event>([\s\S]*?)<\/event>/g)) {
    const block = match[1];
    const url = unwrap(block, 'url');
    const key = eventKeyFromUrl(url);
    const title = unwrap(block, 'title');
    if (key === '' || title === '') continue;

    const dateStr = unwrap(block, 'date');
    const startsAtMs = parseCalendarTime(dateStr, unwrap(block, 'time'));
    // "All Day"/"Tentative" still belong in the archive (a bank holiday
    // explains a dead tape), so they are kept, dated, and flagged.
    const allDay = startsAtMs === null;
    const dayMs = allDay ? parseCalendarTime(dateStr, '12:00am') : startsAtMs;
    if (dayMs === null) continue;

    const impact = unwrap(block, 'impact');
    events.push({
      key,
      startsAt: new Date(dayMs).toISOString(),
      currency: unwrap(block, 'country').toUpperCase().slice(0, 8),
      title,
      impact: IMPACTS.has(impact) ? impact : 'Low',
      forecast: unwrap(block, 'forecast'),
      previous: unwrap(block, 'previous'),
      url,
      allDay,
    });
  }
  return events;
}

// The calibration knob. US CPI is released 08:30 ET, which is 12:00-13:59 UTC
// in either DST state — so a parsed CPI outside that band means the publisher
// moved the feed's timezone and every countdown would be silently hours wrong.
// Returns true when the batch is trustworthy.
export function assertCalendarAnchor(events, warn = console.warn) {
  const anchor = events.find(
    (event) => event.key === '78-us-cpi-mm' || event.key === '79-us-core-cpi-mm'
  );
  if (anchor === undefined || anchor.allDay) return true;

  const hour = new Date(anchor.startsAt).getUTCHours();
  if (hour === 12 || hour === 13) return true;

  warn(
    `calendar: zone drift — ${anchor.key} parsed to ${anchor.startsAt} (UTC hour ${hour}), ` +
      'expected 12 or 13. Feed timezone changed; refusing the batch.'
  );
  return false;
}

/**
 * Soft-fail ingest. Mirrors fetchLivePrices: never throws, always resolves to
 * whatever the archive can serve.
 * @returns {{events, asOf, stale}}
 */
export async function fetchCalendarEvents(db, fetchImpl = fetch, now = new Date()) {
  // Single-flight: one atomic UPDATE decides who owns the upstream call.
  // Vercel egress IPs are shared with other tenants, so an unclaimed retry
  // storm can keep us 429'd on traffic that was never ours.
  let claimed = false;
  try {
    claimed = await db.claimFeedFetch(FEED_SOURCE, SUCCESS_TTL_SECONDS);
  } catch {
    claimed = false;
  }

  if (claimed) {
    const parsed = await pullFeed(fetchImpl);
    try {
      if (parsed !== null && parsed.length > 0 && assertCalendarAnchor(parsed)) {
        await db.upsertMarketEvents(parsed);
        await db.markFeedSuccess(FEED_SOURCE, 'ok');
      } else {
        // Back off harder than the success TTL so a bad upstream cannot be
        // hammered, and leave last_success_at alone so `stale` stays honest.
        await db.markFeedFailure(FEED_SOURCE, 'empty-or-rejected', FAILURE_TTL_SECONDS);
      }
    } catch {
      /* the archive is the floor: a write failure must not fail the request */
    }
  }

  try {
    const [events, asOf] = await Promise.all([
      db.loadMarketEvents(),
      db.getFeedSuccessAt(FEED_SOURCE),
    ]);
    const ageMs = asOf === null ? Infinity : now.getTime() - new Date(asOf).getTime();
    return {
      events,
      asOf,
      stale: ageMs > SUCCESS_TTL_SECONDS * 2 * 1000,
    };
  } catch {
    return { events: [], asOf: null, stale: true };
  }
}

async function pullFeed(fetchImpl) {
  try {
    const response = await fetchImpl(FF_URL, {
      headers: { 'User-Agent': 'TraderJournal/1.0 (+https://www.traderjournal.space)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;

    // windows-1252, not UTF-8: response.text() mangles the smart quotes that
    // appear in event titles, and titles are user-visible. TextDecoder ships
    // with Node 22 — no dependency.
    const text = new TextDecoder('windows-1252').decode(await response.arrayBuffer());
    // A 429 answers with a 3.3KB HTML "Rate Limited" page, not an error status,
    // so the body is the only reliable tell.
    if (!text.includes('<weeklyevents')) return null;

    return parseForexFactoryXml(text);
  } catch {
    return null;
  }
}
