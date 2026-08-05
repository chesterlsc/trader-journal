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
    width: 0,
    height: 0,
    listeners: {},
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 350, height }),
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
  sessionChart: canvas("sessionChart", 240),
  rMultipleChart: canvas("rMultipleChart", 240),
  strategyDimensionButtons: [],
  strategyMetricButtons: []
};

const state = { dashboard: { performanceDimension: "setup", performanceMetric: "pnl" }, analytics: null };
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
  sessionReport: [
    { label: "London", pnl: 1800, count: 8 },
    { label: "New York", pnl: -300, count: 6 }
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
  sessionReport: [],
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
