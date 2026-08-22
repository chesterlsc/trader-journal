// Headless smoke test for src/modules/charts.js — stubs just enough DOM +
// canvas to run every renderer through empty, single-point, and populated
// datasets in both draw-in and settled states, plus a hover repaint.
import assert from "node:assert";
import { createChartsModule, traceSmoothPath } from "../src/modules/charts.js";

const calls = [];
function makeCtx() {
  const gradient = { addColorStop: (offset, color) => {
    assert.ok(Number.isFinite(offset), "gradient offset must be finite");
    assert.ok(typeof color === "string" && color.length > 0, `gradient stop colour empty (offset ${offset})`);
  } };
  const noop = (name) => (...args) => {
    args.forEach((arg) => {
      if (typeof arg === "number") {
        assert.ok(Number.isFinite(arg), `${name} received non-finite ${arg}`);
      }
    });
    calls.push(name);
  };
  const ctx = {
    canvas: null,
    setTransform: noop("setTransform"),
    clearRect: noop("clearRect"),
    save: noop("save"),
    restore: noop("restore"),
    beginPath: noop("beginPath"),
    closePath: noop("closePath"),
    moveTo: noop("moveTo"),
    lineTo: noop("lineTo"),
    quadraticCurveTo: noop("quadraticCurveTo"),
    arc: noop("arc"),
    arcTo: noop("arcTo"),
    rect: noop("rect"),
    roundRect: noop("roundRect"),
    fill: noop("fill"),
    stroke: noop("stroke"),
    clip: noop("clip"),
    fillRect: noop("fillRect"),
    setLineDash: noop("setLineDash"),
    fillText: (text, x, y) => {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `fillText NaN coords for "${text}"`);
      assert.ok(!String(text).includes("undefined"), `fillText printed undefined: "${text}"`);
      assert.ok(!String(text).includes("NaN"), `fillText printed NaN: "${text}"`);
      calls.push("fillText");
    },
    measureText: (text) => ({ width: String(text).length * 6 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient
  };
  return ctx;
}

const TOKENS = {};
function canvas(id, height) {
  return {
    id,
    clientWidth: id === "strategyPerformanceChart" ? 700 : 350,
    dataset: { height: String(height) },
    attrs: {},
    captured: [],
    width: 0,
    height: 0,
    listeners: {},
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 350, height }),
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    setPointerCapture(id) {
      this.captured.push(id);
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    }
  };
}

globalThis.window = {
  devicePixelRatio: 2,
  addEventListener() {}
};
globalThis.document = { documentElement: {} };
globalThis.getComputedStyle = () => ({
  getPropertyValue: (name) => TOKENS[name] ?? "rgba(1, 2, 3, 0.5)"
});
// Synchronous rAF with an advancing clock so the draw-in tween actually runs
// (5 frames per pass), exercising every progress < 1 branch.
let clock = 0;
globalThis.performance = { now: () => (clock += 200) };
globalThis.requestAnimationFrame = (cb) => {
  cb(performance.now());
  return 1;
};
globalThis.cancelAnimationFrame = () => {};

const ui = {
  equityChart: canvas("equityChart", 240),
  drawdownChart: canvas("drawdownChart", 240),
  strategyPerformanceChart: canvas("strategyPerformanceChart", 280),
  traderScoreChart: canvas("traderScoreChart", 300),
  psychologyChart: canvas("psychologyChart", 240),
  rMultipleChart: canvas("rMultipleChart", 240),
  // 1f #04 playbook page: same line engine, series carried on state.
  playbookChart: canvas("playbookChart", 240),
  strategyDimensionButtons: [],
  strategyMetricButtons: []
};

const state = {
  dashboard: { performanceDimension: "setup", performanceMetric: "pnl" },
  // Starts empty on purpose: the first renderCharts() pass below must survive
  // a playbook page nobody has opened yet.
  playbook: { setup: "", curve: [], dates: [], key: "line" },
  analytics: null
};
const { renderCharts } = createChartsModule({ ui, state, prefersReducedMotion: () => false });

