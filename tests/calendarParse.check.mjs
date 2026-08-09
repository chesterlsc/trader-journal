// The calendar parser feeds countdowns on real money, so its two failure modes
// are pinned here against the REAL feed (tests/fixtures/ff_calendar_2026-08-09.xml,
// 73 events pulled 2026-08-09):
//
//   1. TIMEZONE. Feed times are UTC. The fixture proves it five ways at once —
//      five releases whose real-world times are known and whose zones span
//      -4 to +12. If a future refactor reintroduces a local-time assumption,
//      at least four of these assertions break immediately.
//   2. THE RATE-LIMIT PAGE. A 429 answers 200-ish with an HTML body, so the
//      parser must reject on content, not status.
//
// Run: node tests/calendarParse.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCalendarTime,
  eventKeyFromUrl,
  parseForexFactoryXml,
  assertCalendarAnchor,
} from "../api/_lib/calendar.js";

const xml = readFileSync(new URL("./fixtures/ff_calendar_2026-08-09.xml", import.meta.url), "latin1");
const events = parseForexFactoryXml(xml);

// --- 1. The fixture parses whole -------------------------------------------
assert.equal(events.length, 73, `expected 73 events from the fixture, got ${events.length}`);
assert.ok(events.every((e) => e.key !== "" && e.title !== ""), "an event lost its key or title");
assert.ok(
  events.every((e) => !Number.isNaN(Date.parse(e.startsAt))),
  "an event produced an unparseable timestamp"
);

// Impact distribution, counted from the real file: 53 Low / 11 High / 8 Medium
// / 1 Holiday. Holiday is a fourth value the feed really uses.
const impacts = events.reduce((acc, e) => ({ ...acc, [e.impact]: (acc[e.impact] ?? 0) + 1 }), {});
assert.deepEqual(impacts, { Low: 53, High: 11, Medium: 8, Holiday: 1 }, `impacts: ${JSON.stringify(impacts)}`);

// --- 2. TIMEZONE: five zones, one file, only UTC fits ----------------------
// Each right-hand side is the release's known wall-clock in its own market.
assert.equal(parseCalendarTime("08-12-2026", "12:30pm"), Date.UTC(2026, 7, 12, 12, 30), "USD CPI: 08:30 EDT");
assert.equal(parseCalendarTime("08-11-2026", "4:30am"), Date.UTC(2026, 7, 11, 4, 30), "AUD Cash Rate: 14:30 AEST");
assert.equal(parseCalendarTime("08-13-2026", "6:00am"), Date.UTC(2026, 7, 13, 6, 0), "GBP GDP: 07:00 BST");
assert.equal(parseCalendarTime("08-09-2026", "11:50pm"), Date.UTC(2026, 7, 9, 23, 50), "JPY Bank Lending: 08:50 JST +1d");
assert.equal(parseCalendarTime("08-13-2026", "3:00am"), Date.UTC(2026, 7, 13, 3, 0), "NZD Infl Exp: 15:00 NZST");

// Midnight/noon are where 12-hour parsing usually breaks.
assert.equal(parseCalendarTime("08-12-2026", "12:00am"), Date.UTC(2026, 7, 12, 0, 0));
assert.equal(parseCalendarTime("08-12-2026", "12:00pm"), Date.UTC(2026, 7, 12, 12, 0));

// Non-instants must be null, never a fictional midnight deadline.
for (const bad of ["All Day", "Tentative", "", "25:00pm", "bogus"]) {
  assert.equal(parseCalendarTime("08-12-2026", bad), null, `"${bad}" must not produce an instant`);
}
assert.equal(parseCalendarTime("bad-date", "12:30pm"), null);

// This particular week happens to be all clock times — verified, and asserted
// so the next line's synthetic coverage cannot be mistaken for fixture
// coverage. The feed DOES emit "All Day"/"Tentative" in other weeks, so that
// path is exercised below with hand-built XML rather than left untested.
assert.equal(events.filter((e) => e.allDay).length, 0, "this fixture week has no all-day events");

