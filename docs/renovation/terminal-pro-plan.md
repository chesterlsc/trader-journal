# Terminal Pro — build plan

_Produced 2026-08-10 by a 3-architect panel (data / fusion / delivery) + merge, all
verified against the real repo and against live feed pulls. Line numbers were
corrected during the merge; treat this file as the source of truth for Phase 1._

## Architecture

## Verification pass — what I checked against the real repo before merging

Every path, function name and line below was read, not assumed. Where the three plans cited line numbers, several were stale; corrected numbers are used throughout.

| Claim | Verdict |
|---|---|
| `api/_lib/sanitize.js:170` `const item = { ...entry };` preserves unknown trade keys | **TRUE.** All three plans found this. The context stamp needs **zero schema change and zero backend change** — it rides the existing `trades.payload` JSONB. |
| `buildTradeRecord` at `app.js:3252`, sole funnel for all creation paths | **TRUE.** Its own comment names them: "form, sheet, quick capture, bulk import, close-at-market". `accountId` is stamped at `app.js:3279` after the spread. |
| `switchView` at `app.js:1691` is generic over `.nav-btn[data-target]` / `.view` | **TRUE.** `ui.navButtons` (`app.js:249`), `ui.views` (`app.js:250`). Hash router at `1762`. Playbook precedent branch at `1719`. **A new view is markup only — no router change.** |
| `getCooldownState` at `app.js:9036` is a priority chain | **TRUE.** Returns `{reason,badge,headline,detail,question}｜null`. `requestTradeCapture` at `app.js:9152` is the single gate ("One gate, so a new entry point cannot accidentally bypass the speed bump"). |
| `RULE_COST_MIN_SIDE = 5` at `app.js:839` | **TRUE.** Our thin-data threshold anchors to it rather than inventing a new number. |
| `isAdminUsername` env allowlist at `router.js:209`; `isAdmin` on session/login/register (`382/438/476`) | **TRUE.** Exact template for the tier flag. |
| `tests/bootOrder.check.mjs` already guards the TDZ trap | **TRUE** — only Plan 1 knew. It asserts **no** module-level binding below `init()` (`app.js:954`) outside a 4-name allowlist. `state.terminal` goes above, or CI fails. |
| Router CSRF is POST-only (`router.js:669`) | **TRUE.** GET actions are exempt for free. |
| `db.js` issues no DDL, ever | **TRUE**, documented at length. All SQL is pasted by hand. Pool `max: 1`. |

**Stale line numbers corrected:** `setTickerStale` is **11815** (Plan 0 said 11556) · `renderRuleCost` **8956** (said 9008) · `computeCooldownCost` **8947** · `handleBulkImport` **3346** (Plan 2 said 3372) · `autoCloseTriggeredTrades` **11576**.

### Collision the three plans missed

**`index.html:1861` already has `<section class="view" id="calendar">`** — the trading P&L calendar. So:
- The new view id is **`terminal`** (all three agreed) — fine.
- Plan 2's API action name `calendar` is **renamed to `market_calendar`**. A reader hitting `action=calendar` would reasonably think it serves the P&L grid.
- Client state is **`state.terminal`**, never `state.calendar`. (`state.marketData` at `app.js:197` is prices — do not overload it.)

This is the app's **eighth** view, not the sixth (Plan 0's count). Existing: dashboard, playbook, calendar, trade-entry, journal, reflections, monthly.

---

## The fixture settles the biggest disagreement

Plan 2 pulled the real feed. I re-verified its fixture (`ff_calendar_thisweek_2026-08-09.xml`, 24.9 KB, in the scratchpad) directly:

- **73 `<event>` nodes.** Impacts: **53 Low, 11 High, 8 Medium, 1 Holiday.** `Holiday` is a 4th value Plans 0 and 1 never modelled.
- `<title>`/`<country>` are **plain text**; `<date>/<time>/<impact>/<forecast>/<previous>/<url>` are CDATA. Empty fields self-close (`<forecast />`).
- **There is no `<actual>` element.** Confirmed by scan.
- `ff_calendar_nextweek.xml` → **HTTP 404** (`ffnext.xml` is an nginx 404 page).
- The 429 body is a 3.3 KB `<!DOCTYPE html>` "Rate Limited" page.
- `investing.com/rss/news_285.rss` → HTTP 200, valid XML, newest `<pubDate>` **2024-11-26**. ~20 months stale. MarketWatch → `lastBuildDate` today, `ttl 60`, fresh.

### RULING 1 — Feed times are UTC. Plan 2 wins; Plans 0 and 1 lose ~150 lines of dead code.

Cross-checked five independent zones in one file:

| Event | Feed | Real release | Implied zone |
|---|---|---|---|
| USD CPI m/m | `12:30pm` | 08:30 EDT | UTC |
| AUD Cash Rate | `4:30am` | 14:30 AEST | UTC |
| GBP GDP m/m | `6:00am` | 07:00 BST | UTC |
| JPY Bank Lending | `11:50pm` | 08:50 JST (+1d) | UTC |
| NZD Inflation Expectations | `3:00am` | 15:00 NZST | UTC |

Offsets −4, +10, +1, +9, +12 all resolve only under a UTC reading. **And I can close the door Plan 2 left open.** Plan 2 hedged "re-verify in winter for DST". Not needed for zone identity — the August data alone eliminates every DST-bearing candidate:
- *America/New_York?* CPI would read `8:30am`. It reads `12:30pm`. Dead.
- *Europe/London?* CPI (12:30 UTC = 13:30 BST) would read `1:30pm`. It reads `12:30pm`. Dead.

Only UTC fits. **Delete `zonedWallClockToUtc` (Plan 0), `zonedWallToUtc` + two-pass `Intl` offset correction (Plan 1), `FF_CALENDAR_ZONE`, `tzOffsetMs`, `zone_used`, and the six DST-gap/ambiguous-hour test cases both plans wrote.** `parseCalendarTime` becomes `Date.UTC(...)` — eight lines, no `Intl`, no library, no DST class of bug at all. `Intl` is used only for *display* in the browser's own zone.

Kept as a calibration knob, because a publisher can change a default a proof cannot prevent: one ingest anchor assert (below). The physical world needs tuning; the maths does not.

### RULING 2 — The event key is the FF url slug. Plan 2 wins.

`<url>` → `https://www.forexfactory.com/calendar/78-us-cpi-mm` → key `78-us-cpi-mm`. Present on all 73 events. Numeric, stable across years, immune to title rewording.

This **deletes** Plan 0's `eventFamily(title)` ("CPI m/m (Jul)" → `"cpi"`), Plan 1's `normalizeEventTitle` + `eventKey({country,title})`, and their tests. It also deletes an entire bug class: Plan 1's test 8 ("Core CPI must not merge with CPI") cannot fail, because the feed already separates them — `79-us-core-cpi-mm` vs `78-us-cpi-mm`. String-munging a grouping key when the publisher ships a stable id is rung-2 failure: reuse what is already there.

### RULING 3 — The table is an append-only archive, not a cache. Plan 2 wins; Plan 0 has a data-loss bug.

`nextweek` is 404 and `thisweek` rolls over every Sunday. **A week never fetched is gone forever, at any price.** Plan 0 specifies "reconcile deletes stale rows within the `event_day` range derived from the payload" — against an archive that permanently destroys history the product cannot re-acquire. Plan 1's `lens_feed_state` seeds `ff_nextweek` and `ff_lastweek` rows for endpoints that 404.

Ruling: **upsert only, never delete.** PK `(event_key, starts_at)` — Plan 0's `event_key`-alone PK would collapse every monthly CPI into one row and destroy the edge file outright.

### RULING 4 — No `actual` column. Plans 0 and 1 both ship a column that can only ever be `''`.

Plan 1 even writes a `CASE WHEN EXCLUDED.actual <> ''` preserve clause for a field the feed does not have. Cut. This is what forces honesty-ledger items 5, 12 and 14.

---

## New API action — exactly one in Phase 1

```
GET  trade_handler.php?action=market_calendar
auth requireAuth(ctx)          // GET, so router.js:669 exempts it from CSRF
->   { ok: true,
       events: [{ key, startsAt, currency, title, impact, forecast, previous, url, allDay }],
       asOf: "2026-08-09T15:31:02.000Z" | null,
       stale: false,
       serverNow: "2026-08-09T15:34:11.000Z" }
```

**`requireAuth` only — no tier gate on the endpoint.** Plan 0 wanted a 403 for non-entitled users. In Phase 1 there is no premium data behind it: the calendar is public and every statistic is computed in the user's own browser from their own trades. A 403 protecting public data buys support tickets, not revenue. `requireAuth` exists to stop anonymous scraping of our Neon rows and to keep us off FF's blocklist.

`serverNow` is not decoration (Plans 0 and 1, both right): a browser clock four minutes fast fires the arming prompt early, on real money. Client stores `skewMs` once per fetch.

