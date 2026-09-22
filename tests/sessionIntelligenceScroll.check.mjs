// Session Intelligence scroll/dock regression contract.
//
// The dedicated route is long enough that a fixed desktop grid can silently
// shrink its overflow:hidden panel to the viewport, leaving scrollHeight equal
// to clientHeight and making the lower tabs/queue unreachable. Phones use
// document scrolling instead, so their last content must clear the fixed dock.
//
// Run: node tests/sessionIntelligenceScroll.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const html = read("index.html");
const styles = read("styles.css");
const clay = read("clay-v3.css");
const css = `${styles}\n${clay}`;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function blocksFor(source, headerPattern) {
  const pattern = new RegExp(headerPattern.source, `${headerPattern.flags.replace("g", "")}g`);
  const blocks = [];
  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf("{", match.index + match[0].length);
    if (open < 0) continue;
    let depth = 0;
    let close = -1;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    assert.ok(close > open, `unterminated CSS block after ${match[0]}`);
    blocks.push(source.slice(open + 1, close));
  }
  return blocks;
}

function ruleBodies(source, selector) {
  const pattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^{}]*)\\}`, "g");
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const desktopCss = [
  ...blocksFor(styles, /@media\s*\(min-width:\s*900px\)/),
  ...blocksFor(clay, /@media\s*\(min-width:\s*900px\)/)
].join("\n");
const desktopViewRules = ruleBodies(desktopCss, ".view.is-active").join("\n");
check(/position\s*:\s*fixed\b/.test(desktopViewRules), "desktop active views must remain fixed below measured chrome");
check(/inset\s*:[^;]*\b0\s+0\s+0\b/.test(desktopViewRules), "desktop active views must have a real bottom edge, not an unbounded fixed height");
check(/overflow-y\s*:\s*(?:auto|scroll)\b/.test(desktopViewRules), "desktop active views must own a vertical scroll container");
check(/overscroll-behavior\s*:\s*contain\b/.test(desktopViewRules), "desktop view scrolling must stay contained beneath app chrome");

// A fixed .view is display:grid. .session-panels is overflow:hidden, so its
// automatic grid minimum becomes zero and the row can clamp to the viewport.
// A dedicated block-flow override is the simplest safe contract; an explicit
// all-max-content grid is accepted as an equivalent non-shrinking solution.
const desktopSessionRules = ruleBodies(desktopCss, "#session-intelligence.is-active").join("\n");
const blockFlow = /display\s*:\s*block\b/.test(desktopSessionRules);
const explicitContentRows = /grid-template-rows\s*:[^;]*max-content[^;]*max-content[^;]*max-content/.test(desktopSessionRules) &&
  /align-content\s*:\s*start\b/.test(desktopSessionRules);
check(
  blockFlow || explicitContentRows,
  "#session-intelligence.is-active needs block flow (or three max-content rows + align-content:start) at >=900px; otherwise .session-panels clips the lower report instead of increasing scrollHeight"
);

// Phone/tablet-under-900 uses native document scrolling. The view must stay in
// flow, and the body-level footer that follows it reserves the fixed dock/FAB
// height plus the device safe area. Pin both the DOM order and the two CSS
// clearances so the Journal coverage action can always scroll above the dock.
const mobileCss = [
  ...blocksFor(styles, /@media\s*\(max-width:\s*899px\)/),
  ...blocksFor(clay, /@media\s*\(max-width:\s*899px\)/)
].join("\n");
const mobileSessionRules = ruleBodies(mobileCss, "#session-intelligence.is-active").join("\n");
check(!/position\s*:\s*fixed\b/.test(mobileSessionRules), "Session Intelligence must use native document flow below 900px");
check(html.indexOf('id="session-intelligence"') < html.indexOf('<footer class="site-footer">'), "the dock-clearance footer must follow Session Intelligence in document flow");

const footerClearance = ruleBodies(mobileCss, "body.app-on .site-footer").join("\n");
const htmlClearance = ruleBodies(mobileCss, "html").join("\n");
check(
  /padding-bottom\s*:\s*calc\(env\(safe-area-inset-bottom[^)]*\)\s*\+\s*124px\)/.test(footerClearance),
  "mobile app content must reserve 124px plus safe-area below the final row for the fixed dock and FAB"
);
check(
  /scroll-padding-bottom\s*:\s*calc\(env\(safe-area-inset-bottom[^)]*\)\s*\+\s*124px\)/.test(htmlClearance),
  "mobile anchor/focus scrolling must use the same 124px + safe-area dock clearance"
);

if (failures.length) {
  assert.fail(`Session Intelligence scroll contract failed:\n- ${failures.join("\n- ")}`);
}

console.log("sessionIntelligenceScroll.check.mjs: OK — desktop overflow and mobile dock clearance are reachable");
