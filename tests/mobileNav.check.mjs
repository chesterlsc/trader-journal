// The thumb sheet's two load-bearing claims, re-derived from the markup and
// the stylesheets rather than from a memory of them:
//
//   1. NO DUPLICATION — at phone widths the menu must not re-offer a
//      destination the .tabbar already carries. That redundancy (four of six
//      rows) is the whole reason this redesign exists, and a later cascade
//      change could silently restore it.
//   2. NOTHING STRANDED — every <section class="view"> must still be reachable
//      from a control that is actually visible at the width being checked.
//      The four duplicates are hidden with display:none, not deleted, so they
//      come back at 900-1024px where there is no tab bar. If the two
//      breakpoints ever drift apart, four destinations vanish from the phone
//      and nobody notices until someone tries to reach Calendar on a tablet.
//
// Run: node tests/mobileNav.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const html = read("index.html");

// --- markup ----------------------------------------------------------------
const between = (source, startRe, tag) => {
  const start = source.search(startRe);
  assert.ok(start >= 0, `${startRe} not found in index.html`);
  const end = source.indexOf(`</${tag}>`, start);
  assert.ok(end > start, `unclosed <${tag}> after ${startRe}`);
  return source.slice(start, end);
};

const targets = (chunk) => [...chunk.matchAll(/data-target="([^"]+)"/g)].map((m) => m[1]);

const menu = between(html, /<nav class="main-nav" id="mainNav"/, "nav");
const tabbar = between(html, /<nav class="tabbar" id="tabBar"/, "nav");

const views = [...html.matchAll(/<section class="view[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
assert.ok(views.length >= 7, `expected the full view set, found ${views.join(", ")}`);

const dockTargets = new Set(targets(tabbar));
// The dock carries FIVE targets and shows four. The last slot is shared: the
// Edge takes it when the account is entitled, Reflect takes it otherwise, and
// styles.css hides whichever one loses off the [hidden] app.js already sets on
// [data-terminal-nav]. Both are listed here because both are in the markup.
assert.deepEqual(
  [...dockTargets].sort(),
  ["calendar", "dashboard", "journal", "reflections", "terminal"],
  "the tab bar's destinations changed — this check and the .sheet-tile-dock class must follow"
);

// Every menu entry that duplicates the dock must carry .sheet-tile-dock, which
// is the only thing the display:none rule keys on.
for (const button of menu.match(/<button[^>]*>/g) || []) {
  const target = /data-target="([^"]+)"/.exec(button)?.[1];
  if (!target || !dockTargets.has(target)) continue;
  assert.match(
    button,
    /\bsheet-tile-dock\b/,
    `#mainNav's "${target}" duplicates the tab bar but is not marked .sheet-tile-dock, so it is never hidden at phone widths`
  );
}