Read window: `starts_at BETWEEN NOW() - INTERVAL '24 hours' AND NOW() + INTERVAL '8 days'`. The −24h half is what lets "you opened this 8 minutes after CPI" resolve for trades taken today.

## Ingest — mirrors `fetchLivePrices(db, symbols, fetchImpl)` exactly

Same contract, same injected `db` and `fetchImpl`, same "dead upstream returns cache, never throws" discipline as `api/_lib/prices.js`.

**Single-flight claim — one atomic statement, no lock table, no advisory lock, no cron:**

```sql
UPDATE feed_state SET last_attempt_at = NOW(), updated_at = NOW()
 WHERE source = $1 AND last_attempt_at < NOW() - make_interval(secs => $2)
RETURNING source;
```

`rowCount === 1` ⇒ this invocation owns the fetch. `0` ⇒ another warm instance has it, serve the DB. This matters more than usual: Vercel egress IPs are shared with other tenants, so you can be 429'd by traffic that is not yours, and an unclaimed retry storm keeps you locked out permanently.

TTL **900s** on success, **300s** backoff on failure.

**Body validation — the 429-returns-HTML trap.** All three plans caught it; this is the concrete form:

```js
const res = await fetchImpl(FF_URL, {
  headers: { 'User-Agent': 'TraderJournal/1.0 (+https://www.traderjournal.space)' },
  signal: AbortSignal.timeout(8000),
});
if (!res.ok) return null;
// windows-1252: res.text() assumes UTF-8 and mangles smart quotes in titles —
// and titles feed the display, so mojibake is user-visible. TextDecoder is
// built into Node 22; no dependency.
const text = new TextDecoder('windows-1252').decode(await res.arrayBuffer());
if (!text.includes('<weeklyevents')) return null;   // the rate-limit HTML lands here
```

**Ingest anchor assert (the calibration knob replacing `zone_used`):** after parsing, if any `78-us-cpi-mm`/`79-us-core-cpi-mm` row exists and its UTC hour is not 12 or 13, `console.warn` a zone-drift line and **write nothing**. UTC is proven today; this converts a future publisher change from a silent multi-hour lie into a log line on the first bad fetch. Six lines.

**No new npm dependencies.** `fetch` + `TextDecoder` + regex + `Intl` (display only). 73 events of flat, namespace-free, attribute-free XML does not justify a parser dependency — the regex is ~10 lines and the real fixture pins it.

## File layout

| Path | Status | Contents |
|---|---|---|
| `/Users/macbookairm3/Documents/Trader-Journal/api/_lib/calendar.js` | **new** | `parseForexFactoryXml(text)` (pure), `fetchCalendarEvents(db, fetchImpl, now)` (soft-fail, single-flight, anchor-checked) |
| `/Users/macbookairm3/Documents/Trader-Journal/api/_lib/router.js` | edit | `market_calendar` action; `envUsernameAllowlist()` extracted from `isAdminUsername`; `terminalPro` on session/login/register |
| `/Users/macbookairm3/Documents/Trader-Journal/api/_lib/db.js` | edit | 4 methods: `claimFeedFetch`, `markFeedSuccess`, `upsertMarketEvents`, `loadMarketEvents` |
| `/Users/macbookairm3/Documents/Trader-Journal/api/_lib/sanitize.js` | edit | one entry appended to `CLIENT_OWNED_SETTINGS` (line 81): `'armOnHighImpact'` |
| `/Users/macbookairm3/Documents/Trader-Journal/src/lib/eventClock.js` | **new** | pure time / ranking / countdown / arming |
| `/Users/macbookairm3/Documents/Trader-Journal/src/lib/eventEdge.js` | **new** | pure fusion statistics |
| `/Users/macbookairm3/Documents/Trader-Journal/app.js` | edit | `state.terminal` (above `init()`), stamp hook, `getCooldownState` branch, view render, dashboard strip |
| `/Users/macbookairm3/Documents/Trader-Journal/index.html` | edit | `#terminal` section + 2 nav buttons |
| `/Users/macbookairm3/Documents/Trader-Journal/db/schema.sql` | edit | append the two tables (documentation; you paste into Neon by hand) |
| `/Users/macbookairm3/Documents/Trader-Journal/tests/fixtures/ff_calendar_thisweek.xml` | **new** | move the real 24.9 KB pull here from the scratchpad |
| `/Users/macbookairm3/Documents/Trader-Journal/tests/fixtures/ff_rate_limited.html` | **new** | the 3.3 KB 429 page |
| `/Users/macbookairm3/Documents/Trader-Journal/tests/calendarParse.check.mjs`, `tests/eventClock.check.mjs`, `tests/eventEdge.check.mjs` | **new** | `node:assert/strict`, no framework, matching `tests/pips.check.mjs` |

## Fusion engine

## `src/lib/eventClock.js` — pure. No DOM, no fetch, no storage, no ambient clock.

```js
// Feed times are UTC — proven 2026-08-09 against five zones (USD/AUD/GBP/JPY/NZD)
// in tests/fixtures/ff_calendar_thisweek.xml. Both America/New_York and
// Europe/London are ruled out by that same fixture, so there is no Intl call,
// no DST correction and no zone constant here on purpose.
// ("08-12-2026", "12:30pm") -> Date   |   "All Day"/"Tentative"/""/garbage -> null
export function parseCalendarTime(dateStr, timeStr)

// ".../calendar/78-us-cpi-mm" -> "78-us-cpi-mm"   ""/malformed -> ""
export function eventKeyFromUrl(url)

// Holiday ranks 0: excluded from ranking and arming, still displayed — a JPY
// bank holiday is WHY the tape is dead, and that is worth knowing.
export const IMPACT_RANK = { Holiday: 0, Low: 1, Medium: 2, High: 3 };

// "EURUSD" -> ["EUR","USD"] · "XAUUSD" -> ["USD"] · "BTCUSDT" -> ["USD"] · "" -> []
// Built on normalizeMarketSymbol from src/modules/livePrices.js — reused, not reimplemented.
export function currenciesForSymbol(symbol)
export function tradedCurrencies(trades)            // union over distinct assets
export function isRelevant(event, currencies)

// Upcoming only · allDay excluded · impact >= minImpact · sorted by startsAt asc.
export function rankEvents(events, { now, currencies, minImpact = "Medium" })
export function nextEvent(events, opts)             // rankEvents(...)[0] ?? null

// -> { ms, text: "4h 12m 33s", phase: "far"|"near"|"imminent"|"live"|"past" }
// far >60m · near 5-60m · imminent 0-5m · live 0..+15m · past >+15m.
// Never emits a negative string.
export function countdown(event, now)

// Events whose start lies within [at - windowMin, at + windowMin]. Stamp source.
export function eventsActiveAt(events, at, windowMin)

// Feeds ONE new branch of getCooldownState(). Pure; never throws on an empty list.
// stale === true  ->  null, always. A lock fired by a phantom event is worse
// than no lock: it destroys trust in the whole feature.
// -> null | { key, title, currency, impact, startsAt, secondsUntil, phase:"arming"|"live" }
export function armingWindow(events, now, { minImpact = "High", armMin = 30, liveMin = 15, stale = false } = {})
```

### `tests/eventClock.check.mjs`

**The UTC pin — the load-bearing block, lifted verbatim from the real fixture:**

```js
parseCalendarTime('08-12-2026','12:30pm') → 2026-08-12T12:30:00.000Z  // US CPI      = 08:30 EDT
parseCalendarTime('08-11-2026','4:30am')  → 2026-08-11T04:30:00.000Z  // RBA Cash Rate = 14:30 AEST
parseCalendarTime('08-13-2026','6:00am')  → 2026-08-13T06:00:00.000Z  // UK GDP      = 07:00 BST
parseCalendarTime('08-09-2026','11:50pm') → 2026-08-09T23:50:00.000Z  // JP Bank Lending = 08:50 JST +1d
parseCalendarTime('08-13-2026','3:00am')  → 2026-08-13T03:00:00.000Z  // NZ Infl Exp = 15:00 NZST
```

Five offsets in one block. If FF ever re-zones the feed, all five fail at once and each failure names the release it anchors to.