const full = {
  equity: [10000, 10420, 9980, 11350, 11100, 12480, 12010, 13320],
  equityDates: ["2026-01-02", "2026-01-03", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-13"],
  drawdowns: [0, 0, 440, 0, 250, 0, 470, 0],
  drawdownDates: ["2026-01-02", "2026-01-03", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-13"],
  strategyPerformance: {
    setup: [
      { label: "Breakout continuation", pnl: 3200, count: 12 },
      { label: "Failed auction", pnl: -1450, count: 7 },
      { label: "VWAP reclaim", pnl: 880, count: 4 }
    ],
    asset: [],
    day: []
  },
  psychologyReport: [
    { label: "Calm", pnl: 2400, count: 9, wins: 6, winRate: 66.6 },
    { label: "Anxious", pnl: -900, count: 5, wins: 1, winRate: 20 }
  ],
  rMultipleReport: [
    { label: "< -2R", count: 2, tone: "neg" },
    { label: "-1R to 0R", count: 5, tone: "neg" },
    { label: "0R to 1R", count: 7, tone: "pos" },
    { label: "> 2R", count: 3, tone: "pos" }
  ],
  traderScore: {
    score: 71.4,
    metrics: [
      { label: "Win %", value: 62 },
      { label: "Profit factor", value: 80 },
      { label: "Avg win/loss", value: 55 },
      { label: "Recovery", value: 91 },
      { label: "Max drawdown", value: 44 },
      { label: "Consistency", value: 68 }
    ]
  }
};

const empty = {
  equity: [10000],
  equityDates: ["2026-01-02"],
  drawdowns: [0],
  drawdownDates: ["2026-01-02"],
  strategyPerformance: { setup: [], asset: [], day: [] },
  psychologyReport: [],
  rMultipleReport: [],
  traderScore: { score: 0, metrics: [] }
};

// Empty datasets must paint their empty labels, not throw.
renderCharts(empty);
// Populated, settled (reduced-motion path: progress 1 immediately).
renderCharts(full);
// Count metric exercises the left-anchored bar branch.
state.dashboard.performanceMetric = "count";
renderCharts(full, { force: true });
// Flat series (min === max) must not divide by zero, on either scale.
renderCharts(
  {
    ...full,
    equity: [10000, 10000, 10000],
    equityDates: full.equityDates.slice(0, 3),
    drawdowns: [0, 0, 0],
    drawdownDates: full.drawdownDates.slice(0, 3)
  },
  { force: true }
);

// 1f #04 playbook curve: a losing setup paints on the negative key, and a
// series short enough to be withheld must fall back to the empty label rather
// than draw a two-point "trend".
state.playbook = {
  setup: "Failed auction",
  curve: [-120, -180, -95, -140, -210],
  dates: ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06"],
  key: "neg"
};
const beforePlaybook = calls.length;
renderCharts(full, { force: true });
assert.ok(calls.length > beforePlaybook, "the playbook curve must paint");
state.playbook = { setup: "Scalp", curve: [], dates: [], key: "line" };
renderCharts(full, { force: true });

// Reduced motion: a separate instance that always paints the settled frame.
const reduced = createChartsModule({ ui, state, prefersReducedMotion: () => true });
const beforeReduced = calls.length;
reduced.renderCharts(full, { force: true });
assert.ok(calls.length > beforeReduced, "reduced motion must still paint every chart");

// Hover: nearest-point hit test on a line chart, row hit test on a bar chart.
// Each must repaint its own canvas (draw ops grow) and clear on leave.
const beforeHover = calls.length;
ui.equityChart.listeners.mousemove({ clientX: 180, clientY: 100 });
assert.ok(calls.length > beforeHover, "line hover must repaint the chart");
ui.equityChart.listeners.mouseleave();
const beforeBarHover = calls.length;
ui.psychologyChart.listeners.mousemove({ clientX: 200, clientY: 60 });
assert.ok(calls.length > beforeBarHover, "bar hover must repaint the chart");
ui.psychologyChart.listeners.mouseleave();
// A pointer outside the plot must not latch a highlight.
const beforeMiss = calls.length;
ui.psychologyChart.listeners.mousemove({ clientX: 200, clientY: 5 });
assert.strictEqual(calls.length, beforeMiss, "hover outside the rows must not repaint");

/* ── 1f #05 equity scrub ──────────────────────────────────────────────────
   A dedicated instance with its own canvases, because the stub's
   addEventListener overwrites by type and the two modules above already
   fought over the shared ones.

   What would rot silently here: the playhead landing one trade off the point
   the finger is on; the hover crosshair and the playhead both claiming the
   canvas; a poll tick clearing a scrub the trader is reading; a theme repaint
   doing the same. */
function scrubHarness(reducedMotion) {
  const scrubUi = {
    equityChart: canvas("equityChart", 240),
    drawdownChart: canvas("drawdownChart", 240),
    strategyPerformanceChart: canvas("strategyPerformanceChart", 280),
    traderScoreChart: canvas("traderScoreChart", 300),
    psychologyChart: canvas("psychologyChart", 240),
    rMultipleChart: canvas("rMultipleChart", 240),
    playbookChart: canvas("playbookChart", 240),
    strategyDimensionButtons: [],
    strategyMetricButtons: []
  };
  const seen = [];
  const scrubState = {
    dashboard: { performanceDimension: "setup", performanceMetric: "pnl" },
    playbook: { setup: "", curve: [], dates: [], key: "line" },
    analytics: null
  };
  const module = createChartsModule({
    ui: scrubUi,
    state: scrubState,
    prefersReducedMotion: () => reducedMotion,
    onScrub: (index) => seen.push(index)
  });
  module.renderCharts(full, { force: true });
  return { ui: scrubUi, seen, ...module };
}

const scrub = scrubHarness(false);
const eq = scrub.ui.equityChart;
const LAST = full.equity.length - 1;

// The canvas is 350 CSS px wide; the line renderer's plot runs from padLeft to
// width - padRight, so a press well left of the plot is the first point and
// one well right of it is the last. Anything in between is a nearest-point
// hit, which is what stops the playhead landing one trade off the finger.
eq.listeners.pointerdown({ clientX: 0, pointerId: 7 });
assert.deepStrictEqual(scrub.seen, [0], "a press at the left edge must select the first point");
assert.deepStrictEqual(eq.captured, [7], "the drag must capture its pointer");

eq.listeners.pointermove({ clientX: 400, pointerId: 7 });
assert.deepStrictEqual(scrub.seen, [0, LAST], "dragging to the right edge must reach the last point");

// Same index twice must not re-fire — the panel repaint is not free.
eq.listeners.pointermove({ clientX: 420, pointerId: 7 });
assert.deepStrictEqual(scrub.seen, [0, LAST], "re-selecting the same point must not re-notify");

// An engaged scrub owns the canvas: the hover crosshair must stay out.
eq.listeners.pointerup({ pointerId: 7 });
const beforeScrubHover = calls.length;
eq.listeners.mousemove({ clientX: 180, clientY: 100 });
assert.strictEqual(calls.length, beforeScrubHover, "hover must not repaint while a scrub is engaged");

// Keyboard: arrows step trade to trade, Home/End jump, Escape releases.
const prevented = [];
const key = (name) => eq.listeners.keydown({ key: name, preventDefault: () => prevented.push(name) });
key("ArrowLeft");
assert.strictEqual(scrub.seen.at(-1), LAST - 1, "ArrowLeft must step back one trade");
key("ArrowRight");
assert.strictEqual(scrub.seen.at(-1), LAST, "ArrowRight must step forward one trade");
key("Home");
assert.strictEqual(scrub.seen.at(-1), 0, "Home must jump to the start of the curve");
key("ArrowLeft");
assert.strictEqual(scrub.seen.at(-1), 0, "the playhead must not walk off the front of the curve");
key("End");
assert.strictEqual(scrub.seen.at(-1), LAST, "End must jump to the head of the curve");
assert.ok(prevented.length >= 5, "arrow keys must not also scroll the page");
key("Tab");
assert.strictEqual(prevented.includes("Tab"), false, "Tab must stay the browser's");

// aria-valuetext is the app's to write; the module must not squat on it.
assert.strictEqual(eq.attrs["aria-valuetext"], undefined);

// A repaint with the SAME data (theme toggle, resize) keeps the playhead.
const afterKeys = scrub.seen.length;
scrub.renderCharts(full, { force: true });
assert.strictEqual(scrub.seen.length, afterKeys, "a forced repaint must not drop the playhead");

// A repaint with NEW data drops it: index 6 named a different trade a moment
// ago and would now be a quiet lie.
scrub.renderCharts({ ...full, equity: [...full.equity, 14000], equityDates: [...full.equityDates, "2026-01-14"] });
assert.strictEqual(scrub.seen.at(-1), null, "a dataset change must release the playhead");

// Escape releases too, and only when something is engaged.
eq.listeners.pointerdown({ clientX: 200, pointerId: 8 });
const engaged = scrub.seen.at(-1);
assert.ok(typeof engaged === "number", "pointerdown must re-engage after a reset");
key("Escape");
assert.strictEqual(scrub.seen.at(-1), null, "Escape must release the playhead");
const beforeIdleEscape = scrub.seen.length;
key("Escape");
assert.strictEqual(scrub.seen.length, beforeIdleEscape, "Escape with nothing engaged must do nothing");

// clearScrub() is the Clear button's route out.
eq.listeners.pointerdown({ clientX: 120, pointerId: 9 });
scrub.clearScrub();
assert.strictEqual(scrub.seen.at(-1), null, "clearScrub must release the playhead");

// Reduced motion: the playhead still moves, it just does not ease there.
const still = scrubHarness(true);
still.ui.equityChart.listeners.pointerdown({ clientX: 0, pointerId: 1 });
const beforeReducedStep = calls.length;
still.ui.equityChart.listeners.keydown({ key: "End", preventDefault: () => {} });
assert.deepStrictEqual(still.seen, [0, LAST], "reduced motion must still move the playhead");
assert.ok(calls.length > beforeReducedStep, "reduced motion must still repaint the playhead");

// Smoothing helper: 2 points degrade to a line, 3+ produce curves.
const traced = [];
const probe = {
  moveTo: () => traced.push("m"),
  lineTo: () => traced.push("l"),
  quadraticCurveTo: () => traced.push("q")
};
traceSmoothPath(probe, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
assert.deepStrictEqual(traced, ["m", "l"]);
traced.length = 0;
traceSmoothPath(probe, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 2 }]);
assert.deepStrictEqual(traced, ["m", "q", "q"]);

assert.ok(calls.filter((c) => c === "fillText").length > 40, "charts should render text labels");
console.log(`OK — ${calls.length} canvas ops, ${calls.filter((c) => c === "fillText").length} text draws`);