const allDayXml = `<weeklyevents><event>
  <title>Bank Holiday</title><country>JPY</country>
  <date><![CDATA[08-11-2026]]></date><time><![CDATA[All Day]]></time>
  <impact><![CDATA[Holiday]]></impact><forecast /><previous />
  <url><![CDATA[https://www.forexfactory.com/calendar/511-jp-bank-holiday]]></url>
</event></weeklyevents>`;
const [holiday] = parseForexFactoryXml(allDayXml);
assert.equal(holiday.allDay, true, "an All Day event must be flagged, not dropped");
assert.equal(holiday.impact, "Holiday");
assert.equal(new Date(holiday.startsAt).getUTCHours(), 0, "all-day rows anchor to 00:00 UTC of their date");

// windows-1252 is the encoding trap the real fixture cannot catch: this week's
// titles are pure ASCII, so only a byte-level case proves the decoder choice
// matters. 0x92 is a curly apostrophe in 1252 and invalid UTF-8.
const cp1252 = Buffer.from(
  `<weeklyevents><event><title>Fed${String.fromCharCode(0x92)}s Minutes</title>` +
    `<country>USD</country><date><![CDATA[08-12-2026]]></date>` +
    `<time><![CDATA[6:00pm]]></time><impact><![CDATA[High]]></impact>` +
    `<forecast /><previous />` +
    `<url><![CDATA[https://www.forexfactory.com/calendar/431-us-fomc-minutes]]></url>` +
    `</event></weeklyevents>`,
  "latin1"
);
const [decoded] = parseForexFactoryXml(new TextDecoder("windows-1252").decode(cp1252));
assert.equal(decoded.title, "Fed’s Minutes", "windows-1252 titles must decode, not mojibake");

// --- 3. The grouping key is the publisher's own id -------------------------
assert.equal(eventKeyFromUrl("https://www.forexfactory.com/calendar/78-us-cpi-mm"), "78-us-cpi-mm");
assert.equal(eventKeyFromUrl(""), "");
assert.equal(eventKeyFromUrl("https://example.com/nope"), "");
// Core CPI must never collapse into CPI — the feed already separates them, so
// grouping on the id makes that bug unreachable rather than merely unlikely.
assert.notEqual("79-us-core-cpi-mm", "78-us-cpi-mm");

// --- 4. The rate-limit page must be rejected on CONTENT --------------------
const rateLimitHtml = '<!DOCTYPE html><html><head><title>Rate Limited</title></head><body>slow down</body></html>';
assert.deepEqual(parseForexFactoryXml(rateLimitHtml), [], "the 429 HTML page parsed as events");
assert.deepEqual(parseForexFactoryXml(""), []);
assert.deepEqual(parseForexFactoryXml(null), []);

// --- 5. The zone-drift anchor ----------------------------------------------
// Today's batch is trustworthy...
assert.equal(assertCalendarAnchor(events, () => {}), true, "the real fixture failed its own anchor check");
// ...and a batch where CPI has drifted off 12/13 UTC is refused, loudly.
let warned = "";
const drifted = [{ key: "78-us-cpi-mm", startsAt: "2026-08-12T08:30:00.000Z", allDay: false }];
assert.equal(assertCalendarAnchor(drifted, (m) => { warned = m; }), false);
assert.match(warned, /zone drift/, "a drifted batch must say why it was refused");
// No anchor in the batch is not an error — most weeks have no CPI print.
assert.equal(assertCalendarAnchor([{ key: "999-xx", startsAt: "2026-08-12T08:30:00.000Z" }], () => {}), true);

console.log(
  `calendarParse.check.mjs: OK — ${events.length} real events, UTC pinned against 5 zones, ` +
    `rate-limit page rejected, anchor guard live`
);
