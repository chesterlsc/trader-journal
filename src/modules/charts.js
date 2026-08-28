import { clamp } from "../lib/core.js";
import { formatCurrency, formatCompactCurrency, formatChartDateLabel } from "../lib/format.js";

const ELLIPSIS = "…";
const DRAW_DURATION_MS = 900;
const BAR_STAGGER_MS = 55;

/**
 * Quadratic-through-midpoints smoothing. Exported so the dashboard sparkline
 * in app.js traces the exact same curve as the equity chart instead of
 * duplicating the maths. Unlike a cubic spline this never overshoots the data
 * envelope — which matters when the envelope is somebody's account balance.
 */
export function traceSmoothPath(ctx, points, move = true) {
  if (!points.length) {
    return;
  }

  if (move) {
    ctx.moveTo(points[0].x, points[0].y);
  } else {
    ctx.lineTo(points[0].x, points[0].y);
  }

  if (points.length < 3) {
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    return;
  }

  for (let i = 1; i < points.length - 2; i += 1) {
    ctx.quadraticCurveTo(
      points[i].x,
      points[i].y,
      (points[i].x + points[i + 1].x) / 2,
      (points[i].y + points[i + 1].y) / 2
    );
  }

  const last = points.length - 1;
  ctx.quadraticCurveTo(points[last - 1].x, points[last - 1].y, points[last].x, points[last].y);
}

