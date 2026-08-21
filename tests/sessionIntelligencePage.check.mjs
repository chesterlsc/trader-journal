// Focused page-level contract for Session Intelligence.
//
// The calculation engine and Topstep reconstruction have their own fixture
// suites. This check guards the integration points that are easiest to regress
// during a visual cleanup: the route, the four-tab information hierarchy,
// saved filters, the hourly disclosure drawer, journal-queue placement, and
// the one-time source-timezone gate in the import flow.
//
// Run: node tests/sessionIntelligencePage.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const html = read("index.html");
const appSrc = read("app.js");
const sanitizeSrc = read("api/_lib/sanitize.js");

const count = (source, pattern) => [...source.matchAll(pattern)].length;
const countClassToken = (source, token) => [...source.matchAll(/class="([^"]*)"/g)]
  .filter((match) => match[1].split(/\s+/).includes(token)).length;

function takeFunction(source, name) {
  const start = source.search(new RegExp(`^function ${name}\\(`, "m"));
  assert.ok(start >= 0, `missing function ${name}`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return source.slice(start, end + 3);
}

function takeView(id) {
  const pattern = new RegExp(`<section\\b[^>]*class="[^"]*\\bview\\b[^"]*"[^>]*id="${id}"[^>]*>`);
  const match = pattern.exec(html);
  assert.ok(match, `missing #${id} view`);
  const afterOpen = match.index + match[0].length;
  const next = /<section\b[^>]*class="[^"]*\bview\b[^"]*"[^>]*id="/.exec(html.slice(afterOpen));
  const end = next ? afterOpen + next.index : html.length;
  return html.slice(match.index, end);
}

function takeElementByOpening(source, openingPattern, closingTag) {
  const match = openingPattern.exec(source);
  assert.ok(match, `${openingPattern} not found`);
  const end = source.indexOf(`</${closingTag}>`, match.index + match[0].length);
  assert.ok(end > match.index, `unclosed <${closingTag}> after ${openingPattern}`);
  return source.slice(match.index, end + closingTag.length + 3);
}

const dashboard = takeView("dashboard");
const sessionView = takeView("session-intelligence");

// --- 1. A real, reachable top-level route ---------------------------------
assert.match(
  sessionView,
  /^<section class="view session-page" id="session-intelligence"/,
  "Session Intelligence must be its own .view route"
);
for (const [surface, source] of [
  ["desktop rail", takeElementByOpening(html, /<nav class="rail"(?=\s|>)/, "nav")],
  ["tablet navigation sheet", takeElementByOpening(html, /<nav class="main-nav" id="mainNav"(?=\s|>)/, "nav")],
  ["mobile tab bar", takeElementByOpening(html, /<nav class="tabbar" id="tabBar"(?=\s|>)/, "nav")]
]) {
  assert.match(
    source,
    /class="[^"]*nav-btn[^"]*"[^>]*data-target="session-intelligence"/,
    `${surface} must expose Session Intelligence as a top-level destination`
  );
}

const getViewFromHash = takeFunction(appSrc, "getViewFromHash");
assert.match(getViewFromHash, /window\.location\.hash/);
assert.match(getViewFromHash, /ui\.views\.some\(\(view\) => view\.id === id\)/);
const switchView = takeFunction(appSrc, "switchView");
assert.match(switchView, /view\.classList\.toggle\("is-active", view\.id === id\)/);
assert.match(switchView, /window\.location\.hash|window\.history\.replaceState/);

// --- 2. Dashboard is only a quiet hand-off --------------------------------
assert.equal(count(dashboard, /id="dashSessionIntelligenceLink"/g), 1);
assert.match(
  dashboard,
  /id="dashSessionIntelligenceLink"[^>]*data-target="session-intelligence"/,
  "dashboard link must use the normal route wiring"
);
for (const forbidden of [
  /data-session-tab=/,
  /data-session-panel=/,
  /id="sessionScorecard"/,
  /id="sessionHourRail"/,
  /id="sessionDurationBands"/,
  /id="dashUnjournalled"/,
  /panel-session-intelligence/
]) {
  assert.doesNotMatch(dashboard, forbidden, "the full timing report or journal queue leaked back onto the dashboard");
}

// --- 3. Four tabs, each with one conclusion and one visualization ----------
const expectedTabs = ["sessions", "entry-time", "hold-time", "journal-coverage"];
const tabNames = [...sessionView.matchAll(/data-session-tab="([^"]+)"/g)].map((match) => match[1]);
const panelNames = [...sessionView.matchAll(/data-session-panel="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(tabNames, expectedTabs, "Session Intelligence must have exactly the four briefed tabs, in order");
assert.deepEqual(panelNames, expectedTabs, "each Session Intelligence tab must own exactly one panel");
assert.match(sessionView, /class="session-tab is-active"[\s\S]*aria-selected="true"[\s\S]*data-session-tab="sessions"/);
assert.match(appSrc, /ui\.sessionTabs\.forEach\(\(button\) => \{[\s\S]*activateSessionIntelligenceTab\(button\.dataset\.sessionTab\)/);
const activateTab = takeFunction(appSrc, "activateSessionIntelligenceTab");
assert.match(activateTab, /aria-selected/);
assert.match(activateTab, /\.hidden\s*=/, "tab activation must show only its matching panel");

const panelStarts = expectedTabs.map((name) => {
  const match = new RegExp(`<section\\b[^>]*data-session-panel="${name}"[^>]*>`).exec(sessionView);
  assert.ok(match, `missing ${name} panel`);
  return { name, index: match.index };
});
const panelByName = new Map(panelStarts.map((item, index) => [
  item.name,
  sessionView.slice(item.index, panelStarts[index + 1]?.index ?? sessionView.length)
]));

const visualizationIds = new Map([
  ["sessions", "sessionScorecard"],
  ["entry-time", "sessionHourRail"],
  ["hold-time", "sessionDurationBands"],
  ["journal-coverage", "sessionCoverageBar"]
]);
for (const name of expectedTabs) {
  const panel = panelByName.get(name);
  assert.equal(countClassToken(panel, "session-conclusion"), 1, `${name}: needs one clear conclusion`);
  const metricCount = countClassToken(panel, "session-primary-metric");
  assert.ok(metricCount > 0 && metricCount <= 3, `${name}: expected 1–3 primary metrics, found ${metricCount}`);
  assert.equal(countClassToken(panel, "session-visual"), 1, `${name}: needs exactly one primary visualization`);
  assert.match(panel, new RegExp(`id="${visualizationIds.get(name)}"`), `${name}: visualization mount changed or disappeared`);
  assert.doesNotMatch(panel, /<table\b|<canvas\b/, `${name}: default panel must not fall back to a dense table or extra chart`);
}

assert.match(
  panelByName.get("sessions"),
  /id="sessionBestSessionPnl"[\s\S]*id="sessionBestSessionExpectancy"[\s\S]*id="sessionBestSessionTrades"/,
  "Sessions must keep only the three primary values from the brief"
);
assert.match(panelByName.get("entry-time"), /id="sessionBestHour"[\s\S]*id="sessionWorstHour"/);
assert.match(
  panelByName.get("hold-time"),
  /id="sessionWinningHold"[\s\S]*id="sessionLosingHold"[\s\S]*id="sessionBestDuration"/,
  "Hold time must compare profitable, losing, and best-duration results"
);
assert.match(
  panelByName.get("hold-time"),
  /does not prove how long a trade spent above breakeven/i,
  "hold-time wording must not overclaim intratrade profitability"
);

// --- 4. The operational queue lives only in Journal coverage ---------------
const coveragePanel = panelByName.get("journal-coverage");
for (const id of [
  "dashUnjournalled",
  "dashUnjournalledCount",
  "dashUnjournalledList",
  "dashJournalCta",
  "dashJournalCtaCount",
  "dashJournalStreak",
  "dashJournalBars"
]) {
  assert.equal(count(html, new RegExp(`id="${id}"`, "g")), 1, `#${id} must not be duplicated`);
  assert.match(coveragePanel, new RegExp(`id="${id}"`), `#${id} must live in Journal coverage`);
}
assert.match(coveragePanel, /id="sessionJournaledCount"[\s\S]*id="sessionUnjournalledCount"[\s\S]*id="sessionCoveragePercent"/);
assert.match(coveragePanel, /id="sessionMissingDataCount"/);
assert.match(coveragePanel, /id="dashJournalCta"[\s\S]*Journal next trade/i);

// --- 5. Filters and the one-at-a-time entry metric are saved + live --------
for (const id of ["sessionDateRange", "sessionReportTimeZone"]) {
  assert.match(sessionView, new RegExp(`id="${id}"`), `missing #${id} compact report control`);
}
assert.deepEqual(
  [...sessionView.matchAll(/data-entry-metric="([^"]+)"/g)].map((match) => match[1]),
  ["pnl", "expectancy", "winRate"],
  "Entry time must offer exactly Net P&L, expectancy, and win rate"
);
assert.match(appSrc, /sessionDateRange:\s*"all"/);
assert.match(appSrc, /sessionEntryMetric:\s*"pnl"/);
assert.match(appSrc, /\["30d",\s*"90d",\s*"ytd",\s*"all"\]\.includes\(value\.sessionDateRange\)/);
assert.match(appSrc, /\["pnl",\s*"expectancy",\s*"winRate"\]\.includes\(value\.sessionEntryMetric\)/);
for (const key of ["timingReportTimeZone", "topstepSourceTimeZone", "sessionDateRange", "sessionEntryMetric"]) {
  assert.match(sanitizeSrc, new RegExp(`["']${key}["']`), `${key} must survive API persistence`);
}

assert.match(appSrc, /ui\.sessionDateRange\?\.addEventListener\("change", handleSessionIntelligenceFilterChange\)/);
assert.match(appSrc, /ui\.sessionReportTimeZone\?\.addEventListener\("change", handleSessionIntelligenceFilterChange\)/);
assert.match(appSrc, /button\.addEventListener\("click", \(\) => handleSessionEntryMetricChange\(button\.dataset\.entryMetric\)\)/);
for (const name of ["handleSessionIntelligenceFilterChange", "handleSessionEntryMetricChange"]) {
  const source = takeFunction(appSrc, name);
  assert.match(source, /state\.settings\s*=\s*normalizeSettings\(/, `${name} must write normalized saved settings`);
  assert.match(source, /persistState\(\)/, `${name} must remember the selection`);
  assert.match(source, /renderAll\(\)/, `${name} must update calculations immediately`);
}
assert.match(appSrc, /buildSessionTimingReport\(ordered,\s*\{[\s\S]*reportTimeZone:[\s\S]*sourceTimeZone:[\s\S]*dateRange:/);

// --- 6. Clicking an hour discloses only that hour's trades -----------------
const entryPanel = panelByName.get("entry-time");
for (const id of ["sessionTradeDrawer", "sessionTradeDrawerTitle", "sessionTradeDrawerBody", "sessionTradeDrawerClose"]) {
  assert.match(entryPanel, new RegExp(`id="${id}"`), `entry-time drawer is missing #${id}`);
}
assert.match(appSrc, /ui\.sessionHourRail\?\.addEventListener\("click"/);
assert.match(appSrc, /closest\("\[data-session-hour\]"\)/);
assert.match(appSrc, /openSessionTradeDrawer\(Number\(hour\.dataset\.sessionHour\)\)/);
const hourRenderer = takeFunction(appSrc, "renderSessionHourRail");
assert.match(hourRenderer, /data-session-hour/, "hour renderer must emit the disclosure target used by the click handler");
const openDrawer = takeFunction(appSrc, "openSessionTradeDrawer");
takeFunction(appSrc, "closeSessionTradeDrawer");
assert.match(openDrawer, /data-session-journal-trade/, "the drawer must offer the journal action for its listed trades");
assert.match(appSrc, /openJournalSheet\(journalButton\.dataset\.sessionJournalTrade\)/);

// --- 7. Zone-less Topstep Trades ask once, then reuse the saved answer -----
const importDialog = takeElementByOpening(html, /<dialog id="tradeImportDialog"(?=\s|>)/, "dialog");
assert.match(importDialog, /id="topstepTimeZoneConfirm"[^>]*hidden/);
assert.match(importDialog, /id="topstepImportTimeZone"/);
assert.match(importDialog, /id="topstepImportTimeZoneConfirmBtn"/);

const requirementSource = takeFunction(appSrc, "getTopstepTimeZoneRequirement");
const makeRequirement = (savedZone) => {
  const state = { settings: { topstepSourceTimeZone: savedZone } };
  const normalizeTimingTimeZone = (value, fallback = "") => String(value || fallback || "").trim();
  // eslint-disable-next-line no-new-func
  return new Function(
    "state",
    "normalizeTimingTimeZone",
    `${requirementSource}\nreturn getTopstepTimeZoneRequirement;`
  )(state, normalizeTimingTimeZone);
};

const zoneLess = { fileKind: "trades", trades: [{ sourceTimezoneProvenance: "unresolved" }] };
assert.deepEqual(
  makeRequirement("")(zoneLess),
  { needsConfirmation: true, confirmedTimeZone: "", ready: false },
  "a zone-less Topstep Trades export must stop before import"
);
assert.deepEqual(
  makeRequirement("Asia/Manila")(zoneLess),
  { needsConfirmation: true, confirmedTimeZone: "Asia/Manila", ready: true },
  "the previously confirmed source timezone must be reused"
);
assert.equal(
  makeRequirement("")({ fileKind: "trades", trades: [{ sourceTimezoneProvenance: "export" }] }).needsConfirmation,
  false,
  "an export-proven timezone must not prompt"
);
assert.equal(
  makeRequirement("")({ fileKind: "orders", trades: [{ sourceTimezoneProvenance: "unresolved" }] }).needsConfirmation,
  false,
  "the Trades-only confirmation must not interfere with already normalized Orders reconstruction"
);

const syncZone = takeFunction(appSrc, "syncTopstepTimeZoneConfirmation");
assert.match(syncZone, /hidden\s*=\s*!requirement\.needsConfirmation\s*\|\|\s*requirement\.ready/);
const confirmZone = takeFunction(appSrc, "handleTopstepImportTimeZoneConfirm");
assert.match(confirmZone, /topstepSourceTimeZone:\s*selected/);
assert.match(confirmZone, /persistState\(\)/, "confirmed source timezone must be remembered");
assert.match(confirmZone, /handleBulkPreview\(\)/, "confirmation must immediately re-run the import preview");
const previewSource = takeFunction(appSrc, "handleBulkPreview");
assert.match(previewSource, /syncTopstepTimeZoneConfirmation\(parsed\)/);
assert.match(
  previewSource,
  /ui\.bulkImportBtn\.disabled\s*=\s*ready === 0 \|\| !fullDayConfirmed \|\| !timeZoneRequirement\.ready/,
  "zone-less imports must remain disabled until the one-time confirmation is ready"
);

console.log(
  "sessionIntelligencePage.check.mjs: OK — dedicated route, four focused tabs, saved controls, hour drawer, coverage queue, and Topstep timezone gate"
);
