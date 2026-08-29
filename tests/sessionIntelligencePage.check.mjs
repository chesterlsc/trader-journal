// Focused page-level contract for Session Intelligence.
//
// The calculation engine and Topstep reconstruction have their own fixture
// suites. This check guards the integration points that are easiest to regress
// during a visual cleanup: the route, the single almanac surface and its
// honesty copy, saved filters, the cell disclosure drawer, journal-queue
// placement, and the one-time source-timezone gate in the import flow.
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
  /id="sessionAlmanacMatrix"/,
  /id="sessionDurationBands"/,
  /id="dashUnjournalled"/,
  /panel-session-intelligence/
]) {
  assert.doesNotMatch(dashboard, forbidden, "the full timing report or journal queue leaked back onto the dashboard");
}

// --- 3. One surface: the almanac, its engine, its radar, its margins -------
assert.equal(count(sessionView, /data-session-tab=/g), 0, "the almanac page has no sub-tabs");
assert.equal(count(sessionView, /data-session-panel=/g), 0, "no hidden panels; everything lives on the one surface");
assert.doesNotMatch(appSrc, /activateSessionIntelligenceTab/, "tab machinery must not survive the one-surface design");
for (const id of [
  "sessionAlmanacMatrix",
  "sessionAlmanacNow",
  "sessionAlmanacEdgeline",
  "sessionAlmanacNote",
  "sessionCounterfactualChart",
  "sessionCfGap",
  "sessionCfReal",
  "sessionCfGhost",
  "sessionCfLedger",
  "sessionCfConclusion",
  "sessionTiltCount",
  "sessionTiltNetLabel",
  "sessionTiltNet",
  "sessionTiltWin",
  "sessionTiltBaseline",
  "sessionTiltInsight",
  "sessionScorecard",
  "sessionDurationBands",
  "sessionTopstepExecution",
  "sessionWinningHold",
  "sessionLosingHold",
  "sessionBestDuration",
  "sessionCoverageBar",
  "sessionJournaledCount",
  "sessionUnjournalledCount",
  "sessionCoveragePercent",
  "sessionMissingDataCount"
]) {
  assert.equal(count(sessionView, new RegExp(`id="${id}"`, "g")), 1, `#${id} must appear exactly once on the surface`);
}
assert.match(
  sessionView,
  /withheld, never estimated/i,
  "the withhold rule must be stated on the page, not only enforced in the engine"
);
assert.match(
  sessionView,
  /does not prove how long a trade spent above breakeven/i,
  "hold-time wording must not overclaim intratrade profitability"
);
assert.match(
  sessionView,
  /Hypothetical, not advice/i,
  "the counterfactual caveat must live in markup, not only in renderer copy"
);
assert.match(
  sessionView,
  /never guessed into the pattern/i,
  "tilt wording must pin the broker-timestamps-only rule"
);
assert.doesNotMatch(sessionView, /<table\b|<canvas\b/, "the surface must not fall back to a dense table or extra chart");

// --- 4. Nothing beyond the reference: no queue, no leftover mounts ---------
// The dashboard is exactly the reference surface. The journal queue's compact
// coverage pane stays; the queue list itself does not, and no orphaned mount
// may linger anywhere in the document.
for (const id of [
  "dashUnjournalled",
  "dashUnjournalledCount",
  "dashUnjournalledList",
  "dashJournalCta",
  "dashJournalCtaCount",
  "dashJournalStreak",
  "dashJournalBars"
]) {
  assert.equal(count(html, new RegExp(`id="${id}"`, "g")), 0, `#${id} must not exist anywhere; the queue is not part of the dashboard`);
}
assert.match(sessionView, /id="sessionHeaderNet"/, "the header meta strip must state the report net");

// --- 5. Filters are saved and re-render live -------------------------------
for (const id of ["sessionDateRange", "sessionReportTimeZone"]) {
  assert.match(sessionView, new RegExp(`id="${id}"`), `missing #${id} compact report control`);
}
assert.match(appSrc, /sessionDateRange:\s*"all"/);
assert.match(appSrc, /\["30d",\s*"90d",\s*"ytd",\s*"all"\]\.includes\(value\.sessionDateRange\)/);
for (const key of ["timingReportTimeZone", "topstepSourceTimeZone", "sessionDateRange"]) {
  assert.match(sanitizeSrc, new RegExp(`["']${key}["']`), `${key} must survive API persistence`);
}

assert.match(appSrc, /ui\.sessionDateRange\?\.addEventListener\("change", handleSessionIntelligenceFilterChange\)/);
assert.match(appSrc, /ui\.sessionReportTimeZone\?\.addEventListener\("change", handleSessionIntelligenceFilterChange\)/);
{
  const source = takeFunction(appSrc, "handleSessionIntelligenceFilterChange");
  assert.match(source, /state\.settings\s*=\s*normalizeSettings\(/, "filter changes must write normalized saved settings");
  assert.match(source, /persistState\(\)/, "filter changes must remember the selection");
  assert.match(source, /renderAll\(\)/, "filter changes must update calculations immediately");
}
assert.match(appSrc, /buildSessionTimingReport\(ordered,\s*\{[\s\S]*reportTimeZone:[\s\S]*sourceTimeZone:[\s\S]*dateRange:/);

// --- 6. Clicking an almanac cell discloses only that cell's trades ---------
for (const id of ["sessionTradeDrawer", "sessionTradeDrawerTitle", "sessionTradeDrawerBody", "sessionTradeDrawerClose"]) {
  assert.match(sessionView, new RegExp(`id="${id}"`), `the almanac cell drawer is missing #${id}`);
}
assert.match(appSrc, /ui\.sessionAlmanacMatrix\?\.addEventListener\("click"/);
assert.match(appSrc, /closest\("\[data-almanac-cell\]"\)/);
assert.match(appSrc, /openSessionTradeDrawer\(cell\.dataset\.almanacCell\)/);
const matrixRenderer = takeFunction(appSrc, "renderSessionAlmanac");
assert.match(matrixRenderer, /data-almanac-cell/, "the matrix renderer must emit the disclosure target used by the click handler");
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
  "sessionIntelligencePage.check.mjs: OK — dedicated route, one almanac surface, saved controls, cell drawer, coverage queue, and Topstep timezone gate"
);
