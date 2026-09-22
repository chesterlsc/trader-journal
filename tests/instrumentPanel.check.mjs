// The Morning Read — instrument panel structural contract.
//
// This dashboard has been rebuilt five times. Each attempt died the same way:
// a rule in one file quietly cancelled a rule in another, and the failure was
// invisible until someone measured the live DOM. These are the specific
// cancellations that have already happened once, pinned so they cannot happen
// again in silence.
//
// Run: node tests/instrumentPanel.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const html = read("index.html");
const styles = read("styles.css");
const clay = read("clay-v3.css");
const app = read("app.js");
const charts = read("src/modules/charts.js");

// ── 1. Only ONE 1240 block may lay the dashboard out ──────────────────────────
// styles.css also had a @media (min-width:1240px) that set align-items:start
// and a margin-bottom on every child. The margin put a 427px margin box in a
// 407px track, and the align-items switched off the stretch the panel grid
// assumes — which is what six height:100% workarounds existed to paper over.
// Brace-matched, because styles.css has several 1240 blocks and the dashboard's
// is not the first. A naive slice tests the wrong one and passes for free.
function blockAt(source, openIndex) {
  let depth = 0;
  for (let i = source.indexOf("{", openIndex); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return source.slice(openIndex);
}
function mediaBlocksContaining(source, query, needle) {
  const out = [];
  let at = source.indexOf(query);
  while (at !== -1) {
    const block = blockAt(source, at);
    if (block.includes(needle)) out.push(block);
    at = source.indexOf(query, at + query.length);
  }
  return out;
}
const styleBlocks = mediaBlocksContaining(styles, "@media (min-width: 1240px)", "#dashboard.is-active");
assert.equal(
  styleBlocks.length,
  1,
  `styles.css should have exactly one 1240 block touching #dashboard.is-active, found ${styleBlocks.length}`
);
// Comments explain what was REMOVED, so they name the very declarations these
// assertions forbid. Strip them or the test fails on its own documentation.
const decls = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const styleBlock = decls(styleBlocks[0]);
assert.ok(
  !/align-items:\s*start/.test(styleBlock),
  "styles.css's 1240 block must not set align-items — clay-v3.css owns this grid"
);
assert.ok(
  !/margin-bottom/.test(styleBlock),
  "no margin-bottom on dashboard children: a margin box does not fit a fixed track"
);
assert.ok(
  !/#dashboard\.is-active\s*\{\s*align-content:\s*start/.test(decls(styles)),
  "styles.css must not set align-content:start — clay-v3.css declares stretch"
);

// ── 2. The padding escape must out-specify the reading column ─────────────────
// .view.is-active:not(#terminal) is (1,2,0) because :not(#terminal) contributes
// an ID. #dashboard.is-active is (1,1,0) and loses, leaving 519px of gutter.
assert.ok(
  /\.view\.is-active#dashboard\s*\{\s*padding-inline/.test(clay),
  "the padding escape must be written as .view.is-active#dashboard, or it loses to :not(#terminal)"
);

// ── 3. Stretch is stated, and the workarounds are gone ────────────────────────
assert.ok(/align-items:\s*stretch/.test(clay), "the panel grid must state align-items: stretch");
// End the slice on the short-screen MEDIA QUERY, not on the words "SHORT
// SCREENS" — those live inside a comment, which decls() strips, so indexOf
// returned -1 and this assertion silently scanned to end-of-file.
const SHORT_Q = "@media (min-width: 1240px) and (max-height: 960px)";
const gridBlock = decls(clay.slice(clay.indexOf(".view.is-active#dashboard")));
assert.ok(gridBlock.includes(SHORT_Q), "lost the short-screen media query anchor");
assert.ok(
  !/height:\s*100%/.test(gridBlock.slice(0, gridBlock.indexOf(SHORT_Q))),
  "height:100% re-states the track as an answer rather than a ceiling — it stopped the canvas sizing"
);

// ── 4. Rules that beat [hidden] need an explicit companion ────────────────────
// A (1,2,0) display rule beats the UA [hidden] rule at (0,1,0). Without the
// guard a hidden #dashPlaybook stayed a 629x432 ghost panel.
assert.ok(
  /#dashboard\.is-active #dashPlaybook\[hidden\]\s*\{\s*display:\s*none/.test(clay),
  "#dashPlaybook gets display:flex at winning specificity, so it needs an explicit [hidden] guard"
);
// The drawdown canvas is display:none'd rather than [hidden]-ed, because
// .panel-chart canvas { display: block } at (0,2,0) beats [hidden] too.
assert.ok(
  /#dashboard\.is-active #drawdownChart\s*\{\s*display:\s*none/.test(clay),
  "the drawdown canvas box must be closed with display:none, not [hidden]"
);
assert.ok(
  html.includes('id="drawdownChart"'),
  "the drawdown canvas must STAY in the DOM — ui.drawdownChart and drawAllCharts read it"
);

// ── 5. The board closes when a panel is off ───────────────────────────────────
// The rail is the ONLY optional panel on this board: it ships `hidden` and stays
// hidden without terminalPro, so without a reflow a fresh account shows a
// four-column hole down the right. The ledger and the edge score always render
// (the ledger has its own empty-state row), and the playbook and discipline
// panels are display:none'd off this grid entirely — which is a stronger
// guarantee than a reflow, so they are asserted that way instead.
assert.ok(
  /:has\(\.dash-edge-mini\[hidden\]\)/.test(clay),
  "no :has() reflow for a hidden rail — a fresh account would show a hole in the board"
);
assert.ok(
  /#dashboard\.is-active \.dash-board-slot,\n\s*#dashboard\.is-active #dashPlaybook \{ display: none/.test(clay),
  "the playbook and discipline panels must be display:none'd off this board, not left unplaced"
);

// ── 6. NEVER display:none an ancestor of the Edge iframe ──────────────────────
assert.ok(
  !/\.dash-edge-mini[^{]*\{[^}]*display:\s*none/.test(decls(clay)),
  "display:none on .dash-edge-mini kills the live stream inside its iframe"
);
// That regex only catches a rule that NAMES the rail. The empty-state cull is a
// `> *` sweep, and .dash-edge-mini is a direct child of #dashboard — so it
// matched, set display:none, and killed the stream on any zero-trade account
// without tripping the guard above. Excluded by ID so the class form does not
// trip it either.
assert.ok(
  /:has\(#dashboardEmptyState:not\(\[hidden\]\)\) > \*[^{,]*:not\(#dashEdgeMini\)/.test(decls(clay)),
  "the empty-state cull must exclude #dashEdgeMini — a `> *` sweep hits the rail and stops the stream"
);

// ── 7. The height budget closes ───────────────────────────────────────────────
const rowsOf = (block) => {
  const m = block.match(/grid-template-rows:\s*([^;]+);/);
  return m ? m[1].trim() : null;
};
// Anchored on the rule that actually declares the track set. Slicing from the
// padding escape finds the desk rail's own grid-template-rows first.
const clayDecls = decls(clay);
const tallRule = blockAt(clayDecls, clayDecls.indexOf("#dashboard.is-active {\n    grid-template-columns"));
const tall = rowsOf(tallRule);
assert.equal(tall, "36px 108px minmax(0, 0.42fr) minmax(0, 0.58fr)", "tall-screen track set changed");
const shortBlock = clay.slice(clay.indexOf(SHORT_Q));
const shortDecls = decls(shortBlock);
assert.equal(rowsOf(shortDecls), "32px 88px minmax(0, 0.48fr) minmax(0, 0.52fr)", "short-screen track set changed");
// 1093 viewport - 32 padding-block - 36 row gaps = 1025 of track
assert.equal(36 + 108 + Math.round(0.42 * 881) + Math.round(0.58 * 881), 1025, "tall budget does not close");
// 843 viewport - 32 - 36 = 775
assert.equal(32 + 88 + Math.round(0.48 * 655) + Math.round(0.52 * 655), 775, "short budget does not close");
assert.ok(
  shortBlock.indexOf("@media") < shortBlock.indexOf("grid-template-rows"),
  "the short-screen rules must sit inside their own media block"
);

// ── 8. The chart reads its box, not an attribute ──────────────────────────────
assert.ok(
  /const height = Number\(heightOverride\) \|\| canvas\.clientHeight \|\| Number\(canvas\.dataset\.height\) \|\| 280;/.test(charts),
  "getCanvasContext must prefer clientHeight — data-height is the fallback for a canvas with no box"
);
assert.ok(
  /const bare = height < 140;/.test(charts),
  "no height ladder: reading the box back turns a squashed chart into a crisp lie without one"
);
assert.ok(
  /THE TICK COUNT IS PART OF THE ANSWER/.test(charts) && /for \(let n = maxRows; n >= Math\.min\(3, maxRows\); n -= 1\)/.test(charts),
  "the y-axis must search tick counts for the tightest fit, or the curve floats in dead air"
);
assert.ok(
  !/const headroom = \(max - min\) \* 0\.14;[\s\S]{0,80}yFor/.test(charts),
  "the flat 14% headroom must not apply when nice-number ticks supply their own"
);

// ── 9. app.js wiring ──────────────────────────────────────────────────────────
for (const key of ["values", "tweens", "toneValues"]) {
  assert.ok(
    new RegExp(`const ${key} = \\{\\n\\s*totalPnl:`).test(app),
    `renderDashboardMetrics.${key} is missing totalPnl — the headline figure stays $0.00`
  );
}
assert.ok(html.includes('data-metric="totalPnl"'), "no totalPnl node in the initial HTML");
assert.ok(
  html.includes('data-metric="accountBalance"'),
  "accountBalance must keep its name: renderLiveEquity re-queries it by attribute every price poll"
);
assert.ok(
  /const label = document\.getElementById\("dashEquityTag"\);/.test(app),
  "renderLiveEquity must write the equity/balance word to #dashEquityTag, not the static header"
);
assert.ok(/^function renderDayBars\(/m.test(app), "renderDayBars must be a function DECLARATION (TDZ)");
assert.ok(/renderDayBars\(state\.analytics\);/.test(app), "renderDayBars is never called");
assert.ok(/^function setupChartResize\(/m.test(app), "setupChartResize must be a function DECLARATION (TDZ)");
assert.ok(
  /setupChartResize\(\);/.test(app),
  "without the observer the first draw lands before layout and the canvas keeps the 280px fallback"
);

// ── 10. The stat strip absorbed the tiles it replaced ─────────────────────────
const strip = html.slice(html.indexOf('class="eq-footnotes"'));
const stripEnd = strip.indexOf("</div>");
const figures = (strip.slice(0, stripEnd).match(/data-metric="/g) || []).length;
assert.equal(figures, 7, `stat strip should carry 7 figures, found ${figures}`);
assert.ok(!html.includes('data-metric="bestDay"'), "bestDay tile should be gone — the day bars state it");
assert.ok(!html.includes('data-metric="worstDay"'), "worstDay tile should be gone — the day bars state it");
assert.ok(!/<section class="dash-quad"/.test(html), "the emptied .dash-quad wrapper should be deleted");

console.log(
  `instrumentPanel.check.mjs: OK — one 1240 block, padding escape at winning specificity, ` +
    `both budgets close, ${figures}-figure strip, charts read their own box`
);