// --- the two breakpoints must agree ----------------------------------------
// Both are re-read from the sheets. A single literal moving on one side and not
// the other is exactly how destinations get stranded.
// body.app-on is the surface switch (see the convention block in styles.css);
// it replaced the is-authenticated/is-preview/is-guest triple this used to read.
const dockGate = /@media\s*\(max-width:\s*(\d+)px\)\s*\{[^@]*?body\.app-on\s+\.tabbar\b/s.exec(
  read("styles.css")
);
assert.ok(dockGate, "could not find the .tabbar visibility media query in styles.css");

const hideGate = /@media\s*\(max-width:\s*(\d+)px\)\s*\{(?:[^{}]|\{[^{}]*\})*?\.main-nav\s+\.sheet-tile-dock\s*\{\s*display:\s*none/s.exec(
  read("clay-v2.css")
);
assert.ok(hideGate, "could not find the .sheet-tile-dock display:none rule in clay-v2.css");

assert.equal(
  hideGate[1],
  dockGate[1],
  `the menu hides the tab-bar duplicates below ${hideGate[1]}px but the tab bar only exists below ${dockGate[1]}px — ` +
    "between those two widths a destination is unreachable"
);
const PHONE_MAX = Number(dockGate[1]);

// --- reachability, at both widths ------------------------------------------
const menuTargets = new Set(targets(menu));
const phoneMenuTargets = new Set([...menuTargets].filter((t) => !dockTargets.has(t)));

// Phone: dock + the sheet's survivors.
const onPhone = new Set([...dockTargets, ...phoneMenuTargets]);
for (const view of views) {
  assert.ok(onPhone.has(view), `"${view}" has no route at <=${PHONE_MAX}px — not in the tab bar, not in the sheet`);
}

// Tablet (900-1024px): no tab bar at all, so the sheet alone must carry all of
// them — which is why the duplicates stay in the DOM instead of being deleted.
for (const view of views) {
  assert.ok(
    menuTargets.has(view),
    `"${view}" has no route between ${PHONE_MAX + 1}px and 1024px, where .tabbar is display:none and #mainNav is the only navigation`
  );
}

// --- the dev noise left the user-facing list -------------------------------
// Both stay in the DOM and stay wired; they are just no longer full-width rows
// in a menu. #lastSaved must be inside the sheet's foot, not above the fold.
const foot = between(menu, /<div class="sidebar-foot">/, "div");
for (const id of ["lastSaved", "previewLandingBtnMobile"]) {
  assert.match(foot, new RegExp(`id="${id}"`), `#${id} must live in the sheet's foot`);
}
assert.doesNotMatch(
  menu.slice(0, menu.indexOf('<div class="sidebar-foot">')),
  /id="lastSaved"|id="previewLandingBtnMobile"/,
  "autosave state and the dev chip must not be back in the destination list"
);

// --- the account switcher moved to the always-visible rail ------------------
const rail = html.slice(html.search(/<div class="sidebar-header">/), html.search(/<nav class="main-nav"/));
assert.match(rail, /id="accountSwitchNav"/, "the account switcher belongs on the rail, not in the menu");
assert.doesNotMatch(menu, /id="accountSwitchNav"/, "the account switcher is still duplicated inside #mainNav");

// --- the broken half-arc is gone -------------------------------------------
// The bug was `box-shadow: inset 3px 0 0 var(--accent)` on a --radius-pill
// element: a non-zero OFFSET traces the pill's curve, so the rail rendered as a
// violet half-circle bleeding off the left edge. An inset with zero offsets and
// a spread (the ring that replaced it) follows the radius correctly, whatever
// the radius is — so the check is on the offset, not on the word "inset".
const OFFSET_RAIL = /box-shadow:\s*inset\s+(?!0[\s,])[\d.]+[a-z%]/;
for (const file of ["styles.css", "clay-v2.css"]) {
  const rules = [...read(file).matchAll(/\.main-nav[^{}]*\.is-active[^{}]*\{([^}]*)\}/g)];
  assert.ok(rules.length > 0, `${file}: no .main-nav active-state rule found at all`);
  for (const [, body] of rules) {
    assert.doesNotMatch(
      body,
      OFFSET_RAIL,
      `${file}: an offset inset rail is back on a .main-nav active item — on a pill radius it draws the half-arc`
    );
  }
}

// --- the rail's risk groove, driven out of app.js itself -------------------
// Three branches and a division, on the number that ends an account. The
// failure that would ship quietly is branch 2 firing for a prop account that
// has no drawdown limit, or a zero denominator painting a full groove on a
// trader who has not lost anything.
const appSrc = read("app.js");
const start = appSrc.indexOf("function renderNavRisk(");
assert.ok(start >= 0, "renderNavRisk() is gone — the rail's live readout was deleted, not moved");
const source = appSrc.slice(start, appSrc.indexOf("\n}\n", start) + 3);

const node = () => ({ hidden: false, textContent: "", className: "", vars: {}, style: { setProperty(k, v) { this.vars = v; } } });
const runGroove = ({ prop = null, dailyMaxLoss = 0, todayPnl = 0, access = true, level = "safe" }) => {
  const groove = node();
  const ui = { navRiskGroove: groove, navRiskLabel: node(), navRiskValue: node() };
  const state = { settings: { dailyMaxLoss }, analytics: { todayPnl } };
  new Function(
    "ui",
    "state",
    "canAccessApp",
    "getActivePropEvaluation",
    "mllPressure",
    "typicalLossSize",
    "getDailyBudgetLeft",
    "clamp",
    "setText",
    "formatCurrency",
    `${source}\nrenderNavRisk();`
  )(
    ui,
    state,
    () => access,
    () => prop,
    () => ({ level }),
    () => 100,
    () => (dailyMaxLoss > 0 ? Math.max(dailyMaxLoss - Math.max(-todayPnl, 0), 0) : null),
    (v, lo, hi) => Math.min(Math.max(v, lo), hi),
    (n, text) => { n.textContent = text; },
    (v) => `$${v}`
  );
  return {
    hidden: groove.hidden,
    label: ui.navRiskLabel.textContent,
    used: Math.round(Number(groove.style.vars) * 1000) / 1000,
    tone: groove.className
  };
};

// A logged-out visitor never gets a number on the chrome.
assert.equal(runGroove({ access: false, dailyMaxLoss: 300 }).hidden, true);
// No prop, no daily limit: hidden, so the rail reclaims the width.
assert.equal(runGroove({}).hidden, true);
// Branch 2: the personal daily limit, half spent.
const day = runGroove({ dailyMaxLoss: 300, todayPnl: -150 });
assert.deepEqual([day.hidden, day.label, day.used, day.tone], [false, "Day left", 0.5, "rail-groove"]);
assert.equal(runGroove({ dailyMaxLoss: 300, todayPnl: -240 }).tone, "rail-groove is-warn");
assert.equal(runGroove({ dailyMaxLoss: 300, todayPnl: -900 }).tone, "rail-groove is-breach");
// Branch 1 outranks branch 2 even when both exist.
const room = runGroove({ prop: { room: 400, rules: { drawdown: 2000 } }, dailyMaxLoss: 300, todayPnl: -150 });
assert.deepEqual([room.label, room.used, room.tone], ["Room", 0.8, "rail-groove"]);
assert.equal(runGroove({ prop: { room: 400, rules: { drawdown: 2000 } }, level: "warn" }).tone, "rail-groove is-warn");
assert.deepEqual(
  [runGroove({ prop: { room: -50, rules: { drawdown: 2000 } } }).label, runGroove({ prop: { room: -50, rules: { drawdown: 2000 } } }).tone],
  ["Breached", "rail-groove is-breach"]
);
// A prop account with no limit set must fall THROUGH to the daily budget, not
// divide by a zero drawdown.
const fallthrough = runGroove({ prop: { room: null, rules: { drawdown: 0 } }, dailyMaxLoss: 300, todayPnl: -60 });
assert.deepEqual([fallthrough.label, fallthrough.used], ["Day left", 0.2]);
// ...and with nothing else set either, it stays hidden rather than showing $0.
assert.equal(runGroove({ prop: { room: null, rules: { drawdown: 0 } } }).hidden, true);

console.log(
  "mobileNav.check.mjs: OK — %d views, %d dock routes, %d sheet routes, breakpoints agree at %dpx",
  views.length,
  dockTargets.size,
  phoneMenuTargets.size,
  PHONE_MAX
);