- **12-hour trap:** `'12:15am'` → `00:15Z`, `'12:30pm'` → `12:30Z`. A naive `% 12` gets exactly one of these wrong; **both strings appear in the real fixture.**
- **Null cases:** `'All Day'`, `'Tentative'`, `''`, `'garbage'` → `null`. Never `Invalid Date`, never throws.
- `eventKeyFromUrl`: every one of the 73 fixture urls yields a key matching `/^\d+-/`; `''` and `'https://forexfactory.com/'` → `''`.
- **Relevance:** `EURUSD`→`[EUR,USD]` · `USDJPY`→`[USD,JPY]` · `GBPJPY`→`[GBP,JPY]` · `XAUUSD`→`[USD]` · `BTCUSDT`→`[USD]` · `''`→`[]`.
- **`rankEvents` over the real 73-event fixture at a frozen `now`:** excludes past, excludes `allDay`, excludes `Low` at default `minImpact`, ascending. Pin the census: **11 High · 8 Medium · 53 Low · 1 Holiday.**
- **`countdown`** at exact boundaries (`3600000`, `300000`, `0`, `+900000` ms): transitions are `>=`/`<` consistent; `phase:"past"` never renders a negative string.
- **`eventsActiveAt`** inclusive at exactly ±`windowMin`, exclusive one ms beyond.
- **`armingWindow`:** `null` at T−31m · `"arming"` T−30m..T−0 · `"live"` 0..+15m · `null` at +16m · `null` for a Medium event at default `minImpact` · **`null` when `stale: true` even at T−5m** · `null` on `[]`.

---

## `src/lib/eventEdge.js` — pure

### Thresholds, exported once so no caller can invent its own

```js
// 5 is not a new number: it is RULE_COST_MIN_SIDE (app.js:839), the threshold
// renderRuleCost already holds itself to. Matching it is deliberate.
export const EDGE_MIN_LOG     = 5;    // below this: a LIST of trades, no rate
export const EDGE_MIN_VERDICT = 10;   // below this: a record, but never a verdict
export const WINDOW_MIN       = 3;    // per bucket
```

### Signatures

```js
// The auto-stamp. -> [{ k, t, c, i, m }] capped at 3, highest impact first.
// m = minutes from event start to trade open. NEGATIVE = opened BEFORE the print.
// Medium+ ONLY: 53 of 73 events in a real week are Low. Stamping them is
// payload bloat with no signal.
export function stampFromEvents(events, at, windowMin = 120)

// Wilson score interval. Five lines, and it kills the single worst lie this
// feature can tell: rendering 2W-5L as "you win 28% of CPI prints".
export function wilson(wins, n, z = 1.96)   // -> { lo, hi }

// The trader's OWN baseline. A 65%-baseline trader who is 60% on CPI is WORSE
// on CPI. Comparing against 50% would call that a win.
export function buildBaseline(trades)       // -> { n, winRate, meanR }

export function edgeConfidence(n)           // "none"|"anecdote"|"thin"|"usable"

// The F2 pane.
// -> { key, title, samples, wins, losses, flat, netPnl, avgPnl, avgR,
//      winRate,                 // null below EDGE_MIN_LOG — null, not 0.33
//      winRateCI,               // { lo, hi }
//      baselineWinRate,
//      confidence,
//      verdict,                 // "" | "worse" | "better" | "no-difference"
//      sentence }               // the honest sentence, BUILT HERE
export function eventFile(trades, eventKey, baseline)

// -> [{ label, n, netPnl, avgPnl }] over fixed buckets:
//    "before" (m<0) · "0-15m" · "15-60m" · "60m+"
// Each bucket carries its own n; below WINDOW_MIN it reports a count and nothing else.
export function windowBuckets(trades, eventKey)

// DAY-ONE EDGE. Needs NO stamps and no archive — pure arithmetic over trades
// the user already has. Buckets by UTC hour-of-day from createdAt, over trades
// logged live (createdAt date === trade date, no importBatchId).
// -> [{ slot: "12:30-13:00", label: "US data window", n, netPnl, avgPnl, confidence }]
export function releaseClockEdge(trades)

// The F9 pane. Reuses the SHIPPED psychology vocabulary verbatim:
// trade.psychology === "Emotional" || "Revenge Trade"  (the exact predicate at
// app.js:7225 and 7257), OR trade.cooldownOverride === true. No new taxonomy.
// ratio is null unless n >= EDGE_MIN_LOG on both sides.
export function tiltByEventType(trades, baseline)
```

### Three rules enforced in the library, so the UI physically cannot break them

1. **`n < 5` ⇒ `winRate` is `null`**, not `0.33`. A template that renders it gets an empty cell, not a lie.
2. **`n < 10` ⇒ `verdict` is `""`.** The UI cannot print a verdict it was not given. This is the answer to "what happens with too few trades", and it is pinned by assertion rather than by a rendering convention someone will forget.
3. **The comparison is against the trader's own baseline, never 50%.** `verdict` is non-empty only when the Wilson interval excludes their own baseline; otherwise `"no-difference"` — a real, useful answer that most event files will return forever.

`sentence` is generated **in the library**, on purpose. If the copy lived in the renderer, someone would eventually write "your edge" over a 4-trade report. Asserted to contain no `%` character below `EDGE_MIN_LOG`.

`avgR` reads `trade.rMultiple`, already computed at `app.js:3314`. Nothing here recomputes P&L — the fusion engine only groups and averages what the journal already settled.

### `tests/eventEdge.check.mjs`

- **Sign convention, asserted first** — getting it backwards silently inverts every verdict: a stamp `m: -8` lands in `"before"`; `m: +8` lands in `"0-15m"`. Both directions.
- **n=0** → `{ samples: 0, avgPnl: 0, winRate: null, confidence: "none", verdict: "" }`. No division by zero, no `NaN` reaching a template.
- **n=4, all losses** → `confidence: "anecdote"`, `winRate === null`, `verdict === ""`, and **`!sentence.includes('%')`**. The load-bearing honesty assertion.
- **n=12, 3W-9L, baseline 55%** → `confidence: "usable"`, `verdict: "worse"`, `winRateCI.hi < 0.55`.
- **n=12 matching baseline** → `verdict: "no-difference"` (a real answer, not `""`).
- `wilson(3,3).lo < 1` — never claims 100%. `wilson(0,5).hi ≈ 0.434`.
- A trade with **no** `eventContext` is skipped entirely, **not** counted as a zero-P&L sample. This is what stops 400 pre-stamp trades diluting every file to nothing.
- A trade whose `eventContext` names a different key is skipped.
- `stampFromEvents` caps at 3, orders High before Medium, and **drops Low entirely**.
- `windowBuckets`: in a 12-trade report with 2 in `"before"`, that bucket reports `n` and `avgPnl === null`.
- `releaseClockEdge` **excludes** a trade whose `createdAt` date ≠ its `date` (bulk-imported: the timestamp is the import, not the fill).
- `tiltByEventType` with n=4 → `ratio: null`. With a constructed baseline it reproduces a 2.4× ratio.

### `tests/calendarParse.check.mjs`

Against the real fixture: 73 events · `<forecast />` → `''` · CDATA unwrapped · plain-text `<title>`/`<country>` read correctly · impact set is exactly `{Low,Medium,High,Holiday}` with census 53/11/8/1.

Plus the failure fixtures, which matter more than the happy path:
- **the real 3.3 KB rate-limit HTML → `[]`**, never throws, never half-parses;
- `''` → `[]`;
- a synthetic 6-byte `<title>` containing byte `0x92` decodes to `’`, not `�`. **The real fixture is pure ASCII this week, so it cannot catch a windows-1252 regression on its own** — this test exists precisely because the good fixture is blind to it.

---

## The stamp hook — one insertion, `app.js:3252`, right after `accountId` at line 3279

### RULING 5 — Plan 2's in-function guard beats Plan 0's opt-in flag.

Plan 0 passes `{ stamp: true }` at four call sites. That is four places to forget, and forgetting is silent — exactly the failure mode `requestTradeCapture`'s own comment warns about ("a new entry point cannot accidentally bypass the gate"). One guard inside the shared funnel is both the smaller diff and the root-cause fix.

```js
    // The context auto-stamp. Rides the trades JSONB — sanitize.js:170 does
    // `const item = { ...entry }`, so unknown keys survive the round-trip and
    // this costs zero schema.
    //
    // Guarded three ways, and every one of them is correctness, not polish:
    //   !existingId          an edit made a week later must not stamp today's
    //                        events, so an existing trade CARRIES what it had
    //                        (same rule as preTradeRules three lines below).
    //   date === today       a bulk import's createdAt is the IMPORT time. An
    //                        offset measured from it is fiction.
    //   !importBatchId       and an import of TODAY's trades slips past the
    //                        date check, so close that door too.
    eventContext: Array.isArray(existingTrade?.eventContext)
      ? existingTrade.eventContext
      : (!existingId && !tradeInput.importBatchId && tradeInput.date === toDateInputValue(new Date())
          ? stampFromEvents(state.terminal.events, new Date(), 120)
          : []),
```

`handleBulkImport` (`app.js:3346`) routes through this same function. **Without these guards every imported row is stamped with whatever was on the calendar the afternoon you ran the import — fabricating correlations that look real and are not.** That is the worst failure this feature can have, and it is three conditions.

Guest/demo mode needs no special case: `state.terminal.events` is empty until the first fetch, and demo sessions write to `sessionStorage` and die with the tab.