export function createChartsModule({ ui, state, prefersReducedMotion, onScrub }) {
  // Palette is read from CSS custom properties so canvas follows the theme.
  // Cached per render pass; invalidated (and charts repainted) on 'themechange'.
  let palette = null;

  // Draw-in replays only when the dataset hash changes (or on themechange),
  // never on the no-change renders from the poll/render loop.
  let lastChartHash = "";
  let drawFrame = 0;
  let animating = false;

  // Per-canvas repaint closure, rebound on every pass. A hover repaints only
  // its own canvas — a mousemove must never redraw all seven charts.
  const painters = new Map();
  // Hit-test geometry from the last full paint, per canvas.
  const geometry = new Map();
  // Highlighted index per canvas (null / absent = no highlight).
  const hoverIndex = new Map();
  const boundCanvases = new WeakSet();

  // 1f #05 equity scrub. Exactly one canvas is scrubbable, so this is four
  // plain variables rather than four more Maps.
  //   scrubIndex  — index into the equity series, or null when disengaged.
  //   scrubX      — the playhead's animated x in CSS px. Eases toward the
  //                 target point; snapped instantly under reduced motion.
  //   scrubFrame  — the easing rAF id; 0 while idle, which is also the signal
  //                 that the playhead may be re-derived from fresh geometry.
  //   scrubDragging — a pointer is down and owns the playhead.
  let scrubIndex = null;
  let scrubX = null;
  let scrubFrame = 0;
  let scrubDragging = false;

  const isScrubCanvas = (canvas) => Boolean(canvas) && canvas === ui.equityChart;

  function getPalette() {
    if (palette) {
      return palette;
    }
    const styles = getComputedStyle(document.documentElement);
    const read = (name) => styles.getPropertyValue(name).trim();
    const fontSize = Number(read("--chart-font-size")) || 11;
    const fontFamily = read("--chart-font-family") || '"JetBrains Mono", ui-monospace, monospace';
    palette = {
      grid: read("--chart-grid"),
      axis: read("--chart-axis"),
      line: read("--chart-line"),
      lineDeep: read("--chart-line-deep"),
      glow: read("--chart-glow"),
      halo: read("--chart-halo"),
      haloFade: read("--chart-halo-fade"),
      haloNeg: read("--chart-halo-neg"),
      haloNegFade: read("--chart-halo-neg-fade"),
      areaTop: read("--chart-area-top"),
      areaMid: read("--chart-area-mid"),
      areaBottom: read("--chart-area-bottom"),
      negGlow: read("--chart-neg-glow"),
      negAreaTop: read("--chart-neg-area-top"),
      negAreaBottom: read("--chart-neg-area-bottom"),
      pos: read("--chart-pos"),
      posDeep: read("--chart-pos-deep"),
      neg: read("--chart-neg"),
      negDeep: read("--chart-neg-deep"),
      posGlow: read("--chart-pos-glow"),
      highlight: read("--chart-highlight"),
      highlightFade: read("--chart-highlight-fade"),
      shade: read("--chart-shade"),
      shadeFade: read("--chart-shade-fade"),
      track: read("--chart-track"),
      crosshair: read("--chart-crosshair"),
      tooltipBg: read("--chart-tooltip-bg"),
      tooltipLine: read("--chart-tooltip-line"),
      tooltipShadow: read("--chart-tooltip-shadow"),
      ringWash: read("--chart-ring-wash"),
      radar: read("--chart-radar"),
      radarCore: read("--chart-radar-core"),
      radarEdge: read("--chart-radar-edge"),
      radarGlow: read("--chart-radar-glow"),
      text: read("--text"),
      textSoft: read("--text-soft"),
      textFaint: read("--text-faint"),
      textInverse: read("--text-inverse"),
      inset: read("--surface-inset"),
      lineStrong: read("--line-strong"),
      fontSize,
      font: (weight, size) => `${weight} ${size || fontSize}px ${fontFamily}`
    };
    return palette;
  }

  window.addEventListener("themechange", () => {
    palette = null;
    renderCharts(state.analytics, { force: true });
  });

  function computeChartHash(analytics) {
    return JSON.stringify([
      analytics.equity,
      analytics.drawdowns,
      analytics.strategyPerformance,
      analytics.traderScore?.metrics,
      analytics.psychologyReport,
      analytics.rMultipleReport,
      state.dashboard.performanceDimension,
      state.dashboard.performanceMetric,
      // 1f #04 playbook page: its series lives on state, not on analytics,
      // because which setup is on screen is a routing fact. Hashed here so
      // opening a different setup's page replays the draw-in exactly once.
      state.playbook?.curve,
      state.playbook?.key
    ]);
  }

  function renderCharts(analytics, options = {}) {
    if (!analytics) {
      return;
    }

    const hash = computeChartHash(analytics);
    const dataChanged = hash !== lastChartHash;
    const changed = dataChanged || options.force === true;
    lastChartHash = hash;
    cancelAnimationFrame(drawFrame);
    animating = false;

    // A new dataset moves every point, so an index kept from the old one now
    // names a different trade. Drop the playhead rather than quietly relabel
    // it. State-only — the paint below is already scheduled. Keyed off the
    // hash itself, not off `changed`: a forced repaint (theme toggle, resize)
    // is the same data, so it keeps the playhead the trader put there, and the
    // 5s poll's no-change renders never touch it either.
    if (dataChanged) {
      resetScrub();
    }

    if (!changed || (typeof prefersReducedMotion === "function" && prefersReducedMotion())) {
      drawAllCharts(analytics, 1);
      return;
    }

    animating = true;
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min((now - startTime) / DRAW_DURATION_MS, 1);
      drawAllCharts(analytics, 1 - Math.pow(1 - t, 3));
      if (t < 1) {
        drawFrame = requestAnimationFrame(step);
      } else {
        animating = false;
      }
    };
    drawFrame = requestAnimationFrame(step);
  }

  // Binds the canvas' repaint closure (so hover can redraw just this chart),
  // attaches the hover listeners once, then paints.
  function paint(canvas, fn, progress) {
    if (!canvas) {
      return;
    }
    painters.set(canvas, fn);
    bindHover(canvas);
    fn(progress);
  }

  function repaint(canvas) {
    const painter = painters.get(canvas);
    if (painter) {
      painter(1);
    }
  }

  // Nearest data point to an x, in CSS px. Shared by hover and scrub so the
  // two never disagree about which trade the pointer is over.
  function nearestLineIndex(geo, x) {
    let best = 0;
    let bestDistance = Infinity;
    geo.points.forEach((point, i) => {
      const distance = Math.abs(point.x - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  }

  // Mouse-only by design: a touch drag must keep scrolling the page, and every
  // chart is fully readable without a pointer. (The equity canvas is the one
  // exception — see bindScrub, which claims the horizontal axis only.)
  function bindHover(canvas) {
    if (boundCanvases.has(canvas)) {
      return;
    }
    boundCanvases.add(canvas);
    if (isScrubCanvas(canvas)) {
      bindScrub(canvas);
    }

    canvas.addEventListener("mousemove", (event) => {
      const geo = geometry.get(canvas);
      if (!geo || animating) {
        return;
      }
      // The playhead and the crosshair are two answers to the same question,
      // so an engaged scrub owns the canvas outright until it is cleared.
      if (isScrubCanvas(canvas) && scrubIndex !== null) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let index = null;

      if (geo.kind === "line" && geo.points.length) {
        if (x >= geo.left - 12 && x <= geo.right + 12) {
          index = nearestLineIndex(geo, x);
        }
      } else if (geo.kind === "bar") {
        const row = Math.floor((y - geo.top) / geo.rowGap);
        if (row >= 0 && row < geo.count && y >= geo.top && y <= geo.bottom) {
          index = row;
        }
      }

      if (index !== (hoverIndex.has(canvas) ? hoverIndex.get(canvas) : null)) {
        if (index === null) {
          hoverIndex.delete(canvas);
        } else {
          hoverIndex.set(canvas, index);
        }
        repaint(canvas);
      }
    });

    canvas.addEventListener("mouseleave", () => {
      if (hoverIndex.has(canvas)) {
        hoverIndex.delete(canvas);
        repaint(canvas);
      }
    });
  }

  /* ======================================================================
     1f #05 — equity scrub

     Drag (or swipe, or arrow-key) along the curve and the trade under the
     playhead is handed to onScrub, which is what fills the panel below the
     canvas. The playhead persists after the pointer lifts — the whole point
     is to stop and read the note, which a hover-only affordance forbids on a
     phone and rushes on a mouse.
     ====================================================================== */

  function scrubPoints() {
    const geo = geometry.get(ui.equityChart);
    return geo && geo.kind === "line" && geo.points.length > 1 ? geo.points : null;
  }

  // State only — no repaint. renderCharts uses this on a dataset change,
  // where the paint is already happening.
  function resetScrub() {
    if (scrubIndex === null) {
      return false;
    }
    scrubIndex = null;
    scrubX = null;
    cancelAnimationFrame(scrubFrame);
    scrubFrame = 0;
    scrubDragging = false;
    if (typeof onScrub === "function") {
      onScrub(null);
    }
    return true;
  }

  function clearScrub() {
    if (resetScrub()) {
      repaint(ui.equityChart);
    }
  }

  function moveScrubTo(targetX, instant) {
    cancelAnimationFrame(scrubFrame);
    scrubFrame = 0;
    const reduced = typeof prefersReducedMotion === "function" && prefersReducedMotion();
    if (instant || reduced || scrubX === null) {
      scrubX = targetX;
      repaint(ui.equityChart);
      return;
    }

    const step = () => {
      // A draw-in has taken the canvas back; land the playhead and get out of
      // its way rather than fighting it for frames.
      if (animating) {
        scrubX = targetX;
        scrubFrame = 0;
        return;
      }
      const delta = targetX - scrubX;
      if (Math.abs(delta) < 0.5) {
        scrubX = targetX;
        scrubFrame = 0;
        repaint(ui.equityChart);
        return;
      }
      scrubX += delta * 0.35;
      repaint(ui.equityChart);
      scrubFrame = requestAnimationFrame(step);
    };
    scrubFrame = requestAnimationFrame(step);
  }

  function setScrub(index, options = {}) {
    const points = scrubPoints();
    if (!points) {
      return;
    }
    if (!Number.isFinite(index)) {
      return;
    }
    const next = clamp(Math.round(index), 0, points.length - 1);
    const changed = next !== scrubIndex;
    scrubIndex = next;
    if (changed && typeof onScrub === "function") {
      onScrub(next);
    }
    moveScrubTo(points[next].x, options.instant);
  }

  function bindScrub(canvas) {
    const pointerIndex = (event) => {
      const geo = geometry.get(canvas);
      if (!geo || geo.kind !== "line" || !geo.points.length) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      return nearestLineIndex(geo, event.clientX - rect.left);
    };

    canvas.addEventListener("pointerdown", (event) => {
      if (animating || !scrubPoints()) {
        return;
      }
      scrubDragging = true;
      if (typeof canvas.setPointerCapture === "function") {
        canvas.setPointerCapture(event.pointerId);
      }
      // Hand the canvas over cleanly: crosshair off, playhead on.
      hoverIndex.delete(canvas);
      // The first touch lands the playhead where the finger is, with no glide
      // from wherever it was — the finger IS the position.
      setScrub(pointerIndex(event), { instant: true });
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!scrubDragging || animating) {
        return;
      }
      setScrub(pointerIndex(event));
    });

    // touch-action: pan-y on the canvas means the browser keeps vertical
    // scrolling and only hands us the horizontal drag, so nothing here has to
    // preventDefault and nothing here can strand a phone mid-page. When the
    // browser does decide the gesture was a scroll it sends pointercancel.
    const release = () => {
      scrubDragging = false;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);

    canvas.addEventListener("keydown", (event) => {
      const points = scrubPoints();
      if (!points || animating) {
        return;
      }
      const last = points.length - 1;
      let next = null;

      if (event.key === "Escape") {
        if (scrubIndex === null) {
          return;
        }
        event.preventDefault();
        clearScrub();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        next = scrubIndex === null ? last : scrubIndex + 1;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        next = scrubIndex === null ? last : scrubIndex - 1;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = last;
      } else {
        return;
      }

      // Arrow keys scroll the page by default; once the curve has focus they
      // belong to the playhead.
      event.preventDefault();
      hoverIndex.delete(canvas);
      setScrub(next);
    });
  }

  // Solid accent rule + a marker riding the curve. Deliberately unlike the
  // hover crosshair (neutral, dashed, transient) so the two never read as the
  // same thing — and it is never the only signal: the panel below the canvas
  // states the same trade in words.
  function drawScrubPlayhead(ctx, options) {
    const colors = getPalette();
    const { x, y, color, glow, top, bottom } = options;
    ctx.save();
    const beam = ctx.createLinearGradient(0, top, 0, bottom);
    beam.addColorStop(0, colors.haloFade);
    beam.addColorStop(0.5, colors.halo);
    beam.addColorStop(1, colors.haloFade);
    ctx.fillStyle = beam;
    ctx.fillRect(Math.round(x) - 3, top, 6, bottom - top);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, top);
    ctx.lineTo(Math.round(x) + 0.5, bottom);
    ctx.stroke();

    // Grip nub on the baseline: the "you can drag this" tell.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(Math.round(x) + 0.5, bottom, 3.5, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = colors.inset;
    ctx.beginPath();
    ctx.arc(x, y, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // y on the polyline at an arbitrary x. The stroke is a quadratic smoothing
  // of the same points, so the chord is within a pixel or two of it at these
  // scales — and the marker snaps onto the exact vertex the moment the ease
  // lands, which is where anybody is actually reading it.
  function yAtX(points, x) {
    for (let i = 1; i < points.length; i += 1) {
      if (x <= points[i].x) {
        const a = points[i - 1];
        const b = points[i];
        const span = b.x - a.x;
        const t = span === 0 ? 0 : clamp((x - a.x) / span, 0, 1);
        return a.y + (b.y - a.y) * t;
      }
    }
    return points[points.length - 1].y;
  }

  /**
   * Smallest 1/2/2.5/5/10 x 10^k step that satisfies `fits` in exactly `n`
   * intervals, or null when nothing in range does. Lifted out of the tick search
   * below so the money axis and the depth axis run the SAME search — a second
   * copy is how two scales drift onto two different sets of gridlines.
   */
  function niceStep(span, n, fits) {
    const seed = Math.max(span / n, Number.MIN_VALUE);
    const base = 10 ** Math.floor(Math.log10(seed));
    let step = null;
    for (let scale = base; scale <= base * 1e4 && step === null; scale *= 10) {
      step = [1, 2, 2.5, 5, 10].map((m) => m * scale).find(fits) ?? null;
    }
    return step;
  }

  // Right-hand axis labels. TWO decimals, not one: the step ladder includes
  // 2.5 x 10^k, so a 0.25 step at one decimal prints -0.3 / -0.5 / -0.8 on an
  // evenly spaced grid — the same silent lie the money axis was fixed to kill.
  // Number() drops the trailing zeros afterwards.
  /** The privacy toggle, read defensively. charts.smoke.mjs drives this module
   *  in node with no document, so a bare document.body.classList throws before
   *  a single pixel is drawn. */
  function balanceHidden() {
    return typeof document !== "undefined" && Boolean(document.body?.classList.contains("is-balance-hidden"));
  }

  function formatAxisPercent(value) {
    return `${Number(value.toFixed(2))}%`;
  }

  /* Drawdown as a share of the peak it fell from — the equity plot's second
     series. peak_i = equity_i + drawdown_i is an IDENTITY of how
     calculateAnalytics builds the pair, so this needs no new analytics field,
     no new hash key and no second pass.

     SIGN: analytics.drawdowns is a POSITIVE MAGNITUDE, floored at 0 by
     construction. It is negated HERE, once, so everything downstream reads
     depth as negative the same way the underwater chart does. */
  function depthPercent(analytics) {
    const equity = analytics.equity;
    const drawdowns = analytics.drawdowns;
    if (!Array.isArray(equity) || !Array.isArray(drawdowns) || drawdowns.length !== equity.length) {
      return null;
    }
    return drawdowns.map((dd, i) => {
      const peak = equity[i] + dd;
      return peak > 0 ? (-Math.abs(dd) / peak) * 100 : 0;
    });
  }

  function drawAllCharts(analytics, progress) {
    paint(
      ui.equityChart,
      (p) =>
        drawLineChart(
          ui.equityChart,
          analytics.equity,
          {
            key: "line",
            labels: analytics.equityDates,
            // null, not "EQUITY": the legend line above this canvas states the
            // figure and band A prints it at 44px, so a third copy inside the
            // plot is duplication — and turning it off buys 20px of padTop back.
            readout: null,
            emptyLabel: "No equity data yet",
            extreme: "max",
            extremeLabel: "PEAK",
            depth: depthPercent(analytics)
          },
          p
        ),
      progress
    );

    paint(
      ui.drawdownChart,
      (p) =>
        drawLineChart(
          ui.drawdownChart,
          analytics.drawdowns,
          {
            key: "neg",
            labels: analytics.drawdownDates,
            readout: "DRAWDOWN",
            emptyLabel: "No drawdown data yet",
            underwater: true,
            extreme: "min",
            extremeLabel: "MAX DD"
          },
          p
        ),
      progress
    );

    // 1f #04 playbook page: the selected setup's expectancy after each of its
    // trades, drawn by the same line engine — same palette, same draw-in, same
    // hover, same reduced-motion behaviour. Empty series below the trade
    // threshold, which is what puts the empty label on the canvas.
    paint(
      ui.playbookChart,
      (p) =>
        drawLineChart(
          ui.playbookChart,
          state.playbook?.curve || [],
          {
            key: state.playbook?.key === "neg" ? "neg" : "line",
            labels: state.playbook?.dates || [],
            readout: "EXPECTANCY / TRADE",
            emptyLabel: "Not enough trades in this setup yet",
            extreme: "max",
            extremeLabel: "PEAK"
          },
          p
        ),
      progress
    );

    renderStrategyPerformanceChart(analytics, progress);

    paint(ui.traderScoreChart, (p) => drawRadarChart(ui.traderScoreChart, analytics.traderScore, p), progress);

    // §6 reports: same horizontal-bar pattern, pre-sorted arrays from
    // calculateAnalytics drawn as-is.
    paint(
      ui.psychologyChart,
      (p) =>
        drawBarChart(
          ui.psychologyChart,
          analytics.psychologyReport || [],
          {
            metric: "pnl",
            emptyLabel: "No psychology data yet",
            // Short form: the tooltip spells out "N% win rate" on hover.
            annotate: (entry) => `${Math.round(entry.winRate)}%`
          },
          p
        ),
      progress
    );

    paint(
      ui.rMultipleChart,
      (p) =>
        drawBarChart(
          ui.rMultipleChart,
          analytics.rMultipleReport || [],
          { metric: "count", emptyLabel: "No R-multiple data yet" },
          p
        ),
      progress
    );
  }

  /* ======================================================================
     Line charts — equity + drawdown
     ====================================================================== */

  function drawLineChart(canvas, data, options, progress = 1) {
    const ctxData = getCanvasContext(canvas);
    if (!ctxData) {
      return;
    }

    const { ctx, width, height } = ctxData;
    const colors = getPalette();
    clearCanvas(ctx, width, height);

    const compact = width < 430;
    // HONEST FLOORS. Reading the box back (above) turns a squashed lie into a
    // CRISP one unless the chrome scales too: 72px of fixed padding in a 100px
    // box leaves 28px of plot. 10px type needs ~2.5x leading to read, so four
    // gridline rows need >=30px of spacing; below that the axis is decoration.
    const bare = height < 140;      // no gridlines, no y-axis, no date labels
    const padLeft = bare ? 8 : compact ? 44 : 56;
    const padRight = bare ? 8 : Array.isArray(options.depth) ? (compact ? 40 : 48) : 18;
    // readout === null buys 20px of padTop back: the legend line above the
    // canvas states that figure and band A prints it at 44px, so a third copy
    // inside the plot is duplication.
    const padTop = bare ? 14 : options.readout === null ? 22 : 42;
    const padBottom = bare ? 4 : 30;
    const left = padLeft;
    const right = width - padRight;
    const top = padTop;
    const bottom = height - padBottom;
    const plotW = right - left;
    const plotH = bottom - top;
    const maxRows = plotH >= 128 ? 5 : plotH >= 68 ? 2 : 0;
    let rows = maxRows;

    const series = Array.isArray(data) ? data : [];
    if (series.length < 2 || !series.every(Number.isFinite)) {
      drawPlotFrame(ctx, { left, right, top, bottom });
      drawCenteredText(ctx, width, height, options.emptyLabel || "No data");
      geometry.delete(canvas);
      return;
    }

    /* Hoisted here — BELOW `series` (it reads series.length, and putting it
       above is a TDZ throw) and ABOVE the money-row search, which owns `rows`.
       A SYMMETRIC depth axis needs a MIDDLE rule to put 0% on, so the shared
       row count must be EVEN, and the search cannot know that unless it is told
       before it runs.
       `!bare` is not redundant with maxRows: a 90px sparkline still gets
       maxRows 2, which alone would let a grey wash and an off-bitmap percent
       column onto a box with 8px of right gutter. */
    const hasDepth =
      !bare && maxRows > 0 && Array.isArray(options.depth) && options.depth.length === series.length;

    // Drawdown is stored as a positive magnitude; the underwater treatment
    // plots it below a zero line so the shape reads as depth, not height.
    const plotted = options.underwater ? series.map((value) => -Math.abs(value)) : series;
    let min = Math.min(...plotted);
    let max = options.underwater ? 0 : Math.max(...plotted);
    if (min === max) {
      // Flat series: open the range so the curve lands mid-plot. Underwater
      // keeps its ceiling at zero so "no drawdown" reads as sitting on the
      // surface, not floating in the middle of the panel.
      min -= 1;
      if (!options.underwater) {
        max += 1;
      }
    }
    // Nice-number ticks. Without this a crisp axis still reads
    // "$50.5K / $50.4K / $50.2K / $50.1K / $49.9K" in a 48px gutter, and on a
    // large account all five compact to the same string — a silent lie.
    // The step has to yield EXACTLY `rows` intervals, because drawPlotFrame
    // walks the axis as the fraction i/rows; a step that merely covers the
    // range would put the labels back between the multiples. Snapping outward
    // supplies the headroom, so the old flat 14% is gone.
    if (maxRows > 0) {
      // THE TICK COUNT IS PART OF THE ANSWER, not a constant. A fixed 4 rows
      // forced a $10K step on a $10K-$34.7K equity curve, so the axis ran
      // $10K-$50K and the curve used 62% of the plot with dead air above it.
      // Trying a few counts and keeping the tightest fit picks 5 rows at a $5K
      // step here: $10K-$35K, 99% of the plot, and rounder labels than before.
      const span = max - min;
      let best = null;
      for (let n = maxRows; n >= Math.min(3, maxRows); n -= 1) {
        // An odd row count has no middle rule, so 0% would print nowhere: at
        // rows=5 the axis reads 6.25 / 3.75 / 1.25 / -1.25 / -3.75 / -6.25 and
        // the zero line floats between two rules.
        if (hasDepth && n % 2) continue;
        const fits = options.underwater
          ? (s) => s * n >= -min
          : (s) => Math.floor(min / s) * s + s * n >= max;
        const step = niceStep(span, n, fits);
        if (step === null) {
          continue;
        }
        const lo = options.underwater ? -step * n : Math.floor(min / step) * step;
        const hi = options.underwater ? 0 : lo + step * n;
        const fill = hi > lo ? span / (hi - lo) : 0;
        if (!best || fill > best.fill) {
          best = { n, lo, hi, fill };
        }
      }
      if (best) {
        rows = best.n;
        min = best.lo;
        max = best.hi;
      }
      // FAILURE PATH THE FILTER EXISTS TO PREVENT: if the even filter leaves
      // only n=4 and niceStep returns null for it, `best` stays null and rows
      // falls back to maxRows = 5 — odd, the exact case above.
      if (hasDepth && rows % 2) rows -= 1;
    } else {
      const headroom = (max - min) * 0.14;
      min -= headroom;
      if (!options.underwater) {
        max += headroom;
      }
    }

    /* ── THE SECOND SCALE ──────────────────────────────────────────────────
       TWO SCALES, ONE SET OF RULES. The row COUNT is part of the money search's
       answer above, so the depth axis does not get its own: it reuses `rows` and
       searches only for its own step. That is what makes both label columns land
       on the same gridlines by construction rather than by luck.

       Nothing below reads `min`/`max` and nothing above reads `depthHalf`.
       That is the whole independence guarantee.

       ZERO SITS ON THE MIDDLE RULE and the area fills DOWN from the series to
       the plot floor. The axis is symmetric — +half at the top rule, -half at
       the bottom — which is why the row count above must be EVEN. Depth is
       never positive today, so the top half stays empty; that is the
       Math.min(value, 0) clamp below, and it is the only thing holding it.

       This also fixes a real bug in passing. Under the old form a fresh journal
       with an all-zero drawdown gave yForDepth(0) === top, so the polygon was
       top -> top -> top and painted NOTHING. depthHalf is always >= 1, so the
       area now runs from the middle rule to the floor. */
    const depth = hasDepth ? options.depth : null;
    let depthHalf = 0;
    if (depth) {
      const half = rows / 2;
      const deepest = -Math.min(...depth, 0);
      // No drawdown in the window: the series lies flat on the middle rule, so
      // the axis only needs round labels to sit against. 1% a row.
      const dstep = deepest > 0 ? niceStep(deepest, half, (s) => s * half >= deepest) : 1;
      depthHalf = (dstep || 1) * half;
    }

    const yFor = (value) => bottom - ((value - min) / (max - min)) * plotH;
    // +half -> top, 0 -> the MIDDLE rule, -half -> bottom.
    const yForDepth = (value) => top + ((depthHalf - value) / (2 * depthHalf)) * plotH;
    const points = plotted.map((value, index) => ({
      x: left + (index / (plotted.length - 1)) * plotW,
      y: yFor(value)
    }));

    drawPlotFrame(ctx, {
      left,
      right,
      top,
      bottom,
      // `plotted` is already sign-corrected, so the axis reads it straight:
      // the underwater chart labels depth as negative money.
      valueAt: (t) => max - (max - min) * t,
      /* The money axis states the account SIZE just as plainly as the balance
         figure does, so the privacy toggle has to reach it too — hiding one and
         not the other is a privacy control that does not work. The axis keeps
         its rules and its spacing, so the curve stays exactly as readable; only
         the absolute numbers go. */
      formatter: balanceHidden() ? () => "•••" : formatCompactCurrency,
      // Same `t`, same loop, same `y` — so row i carries BOTH readings and the
      // two columns can never drift apart.
      // t=0 -> +half, t=0.5 -> 0, t=1 -> -half. drawPlotFrame needs NO change:
      // it already walks the same i/rows fraction for both label columns, which
      // is what keeps them on one set of rules.
      valueAtRight: depth ? (t) => depthHalf * (1 - 2 * t) : null,
      formatterRight: formatAxisPercent,
      rows
    });

    const stroke = options.key === "neg" ? colors.neg : colors.line;
    const glow = options.key === "neg" ? colors.negGlow : colors.glow;
    const areaBase = options.underwater ? yFor(0) : bottom;
    const revealX = left + plotW * progress;

    ctx.save();
    if (progress < 1) {
      ctx.beginPath();
      ctx.rect(0, 0, revealX + 1, height);
      ctx.clip();
    }

    /* Depth series. Painted FIRST and flat, in the neutral the palette already
       carries, so the equity area, its three-pass glow stroke and every marker
       land on top of it. Z-ORDER is what stops the second series swamping the
       first — not a scale fudge, which would be a lie about the axis beside it.
       Inside the reveal clip, so both series wipe in together. PAINT ONLY: it is
       never written to `geometry`, so the scrub, the hover hit-test and the
       playhead never see it. */
    if (depth) {
      const depthPoints = depth.map((value, index) => ({
        x: left + (index / (depth.length - 1)) * plotW,
        y: yForDepth(Math.min(value, 0))
      }));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(depthPoints[0].x, bottom);
      traceSmoothPath(ctx, depthPoints, false);
      ctx.lineTo(depthPoints[depthPoints.length - 1].x, bottom);
      ctx.closePath();
      ctx.fillStyle = colors.track;
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = colors.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      traceSmoothPath(ctx, depthPoints);
      ctx.stroke();
      ctx.restore();
    }

    // Area — multi-stop gradient spanning the actual envelope of the curve.
    const ys = points.map((point) => point.y);
    const gradTop = options.underwater ? areaBase : Math.min(...ys);
    let gradBottom = options.underwater ? Math.max(...ys) : bottom;
    if (gradBottom - gradTop < 2) {
      gradBottom = gradTop + 2;
    }
    const area = ctx.createLinearGradient(0, gradTop, 0, gradBottom);
    if (options.underwater) {
      area.addColorStop(0, colors.negAreaTop);
      area.addColorStop(1, colors.negAreaBottom);
    } else {
      area.addColorStop(0, colors.areaTop);
      area.addColorStop(0.55, colors.areaMid);
      area.addColorStop(1, colors.areaBottom);
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, areaBase);
    traceSmoothPath(ctx, points, false);
    ctx.lineTo(points[points.length - 1].x, areaBase);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();

    // Stroke — three layered passes: wide halo, tight halo, crisp core.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = stroke;
    [
      [18, 0.32, 2.6],
      [8, 0.6, 2.2],
      [0, 1, 2]
    ].forEach(([blur, alpha, lineWidth]) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = glow;
      ctx.shadowBlur = blur;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      traceSmoothPath(ctx, points);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();

    // Zero rule for the underwater chart — the surface the curve hangs from.
    if (options.underwater) {
      ctx.save();
      ctx.strokeStyle = colors.lineStrong;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, Math.round(areaBase) + 0.5);
      ctx.lineTo(right, Math.round(areaBase) + 0.5);
      ctx.stroke();
      ctx.restore();
    }

    // Extreme annotation (peak / trough), only when it is not the head point.
    const extremeIndex = findExtreme(plotted, options.extreme);
    if (points.length >= 5 && extremeIndex > 0 && extremeIndex < points.length - 1 && progress > 0.6) {
      drawExtremeMarker(ctx, points[extremeIndex], {
        label: `${options.extremeLabel} ${formatCompactCurrency(plotted[extremeIndex])}`,
        color: stroke,
        above: !options.underwater,
        top,
        bottom,
        left,
        right
      });
    }

    // Head marker — halo, ring, core. Rides the reveal edge while drawing in.
    const headIndex = progress < 1 ? Math.max(0, Math.round((points.length - 1) * progress)) : points.length - 1;
    drawHeadMarker(ctx, points[headIndex], {
      color: stroke,
      glow,
      halo: options.key === "neg" ? colors.haloNeg : colors.halo,
      haloFade: options.key === "neg" ? colors.haloNegFade : colors.haloFade,
      progress
    });

    // Readout block, top-left. `!== null`, not `|| "LAST"`: null has to survive
    // that default, because a caller that states this figure in its own legend
    // turns the in-plot copy off. Every other caller passes a string and is
    // byte-identical in behaviour.
    if (options.readout !== null) {
      const lastValue = series[series.length - 1];
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = colors.textFaint;
      ctx.font = colors.font(600, 10);
      ctx.fillText(options.readout || "LAST", left, 18);
      ctx.fillStyle = options.underwater && lastValue > 0 ? colors.neg : colors.text;
      ctx.font = colors.font(700, compact ? 15 : 17);
      ctx.fillText(formatCurrency(options.underwater ? -lastValue : lastValue), left, 34);
    }

    // A bare box has 4px below the baseline; date labels draw at bottom+11 and
    // would land outside the canvas.
    if (!bare) {
      drawDateLabels(ctx, points, options.labels, bottom, plotW);
    }

    // Playhead before the crosshair, and mutually exclusive with it (the
    // mousemove handler bails while a scrub is engaged).
    if (isScrubCanvas(canvas) && scrubIndex !== null && progress >= 1) {
      const anchor = clamp(scrubIndex, 0, points.length - 1);
      // Idle ease => re-derive from the geometry just painted, so a resize or
      // a theme repaint puts the playhead back on its own trade.
      if (!scrubFrame || scrubX === null) {
        scrubX = points[anchor].x;
      }
      const headX = clamp(scrubX, left, right);
      drawScrubPlayhead(ctx, {
        x: headX,
        y: yAtX(points, headX),
        color: stroke,
        glow,
        top,
        bottom
      });
    }

    const hovered = hoverIndex.get(canvas);
    if (typeof hovered === "number" && hovered >= 0 && hovered < points.length && progress >= 1) {
      drawLineHover(ctx, {
        point: points[hovered],
        value: options.underwater ? -series[hovered] : series[hovered],
        label: Array.isArray(options.labels) ? formatChartDateLabel(options.labels[hovered]) : "",
        color: stroke,
        glow,
        top,
        bottom,
        width,
        height
      });
    }

    geometry.set(canvas, { kind: "line", points, left, right });
  }

  function findExtreme(values, mode) {
    let index = 0;
    values.forEach((value, i) => {
      if (mode === "min" ? value < values[index] : value > values[index]) {
        index = i;
      }
    });
    return index;
  }

  function drawExtremeMarker(ctx, point, options) {
    const colors = getPalette();
    const { label, color, above, top, bottom, left, right } = options;
    ctx.save();
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x, above ? top + 4 : bottom - 4);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.font = colors.font(600, 9.5);
    ctx.fillStyle = colors.textFaint;
    const textWidth = ctx.measureText(label).width;
    const x = clamp(point.x - textWidth / 2, left, right - textWidth);
    ctx.textAlign = "left";
    ctx.textBaseline = above ? "bottom" : "top";
    // Clamped inside the plot so the annotation never lands on the date row.
    const labelY = above ? Math.max(point.y - 9, top + 10) : Math.min(point.y + 9, bottom - 12);
    ctx.fillText(label, x, labelY);
    ctx.restore();
  }

  function drawHeadMarker(ctx, point, options) {
    const colors = getPalette();
    const { color, glow, progress } = options;
    ctx.save();
    const halo = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 20);
    halo.addColorStop(0, options.halo);
    halo.addColorStop(1, options.haloFade);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, progress < 1 ? 4.5 : 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = colors.inset;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
    ctx.fill();

    // Ping: one expanding ring on the tail of the draw-in. A perpetual pulse
    // would mean a permanent rAF repainting a full canvas on mobile — this
    // fires exactly when the data changed, which is when it means something.
    if (progress > 0.72 && progress < 1) {
      const t = (progress - 0.72) / 0.28;
      ctx.globalAlpha = 1 - t;
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6 + t * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLineHover(ctx, options) {
    const colors = getPalette();
    const { point, value, label, color, glow, top, bottom, width, height } = options;
    ctx.save();
    ctx.strokeStyle = colors.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.round(point.x) + 0.5, top);
    ctx.lineTo(Math.round(point.x) + 0.5, bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.shadowColor = glow;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const rows = [{ text: formatCurrency(value), font: colors.font(700, 12), size: 12, color: colors.text }];
    if (label) {
      rows.push({ text: label, font: colors.font(500, 10), size: 10, color: colors.textSoft });
    }
    drawTooltip(ctx, { width, height }, point, rows);
  }

  function drawDateLabels(ctx, points, labels, bottom, plotW) {
    if (!Array.isArray(labels) || labels.length !== points.length || !points.length) {
      return;
    }

    const colors = getPalette();
    // Three was a FLOOR for a phone-width canvas, not a ceiling for a 1100px
    // plot. ~110px a label at 10px mono keeps "AUG 24" off its neighbour; the
    // Set collapses the duplicates a short series produces, so a 3-point curve
    // still prints exactly 3.
    const slots = clamp(Math.floor((plotW || 0) / 110), 2, 6);
    const indices = Array.from(
      new Set(Array.from({ length: slots + 1 }, (_, i) => Math.round((i / slots) * (points.length - 1))))
    );
    ctx.fillStyle = colors.axis;
    ctx.font = colors.font(500, 10);
    ctx.textBaseline = "top";

    indices.forEach((index, labelIndex) => {
      const label = formatChartDateLabel(labels[index]);
      if (!label) {
        return;
      }

      if (labelIndex === 0) {
        ctx.textAlign = "left";
      } else if (labelIndex === indices.length - 1) {
        ctx.textAlign = "right";
      } else {
        ctx.textAlign = "center";
      }
      ctx.fillText(label, points[index].x, bottom + 11);
    });

    ctx.textAlign = "left";
  }

  // Receding grid: the top rules fade out so the eye lands on the baseline.
  function drawPlotFrame(ctx, options) {
    const colors = getPalette();
    const { left, right, top, bottom, valueAt, formatter, valueAtRight, formatterRight } = options;
    // The caller decides how many rules the box can carry; 4 is the full
    // treatment, 2 the squeezed one, 0 means the axis is not honest here.
    const rows = Number.isFinite(options.rows) ? options.rows : 4;
    ctx.save();
    ctx.lineWidth = 1;
    for (let i = 0; rows > 0 && i <= rows; i += 1) {
      const y = Math.round(top + ((bottom - top) * i) / rows) + 0.5;
      ctx.globalAlpha = 0.4 + (i / rows) * 0.6;
      ctx.strokeStyle = colors.grid;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      if (typeof valueAt === "function") {
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.axis;
        ctx.font = colors.font(500, 10);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(formatter(valueAt(i / rows)), left - 8, y);
      }

      // Second scale, right gutter. Restates globalAlpha because the rule stroke
      // above fades the top rows out and the labels must not fade with them.
      if (typeof valueAtRight === "function") {
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.axis;
        ctx.font = colors.font(500, 10);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(formatterRight(valueAtRight(i / rows)), right + 8, y);
      }
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = colors.lineStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(bottom) + 0.5);
    ctx.lineTo(right, Math.round(bottom) + 0.5);
    ctx.stroke();
    ctx.restore();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  /* ======================================================================
     Horizontal bars — strategy performance, psychology, session, R-multiple
     ====================================================================== */

  function renderStrategyPerformanceChart(analytics, progress = 1) {
    const dimension = state.dashboard.performanceDimension;
    const metric = state.dashboard.performanceMetric;
    const entries = Array.isArray(analytics?.strategyPerformance?.[dimension])
      ? analytics.strategyPerformance[dimension]
      : [];

    ui.strategyDimensionButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.performanceDimension === dimension);
    });
    ui.strategyMetricButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.performanceMetric === metric);
    });

    const sortedEntries = getStrategyPerformanceRows(entries, { dimension, metric });
    paint(
      ui.strategyPerformanceChart,
      (p) =>
        drawBarChart(
          ui.strategyPerformanceChart,
          sortedEntries,
          { metric, emptyLabel: `No ${dimension} performance data yet` },
          p
        ),
      progress
    );
  }

  function getStrategyPerformanceRows(entries, options = {}) {
    const { dimension = "setup", metric = "pnl" } = options;
    const rows = [...entries];

    if (dimension === "day") {
      return rows;
    }

    if (metric === "count") {
      return rows.sort((a, b) => b.count - a.count || b.pnl - a.pnl).slice(0, 8);
    }

    return rows.sort((a, b) => b.pnl - a.pnl || b.count - a.count).slice(0, 8);
  }

  function drawBarChart(canvas, entries, options, progress = 1) {
    // padTop 18 + padBottom 28 + 34 per row. Capped by data-height so a long
    // list still scrolls inside the panel it was designed for, and floored so
    // an empty chart keeps room for its "no data" line.
    const rowCount = Array.isArray(entries) ? entries.length : 0;
    const authoredHeight = Number(canvas && canvas.dataset.height) || 280;
    const fitHeight = rowCount
      ? Math.min(authoredHeight, 46 + rowCount * 34)
      : authoredHeight;
    const ctxData = getCanvasContext(canvas, fitHeight);
    if (!ctxData) {
      return;
    }

    const { ctx, width, height } = ctxData;
    const colors = getPalette();
    clearCanvas(ctx, width, height);

    if (!Array.isArray(entries) || !entries.length) {
      drawCenteredText(ctx, width, height, options.emptyLabel || "No strategy data");
      geometry.delete(canvas);
      return;
    }

    // Bars grow from the baseline with a per-row stagger.
    const barDuration = Math.max(DRAW_DURATION_MS - BAR_STAGGER_MS * (entries.length - 1), 220);
    const barProgress = (index) =>
      clamp((progress * DRAW_DURATION_MS - BAR_STAGGER_MS * index) / barDuration, 0, 1);

    const counting = options.metric === "count";
    const compact = width < 460;
    const annotating = typeof options.annotate === "function";
    const padLeft = compact ? 108 : 138;
    // An annotated chart reserves a fixed right column so the per-row note
    // never collides with the bar's own value label.
    const padRight = 22 + (annotating ? (compact ? 34 : 40) : 0);
    const padTop = 18;
    const padBottom = 28;
    const top = padTop;
    const bottom = height - padBottom;
    const plotH = bottom - top;
    const rowGap = plotH / entries.length;
    const barHeight = Math.min(24, Math.max(rowGap * 0.54, 9));
    const depth = clamp(barHeight * 0.24, 3, 6);
    const hovered = hoverIndex.get(canvas);

    const maxAbs = Math.max(
      ...entries.map((entry) => Math.abs(counting ? entry.count : entry.pnl)),
      1
    );
    const zeroX = counting ? padLeft : padLeft + (width - padLeft - padRight) / 2;
    const span = counting ? width - padLeft - padRight - depth - 14 : (width - padLeft - padRight) / 2 - depth - 10;

    // Row tracks — a recessed lane per row so empty space still reads as data.
    entries.forEach((_, index) => {
      const centerY = top + rowGap * index + rowGap / 2;
      const trackX = counting ? zeroX : padLeft;
      const trackW = counting ? width - padRight - zeroX : width - padLeft - padRight;
      ctx.save();
      ctx.globalAlpha = index === hovered ? 1 : 0.62;
      fillRoundedRect(ctx, trackX, centerY - barHeight / 2, trackW, barHeight, barHeight / 2, colors.track);
      ctx.restore();
    });

    // Zero axis — a 2px rule that fades at both ends so it reads as a spine
    // the bars hang off, not a border.
    const axis = ctx.createLinearGradient(0, top, 0, bottom);
    axis.addColorStop(0, colors.grid);
    axis.addColorStop(0.5, colors.lineStrong);
    axis.addColorStop(1, colors.grid);
    ctx.save();
    ctx.fillStyle = axis;
    ctx.fillRect(Math.round(zeroX) - 1, top - 4, 2, plotH + 8);
    ctx.restore();

    ctx.textBaseline = "middle";

    entries.forEach((entry, index) => {
      const centerY = top + rowGap * index + rowGap / 2;
      const value = counting ? entry.count : entry.pnl;
      const length = (Math.abs(value) / maxAbs) * span * barProgress(index);
      const barX = counting || value >= 0 ? zeroX : zeroX - length;
      const active = index === hovered;

      const tone = counting
        ? entry.tone === "neg"
          ? "neg"
          : entry.tone === "pos"
            ? "pos"
            : "line"
        : value >= 0
          ? "pos"
          : "neg";
      const face = tone === "pos" ? colors.pos : tone === "neg" ? colors.neg : colors.line;
      const deep = tone === "pos" ? colors.posDeep : tone === "neg" ? colors.negDeep : colors.lineDeep;
      const glow = tone === "pos" ? colors.posGlow : tone === "neg" ? colors.negGlow : colors.glow;

      // Row label in the gutter.
      ctx.fillStyle = active ? colors.text : colors.textSoft;
      ctx.font = colors.font(active ? 700 : 500, compact ? 11 : 12);
      ctx.textAlign = "right";
      drawPerformanceCanvasLabel(ctx, entry.label, padLeft - 14, centerY, width);

      drawExtrudedBar(ctx, barX, centerY - barHeight / 2, Math.max(length, 2), barHeight, {
        face,
        deep,
        glow,
        depth,
        active
      });

      // Value label — outside the bar end, flipped inside near the edge.
      const display = counting ? String(entry.count) : formatCompactCurrency(value);
      ctx.font = colors.font(600, compact ? 10 : 11);
      const textWidth = ctx.measureText(display).width;
      const endX = counting || value >= 0 ? barX + Math.max(length, 2) : barX;
      const outside = counting || value >= 0 ? endX + 8 + depth : endX - 8;
      const fits =
        counting || value >= 0 ? outside + textWidth <= width - padRight + 18 : outside - textWidth >= 2;
      ctx.textAlign = counting || value >= 0 ? (fits ? "left" : "right") : fits ? "right" : "left";
      // Flipped inside the bar, the label sits on the bar face — text-inverse
      // is the pairing that keeps AA in both themes (bar faces are the strong
      // colour in dark and the deep colour in light).
      ctx.fillStyle = fits ? (active ? colors.text : colors.textSoft) : colors.textInverse;
      ctx.fillText(display, fits ? outside : endX - (counting || value >= 0 ? 8 : -8), centerY);

      // Optional per-row annotation (e.g. win rate) in the reserved column.
      if (annotating) {
        ctx.fillStyle = active ? colors.textSoft : colors.textFaint;
        ctx.textAlign = "right";
        ctx.font = colors.font(500, 10);
        ctx.fillText(String(options.annotate(entry)), width - 6, centerY);
      }
    });

    drawStrategyAxisLabels(ctx, {
      left: counting ? zeroX : padLeft,
      right: width - padRight,
      bottom: bottom + 12,
      values: counting ? [0, Math.round(maxAbs / 2), maxAbs] : [-maxAbs, 0, maxAbs],
      formatter: counting ? (value) => String(value) : formatCompactCurrency
    });

    if (typeof hovered === "number" && entries[hovered] && progress >= 1) {
      const entry = entries[hovered];
      const value = counting ? entry.count : entry.pnl;
      const length = (Math.abs(value) / maxAbs) * span;
      const centerY = top + rowGap * hovered + rowGap / 2;
      const anchorX = counting || value >= 0 ? zeroX + length : zeroX - length;
      const plural = (count) => `${count} trade${count === 1 ? "" : "s"}`;
      const rows = [
        { text: String(entry.label), font: colors.font(600, 11), size: 11, color: colors.text },
        {
          text: counting ? plural(entry.count) : formatCurrency(entry.pnl),
          font: colors.font(700, 12),
          size: 12,
          // Money colours stay reserved for money: a trade count is neutral.
          color: counting ? colors.text : value >= 0 ? colors.pos : colors.neg
        }
      ];
      if (Number.isFinite(entry.winRate)) {
        rows.push({
          text: `${Math.round(entry.winRate)}% win rate`,
          font: colors.font(500, 10),
          size: 10,
          color: colors.textSoft
        });
      } else if (!counting && Number.isFinite(entry.count)) {
        rows.push({ text: plural(entry.count), font: colors.font(500, 10), size: 10, color: colors.textSoft });
      }
      drawTooltip(ctx, { width, height }, { x: anchorX, y: centerY }, rows);
    }

    geometry.set(canvas, { kind: "bar", top, bottom, rowGap, count: entries.length });
  }

  // Pseudo-3D bar: an offset deep face gives the volume, a clipped light-to-
  // shade gradient gives the cylinder, a top hairline gives the edge.
  function drawExtrudedBar(ctx, x, y, width, height, options) {
    const colors = getPalette();
    const { face, deep, glow, depth, active } = options;
    const radius = Math.min(height / 2, width / 2, 12);

    fillRoundedRect(ctx, x + depth, y + depth, width, height, radius, deep);

    ctx.save();
    if (active) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 16;
    }
    fillRoundedRect(ctx, x, y, width, height, radius, face);
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, x, y, Math.max(width, 2), Math.max(height, 2), radius);
    ctx.clip();
    const shading = ctx.createLinearGradient(0, y, 0, y + height);
    shading.addColorStop(0, colors.highlight);
    shading.addColorStop(0.45, colors.highlightFade);
    shading.addColorStop(0.58, colors.shadeFade);
    shading.addColorStop(1, colors.shade);
    ctx.fillStyle = shading;
    ctx.fillRect(x, y, Math.max(width, 2), Math.max(height, 2));
    ctx.restore();

    if (width > radius * 2 + 2) {
      ctx.save();
      ctx.strokeStyle = colors.highlight;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + radius, y + 0.5);
      ctx.lineTo(x + width - radius, y + 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawStrategyAxisLabels(ctx, options) {
    const colors = getPalette();
    const { left, right, bottom, values, formatter } = options;
    const steps = Math.max(values.length - 1, 1);
    ctx.fillStyle = colors.axis;
    ctx.font = colors.font(500, 10);
    ctx.textBaseline = "top";

    values.forEach((value, index) => {
      const x = left + ((right - left) * index) / steps;
      if (index === 0) {
        ctx.textAlign = "left";
      } else if (index === values.length - 1) {
        ctx.textAlign = "right";
      } else {
        ctx.textAlign = "center";
      }
      ctx.fillText(formatter(value), x, bottom);
    });

    ctx.textAlign = "left";
  }

  function drawPerformanceCanvasLabel(ctx, label, x, y, width) {
    const lines = formatPerformanceCanvasLabel(label, width);
    const offset = lines.length > 1 ? 6 : 0;
    lines.forEach((line, index) => {
      const lineY = y + (index === 0 ? -offset : offset);
      ctx.fillText(line, x, lineY);
    });
  }

  function formatPerformanceCanvasLabel(label, width) {
    const text = String(label || "").trim();
    if (!text) {
      return [""];
    }

    const singleLineLimit = width < 460 ? 10 : 15;
    const words = text.split(/\s+/).filter(Boolean);

    if (words.length === 1) {
      return [truncatePerformanceLabel(text, singleLineLimit)];
    }

    const lines = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= singleLineLimit || !current) {
        current = candidate;
        continue;
      }

      lines.push(current);
      current = word;
      if (lines.length === 1) {
        continue;
      }
      break;
    }

    if (current) {
      lines.push(current);
    }

    return lines.slice(0, 2).map((line, index, collection) => {
      const limit = index === collection.length - 1 ? singleLineLimit : singleLineLimit + 2;
      return truncatePerformanceLabel(line, limit);
    });
  }

  function truncatePerformanceLabel(text, limit) {
    return text.length > limit ? `${text.slice(0, limit - 1)}${ELLIPSIS}` : text;
  }

  function roundRectPath(ctx, x, y, width, height, radius) {
    const safeWidth = Math.max(width, 2);
    const safeHeight = Math.max(height, 2);
    const safeRadius = Math.min(radius, safeHeight / 2, safeWidth / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, safeWidth, safeHeight, safeRadius);
      return;
    }
    ctx.moveTo(x + safeRadius, y);
    ctx.arcTo(x + safeWidth, y, x + safeWidth, y + safeHeight, safeRadius);
    ctx.arcTo(x + safeWidth, y + safeHeight, x, y + safeHeight, safeRadius);
    ctx.arcTo(x, y + safeHeight, x, y, safeRadius);
    ctx.arcTo(x, y, x + safeWidth, y, safeRadius);
    ctx.closePath();
  }

  function fillRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
    roundRectPath(ctx, x, y, width, height, radius);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function drawTooltip(ctx, bounds, anchor, rows) {
    const colors = getPalette();
    const padX = 10;
    const padY = 8;
    const lead = 4;
    let boxWidth = 0;
    let boxHeight = 0;

    const sized = rows.map((row) => {
      ctx.font = row.font;
      boxWidth = Math.max(boxWidth, ctx.measureText(row.text).width);
      const lineHeight = row.size + 3;
      boxHeight += lineHeight + (boxHeight ? lead : 0);
      return { ...row, lineHeight };
    });

    boxWidth += padX * 2;
    boxHeight += padY * 2;

    let x = anchor.x + 14;
    let y = anchor.y - boxHeight - 12;
    if (x + boxWidth > bounds.width - 6) {
      x = anchor.x - boxWidth - 14;
    }
    x = clamp(x, 6, Math.max(bounds.width - boxWidth - 6, 6));
    if (y < 6) {
      y = anchor.y + 16;
    }
    y = clamp(y, 6, Math.max(bounds.height - boxHeight - 6, 6));

    ctx.save();
    ctx.shadowColor = colors.tooltipShadow;
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    fillRoundedRect(ctx, x, y, boxWidth, boxHeight, 9, colors.tooltipBg);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = colors.tooltipLine;
    ctx.lineWidth = 1;
    roundRectPath(ctx, x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1, 9);
    ctx.stroke();
    ctx.restore();

    let cursorY = y + padY;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    sized.forEach((row) => {
      ctx.font = row.font;
      ctx.fillStyle = row.color;
      ctx.fillText(row.text, x + padX, cursorY);
      cursorY += row.lineHeight + lead;
    });
    ctx.textBaseline = "alphabetic";
  }

  /* ======================================================================
     Radar — trader score
     ====================================================================== */

  function drawRadarChart(canvas, scoreData, progress = 1) {
    const ctxData = getCanvasContext(canvas);
    if (!ctxData) {
      return;
    }

    const { ctx, width, height } = ctxData;
    const colors = getPalette();
    clearCanvas(ctx, width, height);

    const metrics = Array.isArray(scoreData?.metrics) ? scoreData.metrics : [];
    if (!metrics.length) {
      drawCenteredText(ctx, width, height, "No trader score data yet");
      return;
    }

    const centerX = width / 2;
    const centerY = height / 2 - 2;
    // 90, not 120. The reserve is for the six metric labels top and bottom;
    // 120 was tuned when this canvas was data-height 300, and after the
    // density pass cut it to 170 the expression went negative and the radar
    // sat permanently on its 46px floor — a 92px circle in a 350px box.
    const radius = Math.max(Math.min((width - 150) / 2, (height - 90) / 2), 46);
    const rings = 5;
    const angleStep = (Math.PI * 2) / metrics.length;
    const at = (index, distance) => {
      const angle = -Math.PI / 2 + index * angleStep;
      return { x: centerX + Math.cos(angle) * distance, y: centerY + Math.sin(angle) * distance, angle };
    };

    // Concentric rings, outside in, alternating wash for depth.
    for (let ring = rings; ring >= 1; ring -= 1) {
      const ringRadius = (radius / rings) * ring;
      ctx.beginPath();
      metrics.forEach((_, index) => {
        const point = at(index, ringRadius);
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.closePath();
      if (ring % 2 === 0) {
        ctx.fillStyle = colors.ringWash;
        ctx.fill();
      }
      ctx.strokeStyle = ring === rings ? colors.lineStrong : colors.grid;
      ctx.lineWidth = ring === rings ? 1.25 : 1;
      ctx.stroke();
    }

    // Spokes + axis labels.
    metrics.forEach((metric, index) => {
      const outer = at(index, radius);
      ctx.save();
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(outer.x, outer.y);
      ctx.stroke();
      ctx.restore();

      const labelPoint = at(index, radius + 20);
      const lines = wrapRadarLabel(metric.label);
      const lineHeight = 12;
      const block = lines.length + 1;
      const startY =
        labelPoint.y < centerY - 4
          ? labelPoint.y - (block - 1) * lineHeight
          : labelPoint.y < centerY + 4
            ? labelPoint.y - ((block - 1) * lineHeight) / 2
            : labelPoint.y;

      ctx.textAlign = labelPoint.x >= centerX + 6 ? "left" : labelPoint.x <= centerX - 6 ? "right" : "center";
      ctx.textBaseline = "middle";
      lines.forEach((line, lineIndex) => {
        ctx.fillStyle = colors.textFaint;
        ctx.font = colors.font(600, 9.5);
        ctx.fillText(line.toUpperCase(), labelPoint.x, startY + lineIndex * lineHeight);
      });
      ctx.fillStyle = colors.text;
      ctx.font = colors.font(700, 11);
      ctx.fillText(String(Math.round(clamp(metric.value, 0, 100))), labelPoint.x, startY + lines.length * lineHeight);
    });

    const vertices = metrics.map((metric, index) => at(index, radius * (clamp(metric.value, 0, 100) / 100)));

    ctx.save();
    // Draw-in sweep: the polygon is revealed by a radar wedge, not scaled up.
    if (progress < 1) {
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius * 1.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.closePath();
      ctx.clip();
    }

    const fill = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(radius, 1));
    fill.addColorStop(0, colors.radarCore);
    fill.addColorStop(1, colors.radarEdge);

    ctx.beginPath();
    vertices.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.strokeStyle = colors.radar;
    ctx.shadowColor = colors.radarGlow;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.shadowBlur = 0;

    vertices.forEach((point) => {
      ctx.save();
      ctx.shadowColor = colors.radarGlow;
      ctx.shadowBlur = 10;
      ctx.fillStyle = colors.radar;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = colors.inset;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // Leading edge of the sweep, glowing, while the draw-in runs.
    if (progress < 1 && progress > 0.005) {
      const angle = -Math.PI / 2 + Math.PI * 2 * progress;
      ctx.save();
      ctx.strokeStyle = colors.radar;
      ctx.shadowColor = colors.radarGlow;
      ctx.shadowBlur = 14;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
      ctx.stroke();
      ctx.restore();
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function wrapRadarLabel(label) {
    const text = String(label || "").trim();
    if (text.length <= 10) {
      return [text];
    }
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 2) {
      return [truncatePerformanceLabel(text, 12)];
    }
    return [words[0], truncatePerformanceLabel(words.slice(1).join(" "), 12)];
  }

  /* ====================================================================== */

  // heightOverride lets a chart size itself to its own content. data-height is
  // a fixed attribute, which is right for a curve (the shape needs the room
  // whatever the sample count) and wrong for a bar chart, where one row in a
  // 180px box is a 24px bar swimming in 55px of empty lane above and below.
  function getCanvasContext(canvas, heightOverride) {
    if (!canvas) {
      return null;
    }

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 900;
    // THE BOX IS THE TRUTH. data-height stays as the fallback for a canvas
    // that has no box: a .view without .is-active is display:none, a closed
    // <details> is too, and #drawdownChart is explicitly display:none on the
    // dashboard grid — all three report clientHeight 0.
    // This one expression was the whole "unreadable mush" defect: #equityChart
    // was a 919x240 bitmap displayed in a 919x94 box, a 2.55x anamorphic
    // vertical crush at a perfect 1:1 horizontal, which also smeared the
    // three-pass glow stroke whose blur radii were authored against 240px.
    const height = Number(heightOverride) || canvas.clientHeight || Number(canvas.dataset.height) || 280;

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    // All drawing below is in CSS pixels: gradients, shadows and radii are
    // authored once and scale with the device ratio for free.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width, height };
  }

  function clearCanvas(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  function drawCenteredText(ctx, width, height, text) {
    const colors = getPalette();
    ctx.save();
    ctx.fillStyle = colors.textFaint;
    ctx.font = colors.font(500, 12);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, width / 2, height / 2);
    ctx.restore();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  return {
    renderCharts,
    setScrub,
    clearScrub
  };
}