## TDZ — non-negotiable, and CI already enforces it

`tests/bootOrder.check.mjs` asserts that **no** module-level `const`/`let` sits below `init()` (`app.js:954`) outside a 4-name allowlist. `state.terminal` and every new binding go **above** it, next to `RULE_COST_MIN_SIDE` (`app.js:839`). `node --check` cannot catch this; the file is syntactically perfect. It has shipped four times.

```js
// app.js:159, inside the existing `const state = {` — a sibling of marketData,
// NOT a member of it (marketData is prices) and NOT named `calendar`
// (index.html:1861 already owns that id).
terminal: { events: [], asOf: null, stale: false, skewMs: 0, tickId: 0 },
```

## UI

## Where it lives — the router needs zero changes

Verified: `switchView` (`app.js:1691`) drives `is-active`, `aria-current`, hash sync and the mobile-nav collapse purely off `.nav-btn[data-target]` and `.view[id]`; `ui.navButtons` / `ui.views` (`app.js:249-250`) collect them by class. **Add markup, get deep-linking, refresh and back/forward for free.**

One branch, mirroring the playbook precedent at `app.js:1719`:

```js
  if (id === "terminal") {
    renderTerminal();        // the pane IS its data, same as renderPlaybookPage()
    startTerminalTick();
  } else {
    stopTerminalTick();      // the 1s countdown dies when you leave the view
  }
```

**Markup insertions (all verified):**
- View section: `index.html:2496`, after `<section class="view" id="monthly">` closes and before `</main>` at 2498.
- Desktop nav: `index.html:1103`, the topnav overflow menu beside "Trade entry" / "Monthly review".
- Mobile nav: `index.html:916`, the sheet-tile grid beside "Trade Entry" / "Monthly Review".
- **Do not touch the mobile tabbar** (`index.html:2516`). It holds four slots plus the FAB, and its own comment records that Reflections and Monthly Review already live behind the hamburger. Terminal joins them.

## Tier gating without inventing billing

### RULING 6 — env allowlist (Plans 0, 2) beats a client-owned setting (Plan 1).

Plan 1 gates on `state.settings.lensEnabled` routed through `CLIENT_OWNED_SETTINGS`. Plan 1 admits it is "flipped in devtools in four seconds". There is already a working server-side pattern for exactly this, verified end to end — copy it, do not invent a second one.

**Server** (`api/_lib/router.js`) — extract the env parse that `isAdminUsername` (line 209) already contains, so the two checks cannot drift:

```js
function envUsernameAllowlist(ctx, ...envNames) {
  for (const name of envNames) {
    const configured = str(ctx.env[name] ?? '').trim();
    if (configured !== '') {
      return configured.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    }
  }
  return null;
}

function isTerminalProUsername(ctx, username) {
  const allow = envUsernameAllowlist(ctx, 'TERMINAL_PRO_USERNAMES');
  return allow !== null && allow.includes(str(username).trim().toLowerCase());
}
```

Return `terminalPro` beside `isAdmin` in **all three** of `session` (line 382), `login` (438) and `register` (476) — one line each, and keeping them symmetric removes any dependence on whether `app.js` re-calls `session` after auth.

**Client:** `state.auth.terminalPro`, set and cleared at every site that already sets and clears `isAdmin`. Then:

```js
document.querySelectorAll('[data-target="terminal"]').forEach((b) => { b.hidden = !state.auth.terminalPro; });
```

plus one guard at the top of `switchView`. Granting access is editing one Vercel env var. No billing, no table, no migration when real billing lands.

**Write this in the code, verbatim, because it stops a later reader trusting the wrong thing:**

```js
// ROLLOUT GATE, NOT A PAYWALL. Anyone can flip this boolean in devtools.
// That is fine in Phase 1 because there is no premium data behind it: the
// calendar is public and every statistic is computed in this browser from
// this user's own trades. When billing exists, the server must gate DATA,
// not buttons.
```

## The panes — Phase 1 ships three, not four

### RULING 7 — cut the wire pane from Phase 1. Plan 2 is right, for a reason Plan 0 found and Plan 2 missed.

Plan 2 cuts it because there is no honest content for it. The stronger reason is Plan 0's: **Dow Jones / MarketWatch RSS terms permit personal, non-commercial consumption, and Terminal Pro is explicitly a paid tier.** Redistributing someone else's headlines inside a product you charge for is a different legal posture from a free reader, and it is the only component in this whole plan with unbounded exposure. It also costs a second feed, a second parser and a freshness gate. Three real panes beat four with one lying and one un-cleared.

The landing's `tv` badge has to be retired regardless (ledger item 5), so nothing is lost by deferring.

**Pane 1 — NEXT.** The reason they open it every morning. `rankEvents` filtered to `tradedCurrencies(state.trades)`. Each row: local wall-clock time (`toLocaleTimeString`, their zone) · currency · title · impact dot · forecast vs previous · **live 1s countdown**. Every field is in the feed; nothing is invented.

The absolute local time sits **next to** the countdown deliberately. If FF ever re-zones the feed, a trader spots "CPI at 08:30" reading wrong within seconds, where a bare countdown would be silently hours off forever. That is the display half of the same calibration knob as the ingest anchor assert.

**Pane 2 — YOUR EDGE.** Click any row in pane 1 → `eventFile(state.trades, key, baseline)`. Record, Wilson interval as a bar, `windowBuckets` as four CSS bars (not a canvas — `renderCharts` stays untouched), verdict when `confidence === "usable"`.

Three states driven by `edgeConfidence`, and the empty one is a **designed** state:

> **`none`** — "**CPI m/m — 0 prints on record.** Your file starts today. Every trade you open from now on is stamped with what was on the calendar, and after 10 prints this pane starts telling you something you did not already know."
>
> **`anecdote`/`thin`** — "**4 trades on CPI m/m.** Six more before this becomes a number." Lists the four. **No percentage anywhere on screen.**
>
> **`usable`** — verdict sentence, interval, baseline marker.

Under every state, the most honest line on the page: **"127 of your 482 trades carry a trustworthy open time."**

**And below it, on day one, `releaseClockEdge`** — Plan 0's idea, the only one in the three plans that produces a real number with zero stamps and zero archive: *"Your 12:30–13:00 UTC trades: 14 closed, −$212."* It is computed from trades the user already has, it is the honest precursor to "your CPI record", and it is what stops F2 launching as eight empty states. Simplified from Plan 0: buckets are UTC hours directly, no zone parameter, because the feed is UTC.

**Pane 3 — ARMED.** `armingWindow()` countdown, the trader's existing `preTradeRules` checklist, and a live statement of what happens at T−0.

## Discipline arming — ships in Phase 1, wired into the existing gate

### RULING 8 — Plan 0/1 beat Plan 2. Do not defer this.

Plan 2 makes pane 3 report-only until Phase 2. That defers the single highest-value zero-history feature in the product: arming is genuinely useful from the first High-impact release the user sits through, with **no trades required at all**. And the integration is rung-2 reuse, not new machinery.

One branch in `getCooldownState` (`app.js:9036`), inserted **after** the streak branch, immediately before the final `return null`:

```js
  // LAST in the chain, not first. An event is a temporary condition; a spent
  // daily budget or a breached prop limit is not, and those must keep winning
  // the dialog. (Plan 0 put this ahead of the budget branches — wrong.)
  const arm = state.settings.armOnHighImpact !== false
    ? armingWindow(state.terminal.events, terminalNow(), { stale: state.terminal.stale })
    : null;
  if (arm) {
    const file = eventFile(state.trades, arm.key, buildBaseline(state.trades));
    return {
      reason: `event-${arm.phase}`,
      badge: arm.phase === "live" ? `${arm.title} just printed` : `${arm.title} in ${countdown(arm, terminalNow()).text}`,
      headline: `${arm.currency} ${arm.title} — ${arm.impact} impact.`,
      detail: file.confidence === "usable"
        ? file.sentence
        : `You have ${file.samples} closed trade${file.samples === 1 ? "" : "s"} on this release. ${EDGE_MIN_VERDICT} is where the number starts meaning something.`,
      question: "What is your plan for the print, and what size does it survive?"
    };
  }
```

That inherits, for free: the dialog, the typed-answer speed bump, the `cooldownOverride`/`cooldownReason`/`cooldownNote` stamp on the resulting trade, and the "trades taken through a cooldown prompt cost you $X" analytic (`computeCooldownCost`, `app.js:8947`). Roughly 20 lines for a complete feature.

`stale: state.terminal.stale` is load-bearing (Plan 1's point): a lock fired by an event that already passed or was rescheduled is worse than no lock — it destroys trust in everything else on the screen. **Arming is the only feature that fails closed; everything else degrades to cached display.**

`armOnHighImpact` is the one new setting, so it needs exactly one entry appended to `CLIENT_OWNED_SETTINGS` at `api/_lib/sanitize.js:81`. Anything the client persists into settings that is not named there is silently deleted on the first server round-trip — the comment above that array documents the incident. (Plan 1 wanted five entries; four of them are for features we are not shipping.)

**The lock blocks the prompt, never the logging.** A journal that refuses to record a trade the trader actually took corrupts the record.

## The free hook on the dashboard

One strip in the dashboard header, visible to everyone, no tier:

> `NEXT · USD CPI m/m · 13:30 · High · T−4:12:33`

~40 lines reusing `nextEvent()` and the same 1s tick. Deliberate positioning: **the schedule is a commodity and should be free; your own record against it is the product and sits behind the tier.** It is also the thing that makes them open the app at 07:00.

## Timers — one reused, one new

- **Data poll:** no new timer. `startLivePriceLoop` (`app.js:11505`) already ticks 5s and already does modulo-gated extra work (`leonFeedTick % 12` at `app.js:11516`). Add `% 60 === 0` → `loadCalendar()` (5 min), gated on the terminal view being active and `document.visibilityState === "visible"`.
- **Countdown:** one new 1s `setInterval`, started in `switchView("terminal")`, cleared on the way out. Pure local arithmetic against already-fetched `startsAt` plus `skewMs` — **zero network**. This is the one timer that earns its own existence, because "T−27:55" is the feature.

## Reuse, explicitly

`switchView` / hash router — untouched. `setTickerStale`'s exact stale-badge pattern (`app.js:11815`). `formatCountdown` (`src/lib/sessions.js:53`) for the coarse readout. `createTradeDisplayHelpers` (`src/modules/tradeDisplay.js`) for the trade chips. `<dialog id="cooldownDialog">` for the arming modal. `.view-head` / `.view-kicker` markup and the Clay V3 tokens — **no new CSS system**.

## Phasing

## Phase 0 — nothing. Delete it.

Plan 0 opens with a half-day Vercel spike to discover whether FF is reachable from Vercel egress, and forbids writing the ingest until it answers. **Skip it.** The design already treats every fetch as likely to fail: single-flight claim, 900s TTL, 300s backoff, body sniffing, and the DB as the floor. If Vercel is 429'd, the product still works — it serves whatever the archive holds and prints its age. The spike answers a question the architecture no longer asks, and it delays the one irreversible thing by half a day.

The fallback, if production turns out to be hard-blocked, is 15 minutes once the parser exists: an admin-only POST that accepts the XML body, reusing the same parser and the same upsert. Only the transport changes. Build it if and when the logs show it is needed.

---

## Phase 1 — shippable, zero paid inputs, no fabricated data

### RULING 9 — Plan 2's build order is the single best scheduling call in the three plans, with one correction.

**Ship the stamp as its own small release, before any pane exists.**

The stamp is the only piece that generates data which cannot be recovered later. `nextweek.xml` is a 404 and `thisweek` rolls over every Sunday, so there is no backfill at any price. Every day the stamp is not shipped is a day of trades that are permanently context-free. The panes can be built next week against a month of real stamps; **a month of stamps cannot be built next week.**

Plan 2 says "ideally first". It cannot be literally first — the stamp needs events in memory to stamp against. The true minimum is steps 1–6:

| # | Work | Gate |
|---|---|---|
| 1 | Paste the SQL into Neon; append to `db/schema.sql` | tables exist |
| 2 | `src/lib/eventClock.js` — parse, key, rank, countdown | `tests/eventClock.check.mjs`, `tests/calendarParse.check.mjs` |
| 3 | `api/_lib/calendar.js` + 4 `db.js` methods + `market_calendar` action | ingest tests; router test for 401 |
| 4 | **Fetch once from a real Vercel deploy and read the logs** | a real 200 with 73 events, and the anchor assert silent |
| 5 | `state.terminal` (above `init()`), poll loop, `loadCalendar()` | events in memory; `tests/bootOrder.check.mjs` green |
| 6 | **The stamp hook** — the three-condition guard at `app.js:3279` | a new trade carries `eventContext`; an imported one does not |

**↑ Steps 1–6 are a complete release. Ship them. The clock starts.**

| 7 | `#terminal` view, nav buttons, `TERMINAL_PRO_USERNAMES` gate, Pane 1 | visible ranked calendar, deep-links |
| 8 | `src/lib/eventEdge.js` + Pane 2 (`eventFile` + `releaseClockEdge`) | `tests/eventEdge.check.mjs` |
| 9 | `armingWindow` + the `getCooldownState` branch + Pane 3 | arming tests; the dialog fires at T−30 on a High event |
| 10 | Free next-event strip on the dashboard | visible to everyone, no tier |
| 11 | Landing copy corrections from the ledger | — |

Step 4 is not optional and belongs before any UI: a 429 from production changes the plan, and finding out at step 9 wastes the build.

### What a trader actually has on day one

- Every scheduled market-moving event for the pairs they trade, in their own timezone, **counting down to the second**, with what the market expects vs last time.
- **Discipline arming** — genuinely useful from the first High-impact release, with zero trade history required.
- **The context auto-stamp** — from their very first trade, a permanent record of what was on the calendar when they clicked buy.
- **`releaseClockEdge`** — a real number in F2 on day one, from trades they already have, with no stamps and no archive.
- F2's event file and F9 in their honest empty states, naming the threshold and the date recording started.

### Explicitly NOT in Phase 1

The wire/headlines pane (RSS terms need clearing before a paid tier redistributes Dow Jones content, and there is no honest content for the hero slot). Actual-vs-forecast (the field does not exist in the feed). Tilt radar as a pane (needs stamped volume). Any backfill. Any billing. GDELT (1 req/5s needs a background sweep; there is no cron here).

### The truth that goes in the plan and on the screen

The moat features are **code-complete in Phase 1 but payoff-complete on the user's own clock.** A monthly release needs ~10 prints to clear `EDGE_MIN_VERDICT` — that is ten months of trading. There is no keyless historical calendar, so **trades made before the calendar starts recording can never be stamped.**

Phase 1 must therefore ship the panes visibly *filling* — "73 events recorded since 9 Aug · 4 of your trades stamped · 10 is where a number starts meaning something" — rather than pretending they are ready. This is the standard `renderRuleCost` (`app.js:8956`) already holds itself to; matching it is not optional.

---

## Phase 2 — after ~4 weeks of stamps exist

- **Vercel cron**, 1×/hour, on the ingest. Promote this from "optional warming" (Plan 0) to **the first Phase 2 item**: a week during which nobody logs in is gone forever. It is a warm cache in Plan 0's framing and an archive-integrity guarantee in reality.
- **Headlines pane** — MarketWatch only, reusing `feed_state.payload`, so **no new table**. Ships only after the RSS terms question is cleared (see risks). Headline + link + source + timestamp, never body text. **Ship the freshness gate with it**: if `max(pubDate)` is older than 6h, render grey and labelled stale, never as live. Not paranoia — Investing.com serves HTTP 200, valid XML, 20 months stale.
- **Tilt radar** as a pane, once families clear `EDGE_MIN_LOG` on both sides.
- **Archive backfill** — `eventsActiveAt` over accumulated `market_events` for live-captured trades inside the archived range. **Never for `importBatchId` trades**: their timestamps are fiction.
- **Prune** — one bounded `DELETE` for headline rows only. `market_events` is never pruned; it is the archive.
- **Tier flag → real entitlement**: `ALTER TABLE journal_users ADD COLUMN tier` (SQL provided, commented). One function body changes. Still not billing — an admin sets it.

## Phase 3 — only if licensing is bought

Actual-vs-forecast (needs a paid source; it is the one thing that would make the landing mock literally true — price it honestly before promising it). Sub-second wires. GDELT slow sweep. Cross-user aggregates, which need a privacy model and a consent flow.

**Nothing in Phases 1–2 is designed around any of them.** Adding one is a new row in `feed_state`, a new parser, the same response shape.

**Not planned at any phase:** financial TV, head-of-state posts. Those need licences this product will not buy, and the landing must stop implying the first one.

## Honesty ledger

## First, a correction all three plans independently reached

I grepped the repo for "head-of-state", "financial TV", "wires", "no delay", "milliseconds", "the moment they cross". **None appear in the shipped landing copy.** If that copy exists it is in a draft outside this repo.

The live Terminal Pro section (`index.html:632-765`) is already more careful than the brief implies: "In development" on the plate (641), "concept preview" on the chrome (655), "sample data · nothing live" in the bar (731), and fine print stating every figure is invented (760). Someone did good work there.

**What it over-promises is capability, not liveness — and the problems are concentrated in the sample screen, not the prose.**

## The ledger

| # | Live claim (`index.html`) | Phase 1 reality | Ruling / copy fix |
|---|---|---|---|
| 1 | l.641 "In development · journal-fusion tier" | — | **Keep.** Change only when Phase 1 ships. |
| 2 | l.643 "Every terminal reads the tape.<br>This one has read *your journal*." | ✅ The one claim no competitor can copy | **Keep. Best line on the page.** |
| 3 | l.645 "the wire, the calendar and your own trading record, fused into one instrument" | Calendar ✅, record ✅. "The wire" is not shipping in Phase 1 at all, and would be 10 RSS headlines on a 60s TTL if it did | **"the economic calendar, the headlines and your own trading record, fused into one instrument."** Drop "wire" — it names a licensed product we will never buy. |
| 4 | l.646 "When a number drops it doesn't just show you the news — it shows you what that news usually does to you." | **Second half is true and is the entire moat. First half is not deliverable: the feed has no `<actual>` element**, verified by scan of all 73 events | **"When a release is due, it doesn't just show you the countdown — it shows you what that release usually does to you."** Pivots from a number we cannot get to a countdown we nail to the second, and keeps the good half intact. |
| 5 | l.674 row: `tv` badge · "CPI 3.1% y/y — two tenths under consensus" | ❌❌ **The single most misleading token on the page.** No TV feed at any price this product pays, and no release actuals from any free source. A concept preview showing a capability that will never exist is the dishonest kind, sample label or not | **Retire the `tv` source tag entirely.** Replace the row with what the feed *does* carry: `cal · CPI m/m 12:30 UTC — forecast 0.1%, prev −0.4% · High`. |
| 6 | l.675 "USD −0.4%" · l.686 "2Y −9bp" / "ES +0.4%" | ❌ `api/_lib/prices.js` resolves crypto, EURUSD, XAU and XAG **only**. No DXY, no bonds, no index futures | Restrict every chip on the mock to symbols the app actually prices. **Cut the `2Y` and `ES` rows.** `XAU +18.4` (l.692) and `EURUSD 1.0841` (l.698) stay — both are real sources. |
| 7 | l.678 "Your CPI file pulled — 7 prior prints" `2W–5L` | ❌ **7 is below `EDGE_MIN_VERDICT`.** The shipped engine renders this with no rate and no verdict. The sample screen currently demonstrates the exact behaviour the library forbids | Change the sample to a `usable` file (e.g. `3W–9L · 12 prints`), **or** show the honest collecting state. As it stands the demo teaches users to expect a number the product will refuse to print. |
| 8 | l.709-712 F2 pane: `2W–5L · avg −$84` · worst window · best move · **"verdict: stand down 15:00"** | ❌ Same root cause as #7 — fine at n=12, forbidden at n=7 | Follows from #7. Raise the sample n, and the whole pane becomes truthful unchanged. |
| 9 | l.717 F5 chip "CPI **miss** · 1 min prior" | ❌ "miss" requires actual vs forecast | **"CPI print · 1 min prior."** Revisit only if Phase 3 buys an actuals source. |
| 10 | l.718 chip "USD −0.4% · 2Y −9bp" | ❌ Same as #6 | Drop, or restrict to XAU/EURUSD. |
| 11 | l.662 screen clock `13:32:05 UTC` · l.704 `T−27:55` | ✅ **Exactly, to the second, anchored to server time — and now literally correct, because the feed itself is UTC** (verified across five zones) | **Keep, and lead with it.** This is where a "no delays" claim is true. Make it the headline promise instead of speed on the wire. |
| 12 | l.726 "desk locks at 13:58:00 unless every box is ticked" | ✅ Fully deliverable in Phase 1 via the existing `getCooldownState` / `requestTradeCapture` gate | **Keep.** Add one line: **"It locks your journal, not your broker."** |
| 13 | l.733 "F9 tilt radar: dollar **headlines** overtraded 2.4×" | Partly — it correlates against **scheduled releases**, not arbitrary headlines | "dollar **releases** overtraded 2.4×" |
| 14 | l.741 F2 legend "**A number breaks** and your own record on that event type prints beside it. 2W–5L is a fact, not a feeling." | Record ✅. "A number breaks" implies actuals ❌ | **"A scheduled release lands** and your own record on that event type prints beside it. 2W–5L is a fact, not a feeling." |
| 15 | l.746 F5 legend "Review week reads 'CPI **miss**, 1 min prior'" | ❌ Same as #9 | "Review week reads '**CPI print**, 1 min prior' instead of a guess." |
| 16 | l.751 F8 legend "Before high-impact releases your own rules arm themselves — the desk locks ahead of the print unless your checklist is ticked." | ✅ **Fully deliverable in Phase 1.** | **Keep verbatim. Add nothing.** |
| 17 | l.756 F9 legend "correlated to headline types. It knows which **news** makes you overtrade — and says so **live**." | Computed from the user's own trades ✅. "which news" implies headline classification ❌; "live" oversells a client-side recompute of a historical stat | **"It knows which releases make you overtrade — and shows you the record."** |
| 18 | l.732 "journal: 482 trades linked" · l.734 "14 event types on file" | Fine as a sample. **But a new user sees 0 and 0** | No copy change — a **design** obligation. The real pane prints "127 of 482 trades carry an open-time stamp". Mirror that in the sample: **"127 of 482 trades linked."** |
| 19 | l.655 "concept preview" · l.731 "sample data · nothing live" · l.760 fine print | ✅ Accurate, and the reason this page is defensible today | **Keep verbatim until Phase 1 ships.** Then replace the CSS mock with a real screenshot — do not merely delete the disclaimers from a fake screen. |
| 20 | l.762 "Pricing lands with the launch; journalling itself stays free." | ✅ True, and the free dashboard strip strengthens it | **Keep.** |

## The redefinition the brief asked for

Replace any implied "no delays" with the two-speed truth, which is both honest and the better sales line:

> **Scheduled releases are timed to the second.** The countdown to a high-impact print is anchored to server time and does not drift. **Headlines refresh as fast as a free public feed allows** — minutes, not milliseconds — and every row carries its own timestamp, so you always know how old it is. We would rather show you the age than pretend there isn't one.

## The line the landing should add

Every deletion above is a retreat only if framed as one. There is a genuinely strong claim available that no competitor can copy, that is true today with zero paid data:

> **Other terminals tell you the number. This one tells you your record.**

That converts the missing `<actual>` field from a shortfall into a positioning choice. The moat was never the wire — the wire is a commodity anyone can buy. **The moat is that nobody else has the user's trades.**

## One structural honesty requirement for the product itself

The event panes will be empty for months for every new user. The plan is only honest if the UI says so on its face — "73 events recorded since 9 Aug · 4 of your trades stamped · 10 is where a number starts meaning something" — rather than shipping a pane that looks broken or, worse, one that averages two trades.

`renderRuleCost` (`app.js:8956`) already holds itself to exactly this standard, printing the threshold and the distance to it. Matching it is not optional; it is the house style, and it is enforced in the library (`verdict: ""` below n=10) rather than by a rendering convention someone will forget.

## Attribution obligations

- **ForexFactory:** visible "Calendar: ForexFactory" credit, every event links to its own `url`, identifiable User-Agent with a contact URL, and the data is **never re-exposed through an unauthenticated endpoint** — which is exactly why `market_calendar` requires auth.
- **MarketWatch / Dow Jones (Phase 2 only):** headline, link, source name and timestamp only. No body text, no images, no reader-mode extraction. See risk 4.

## Risks

## 1 · ForexFactory rate limiting — reproduced, not theoretical

~4 requests in 30s from one laptop → **HTTP 429 with a 3.3 KB HTML body**. Vercel egress IPs are **shared with other tenants**, so you can be locked out by traffic that is not yours.

- Atomic `claimFeedFetch` single-flight ⇒ N concurrent warm instances produce exactly **one** upstream request per TTL. 900s success TTL, 300s failure backoff, DB always the floor.
- **A 429 must never be retried on the request path.** Without the claim, a 429 means every request retries and you stay locked out permanently — which is why `last_attempt_at` is a separate column from `last_success_at`. `last_success_at` alone cannot express "we tried 30 seconds ago and were refused".
- Identifiable UA (`TraderJournal/1.0 (+https://www.traderjournal.space)`), never a spoofed browser — a block should be a conversation, not a mystery.
- Never fetched from the browser. One IP, one cadence, one place.

## 2 · A 429 returns a 200-shaped HTML body — the trap that eats the archive

The first hit returned `<!DOCTYPE html>` before a status code was captured. **`response.ok` is not a sufficient guard.** Sniff for `<weeklyevents` before parsing; a parse yielding zero events is routed to failure, **never** to the upsert. Pinned by a test that feeds the real 3.3 KB page in and asserts `[]` plus zero writes.

Because the table is an append-only archive rather than a cache, a naive `if (res.ok)` would not merely serve stale data — it would be the ingest half of a wipe. This is the single most valuable test in the suite.

## 3 · A feed that fails *healthy* — the most dangerous class here

`investing.com/rss/news_285.rss` returns HTTP 200, well-formed XML, 10 items, newest `<pubDate>` **2024-11-26** — ~20 months stale. It sails through every soft-fail check and would quietly render two-year-old headlines as today's tape. **Do not use it, at any phase.**

**Freshness is a validity check, not a display detail.** Every feed gets an age gate on its newest item, not just a status check. Any future source is probed the same way before shipping — one of three "verified working" sources in the brief was already dead, and only a `pubDate` inspection caught it.

## 4 · RSS terms — the sharpest edge, because Terminal Pro is a paid tier

Dow Jones / MarketWatch RSS terms permit personal, non-commercial consumption. Redistributing feed content **inside a product you charge for** is a materially different posture from a free reader.

**This is the reason the wire pane is out of Phase 1**, ahead of "nothing honest to show". Two plans waved it through.

- When it does ship: headline, link, source name and timestamp only. **Never `<description>`** — MarketWatch ships full teaser paragraphs; do not persist them. Every row hyperlinks to the publisher, source name always visible. Cache respects the declared `ttl 60`.
- **Flag for the user:** this wants a lawyer's five minutes before money changes hands, not an engineer's judgement. A safe alternative is to ship the headlines pane to free users too, so the paid tier bills for the **fusion**, not for redistributing someone else's headlines.

## 5 · Timezone — largely dissolved, one residual

Feed times are **UTC**, proven against five independent zones in the real fixture, with both America/New_York and Europe/London affirmatively ruled out by the same data. This deletes the entire DST-gap / ambiguous-hour / `Intl`-offset-inversion risk class that two plans built machinery for.

The residual is not a maths bug but an operational one: **a publisher can change a default that a proof cannot prevent.** Two cheap knobs, both kept:
- **Ingest anchor assert** — if a parsed `78-us-cpi-mm` row does not land at 12:00 or 13:00 UTC, warn and write nothing. A future re-zoning becomes a log line on the first bad fetch instead of a silent multi-hour lie.
- **Display** — every countdown renders the absolute local time beside it, so a systematic shift is obvious to the trader within seconds rather than wrong forever.

"All Day" and "Tentative" rows get `all_day = TRUE` and are excluded from countdowns, arming and minute-level correlation. **A countdown to an event with no time is fiction.**

## 6 · Bulk-import poisoning — the highest-impact correctness risk in the feature

`handleBulkImport` (`app.js:3346`) routes through `buildTradeRecord`, the same funnel as live capture. A bulk import's `createdAt` is the **import** time, not the entry time.

Without the guard, every imported row is stamped with whatever was on the calendar the afternoon you ran the import — **fabricating correlations that look real and are not.** That is the difference between a moat and a liar, and it is three conditions: `!existingId && !tradeInput.importBatchId && date === today`.

`releaseClockEdge` carries the same filter for the same reason. `propRules.js` already documents this class of limitation; this matches its candour.

## 7 · Too few trades — the default state, not an edge case

Most users sit in `anecdote`/`thin` for months, and some event families will never clear n=10.

- Enforced **in the pure library, not the view**: `winRate` is literally `null` below n=5, so no template can render a rate; `verdict` is `""` below n=10, so the UI cannot print a verdict it was not given. Asserted at n=4.
- `sentence` is built in the tested library and asserted to contain no `%` below threshold.
- Per-bucket `n`: a 2-trade "worst window" is the most seductive lie this feature can tell.
- Comparison is against the trader's **own** baseline, never 50%.
- **Day-one fallback:** `releaseClockEdge`, which needs no stamps and no archive.
- The three features needing **no history at all** — countdown, auto-stamp, arming — carry the product while the file fills.

## 8 · The archive is append-only and unrecoverable

`ff_calendar_nextweek.xml` is a **404** and `thisweek` rolls over every Sunday. **A week nobody logs in during is gone permanently — no backfill exists at any price.**

This is why `market_events` never deletes, and why the Vercel cron is the **first** Phase 2 item rather than an optional cache-warm. One plan specified reconcile-deletes against this table; that would have destroyed history the product cannot re-acquire.

## 9 · Stale feed arming a phantom event

A lock triggered by an event that already passed or was rescheduled is worse than no lock — it destroys trust in the whole feature. `armingWindow` takes staleness as an argument and returns `null` when the calendar is stale. Countdowns still render, wearing an age badge. **Arming is the only feature that fails closed; everything else degrades to cached display.**

## 10 · Client clock skew

A browser clock four minutes fast arms early, on real money. `serverNow` rides every response; `state.terminal.skewMs` is computed per fetch and applied to every countdown. Three lines, removes the class.

## 11 · windows-1252

`response.text()` assumes UTF-8 and mangles smart quotes in event titles, which are user-visible. `arrayBuffer()` + `TextDecoder('windows-1252')` — built into Node 22, no dependency. **This week's real fixture is pure ASCII, so it cannot catch a regression here** — hence the synthetic 6-byte `0x92` test. A good fixture that is blind to a failure mode is not coverage.

## 12 · Near-duplicate events

The fixture carries ADP Weekly Employment Change at both `12:15pm` and `12:16pm` with different `previous` values. The `(event_key, starts_at)` PK keeps both — correct for an archive, noisy for display. **Collapse same-key-same-hour at render, not at write.**

## 13 · Payload growth

`eventContext` rides the `trades` JSONB, which has no size cap — the 128 KB ceiling in `sanitize.js` applies to **settings** only. Bounded by design: Medium+ only (53 of 73 events per week are Low), max 3 entries, short keys ⇒ ~180 bytes/trade, ~87 KB at 482 trades. Acceptable; revisit around 5,000 trades.

## 14 · Existing constraints this feature inherits

- **Trades JSONB is last-write-wins across devices.** A stamp written on the laptop can be lost by a save from the phone. Not new and not made worse, but `eventContext` is now among the casualties. Worth a line in `MVP.md` beside the existing normalization deferral.
- **TDZ boot trap** — `state.terminal` and every new module-level binding go **above** `init()` (`app.js:954`). `tests/bootOrder.check.mjs` already enforces this and will fail the build; `node --check` will not, because the file stays syntactically perfect. Shipped four times.
- **Pool `max: 1` per warm instance.** The cache path is 2 statements; the refresh path ~4. `upsertMarketEvents` takes the whole week in **one** multi-row `INSERT … ON CONFLICT` — do not add a per-event query loop the way `upsertSymbolPrices` does.
- **Neon cold starts.** `market_calendar` inherits the same first-request latency as every other action. Combined with an 8s upstream timeout on the once-per-15-minutes refresh path it is the slowest request in the app — but it lands on a background poll, never on a user-blocking path. That is the argument for the Phase 2 cron.

## 15 · The tier flag is not enforcement

`TERMINAL_PRO_USERNAMES` gates the **buttons**, not the data. Correct in Phase 1 because there is no premium data behind it — the calendar is public and every statistic is computed in the user's own browser from their own trades. **Wrong the day anyone pays**, at which point the gate moves onto the action. Written into the code comment now so nobody later mistakes `state.auth.terminalPro` for a security boundary.

## SQL (paste into Neon by hand)

-- ═══════════════════════════════════════════════════════════════════════════
--  TERMINAL PRO — Phase 1 schema.  PASTE THIS INTO THE NEON SQL CONSOLE BY HAND.
--
--  api/_lib/db.js issues NO DDL, ever — deliberately, and it says so at length:
--  "the strongest data-safety guarantee available is that the new code *cannot*
--  alter it — no DROP, no ALTER, no CREATE, not even a guarded one."
--  This file is the only place these tables come from.
--
--  Also append this block to db/schema.sql so a brand-new database still sets
--  up in one pass.  Safe to re-run: everything is IF NOT EXISTS / ON CONFLICT.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. market_events ───────────────────────────────────────────────────────
--  This table is BOTH the request cache AND a permanent archive, deliberately.
--
--  ForexFactory publishes only the current Sunday-Saturday week:
--  ff_calendar_nextweek.xml returns HTTP 404 (verified 2026-08-09), and
--  thisweek rolls over every Sunday.  A week that is never fetched is gone
--  FOREVER, at any price -- there is no keyless historical calendar anywhere.
--  Append-only accumulation is the cheapest possible insurance against an
--  irreversible data loss, and it costs exactly one extra index over a
--  single-blob cache.
--
--  Therefore: the ingest UPSERTS and NEVER DELETES.  Do not add a "reconcile"
--  step that prunes rows outside the fetched week -- it would destroy history
--  the product cannot re-acquire.
--
--  event_key is the stable numeric family id lifted from the FF url slug
--  (".../calendar/78-us-cpi-mm" -> "78-us-cpi-mm").  Verified present on all
--  73 events in a real week.  It survives title rewordings, needs no string
--  normalisation, and cannot over-merge: Core CPI is 79-us-core-cpi-mm while
--  headline CPI is 78-us-cpi-mm, separated by the publisher at source.
--
--  starts_at is UTC.  The feed's times ARE UTC -- verified 2026-08-09 against
--  five independent zones in one file:
--      USD CPI m/m          12:30pm = 08:30 EDT
--      AUD Cash Rate         4:30am = 14:30 AEST
--      GBP GDP m/m           6:00am = 07:00 BST
--      JPY Bank Lending     11:50pm = 08:50 JST next day
--      NZD Inflation Exp     3:00am = 15:00 NZST
--  Offsets -4, +10, +1, +9 and +12 resolve only under a UTC reading, and the
--  same data rules OUT both America/New_York (CPI would read 8:30am) and
--  Europe/London (CPI would read 1:30pm).  So the parser calls Date.UTC()
--  directly: no Intl, no DST correction, no zone column.  Intl is used for
--  DISPLAY only, in the browser's own zone.
--
--  There is deliberately NO `actual` column.  The weekly XML has no <actual>
--  element at all -- confirmed by scanning every one of the 73 events.  Until
--  a keyless source is verified, the product says "CPI print", never
--  "CPI miss".  A column that can only ever hold '' is not schema, it is a
--  promise you cannot keep.
--
--  all_day = TRUE covers "All Day" and "Tentative" rows.  They keep a
--  starts_at of the date at 00:00 UTC so the primary key stays simple, but
--  countdown, arming and trade correlation MUST skip them: a countdown to an
--  event with no time is fiction.
--
--  forecast/previous are TEXT, not NUMERIC.  Real values in the fixture
--  include "4.05M", "-294.6B", "202K" and the bond-auction form "4.58|2.6".
--
--  impact has FOUR values, not three: Low | Medium | High | Holiday.
--  Holiday ranks below Low and is excluded from ranking and arming, but is
--  still displayed -- a JPY bank holiday is WHY the tape is dead that session.
CREATE TABLE IF NOT EXISTS market_events (
    event_key     TEXT        NOT NULL,
    starts_at     TIMESTAMPTZ NOT NULL,
    currency      VARCHAR(8)  NOT NULL,          -- the feed's <country>: USD, JPY, GBP
    title         TEXT        NOT NULL,
    impact        VARCHAR(8)  NOT NULL DEFAULT 'Low',
    forecast      TEXT        NOT NULL DEFAULT '',
    previous      TEXT        NOT NULL DEFAULT '',
    url           TEXT        NOT NULL DEFAULT '',
    all_day       BOOLEAN     NOT NULL DEFAULT FALSE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- (key, instant), NOT key alone.  A key-only PK would collapse every
    -- monthly CPI into one row and destroy the entire edge file.
    PRIMARY KEY (event_key, starts_at)
);

-- The request-path read: "events in a window, soonest first".
CREATE INDEX IF NOT EXISTS idx_market_events_starts_at
    ON market_events (starts_at);

-- The edge-file read: "every past occurrence of this event family, newest first".
CREATE INDEX IF NOT EXISTS idx_market_events_key_starts
    ON market_events (event_key, starts_at DESC);


-- ── 2. feed_state ──────────────────────────────────────────────────────────
--  One row per upstream feed.  Three jobs in four columns:
--
--   last_attempt_at  The single-flight claim clock, and the whole concurrency
--                    story.  WITHOUT it, a 429 from a shared Vercel egress IP
--                    means every request retries and you stay rate-limited
--                    permanently.  last_success_at alone CANNOT express
--                    "we tried 30 seconds ago and were refused" -- which is
--                    exactly the state you spend most of your time in.
--   last_success_at  Drives the honest "calendar as of HH:MM" / stale badge.
--                    Never last_attempt_at, which ticks forward on failures.
--   payload          Phase 2 headlines live here, so Phase 2 adds NO table.
CREATE TABLE IF NOT EXISTS feed_state (
    source          VARCHAR(32) PRIMARY KEY,
    payload         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
    last_success_at TIMESTAMPTZ NULL,
    -- 'ok' | 'http' | 'parse' | 'stale' | 'timeout' | 'zone-drift'.
    -- 'stale' is its own outcome on purpose: investing.com serves HTTP 200
    -- with well-formed items whose newest pubDate is 20 months old.  A feed
    -- that looks healthy and is frozen must FAIL, not display.
    last_status     TEXT        NOT NULL DEFAULT '',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the rows.  LOAD BEARING, not convenience: the claim UPDATE below
-- matches nothing when the row is absent, which silently means "never fetch".
-- Only ff_calendar is used in Phase 1; mw_headlines is seeded now so Phase 2
-- needs no further console access.
INSERT INTO feed_state (source) VALUES ('ff_calendar')
    ON CONFLICT (source) DO NOTHING;
INSERT INTO feed_state (source) VALUES ('mw_headlines')
    ON CONFLICT (source) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
--  NOT CREATED -- deliberately absent
--
--  There is NO table for the per-trade context stamp.  api/_lib/sanitize.js:170
--  does `const item = { ...entry };` and only overwrites KNOWN keys, so
--  arbitrary fields on a trade survive the server round-trip intact.  The stamp
--  rides in the existing trades.payload JSONB as `eventContext` and costs zero
--  schema and zero backend change.
--
--  There is NO tier/billing table in Phase 1.  Entitlement is the
--  TERMINAL_PRO_USERNAMES env allowlist, the same shape ADMIN_USERNAMES
--  already uses at api/_lib/router.js:213.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  Statements api/_lib/db.js runs against the above.  REFERENCE ONLY -- none
--  of this needs pasting.  Included so the concurrency story is reviewable in
--  one place.
-- ═══════════════════════════════════════════════════════════════════════════

-- claimFeedFetch(source, ttlSeconds) -- the entire single-flight mechanism.
--   rowCount 1 => this invocation owns the upstream fetch.
--   rowCount 0 => another warm instance already claimed it; serve the cache.
-- Atomic under Postgres row locking.  No advisory lock, no lock table, no
-- cron, no queue.  Worst case of a race is one duplicate fetch.
--
--   UPDATE feed_state SET last_attempt_at = NOW(), updated_at = NOW()
--    WHERE source = $1
--      AND last_attempt_at < NOW() - make_interval(secs => $2)
--   RETURNING source;

-- upsertMarketEvents(rows) -- ONE multi-row statement for the whole week, not
-- 73 round-trips (pool max is 1 per warm instance).  Re-running a week
-- refreshes forecast/previous as FF revises them mid-week; first_seen_at
-- stays put.  Note there is no DELETE anywhere: see the archive note above.
--
--   INSERT INTO market_events
--       (event_key, starts_at, currency, title, impact,
--        forecast, previous, url, all_day)
--   SELECT * FROM UNNEST($1::text[], $2::timestamptz[], $3::varchar[],
--                        $4::text[], $5::varchar[], $6::text[],
--                        $7::text[], $8::text[], $9::boolean[])
--   ON CONFLICT (event_key, starts_at) DO UPDATE SET
--       currency   = EXCLUDED.currency,
--       title      = EXCLUDED.title,
--       impact     = EXCLUDED.impact,
--       forecast   = EXCLUDED.forecast,
--       previous   = EXCLUDED.previous,
--       url        = EXCLUDED.url,
--       all_day    = EXCLUDED.all_day,
--       updated_at = NOW();

-- markFeedSuccess(source, status)
--
--   UPDATE feed_state
--      SET last_success_at = NOW(), last_status = $2, updated_at = NOW()
--    WHERE source = $1;

-- markFeedFailure(source, status) -- attempt clock already moved by the claim,
-- so a failure only records WHY.  The 300s backoff is the claim TTL argument.
--
--   UPDATE feed_state SET last_status = $2, updated_at = NOW() WHERE source = $1;

-- loadMarketEvents() -- the action=market_calendar read.  The -24h half is what
-- lets "you opened this 8 minutes after CPI" resolve for trades taken today.
--
--   SELECT event_key, starts_at, currency, title, impact,
--          forecast, previous, url, all_day
--     FROM market_events
--    WHERE starts_at BETWEEN NOW() - INTERVAL '24 hours'
--                        AND NOW() + INTERVAL '8 days'
--    ORDER BY starts_at ASC;


-- ═══════════════════════════════════════════════════════════════════════════
--  PHASE 2 ONLY -- DO NOT PASTE THIS YET.
--  Run it when entitlement should move off the env var and into the database.
--  One function body changes (isTerminalProUsername reads this column instead
--  of the allowlist); nothing else in the codebase moves.  This is still not
--  billing -- an admin sets the value.  Billing is its own project.
-- ═══════════════════════════════════════════════════════════════════════════
-- ALTER TABLE journal_users
--     ADD COLUMN IF NOT EXISTS tier VARCHAR(16) NOT NULL DEFAULT 'free';
-- CREATE INDEX IF NOT EXISTS idx_journal_users_tier ON journal_users (tier);
