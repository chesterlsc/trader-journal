import { clamp } from "../lib/core.js";
import { formatCurrency, formatCompactCurrency, formatChartDateLabel } from "../lib/format.js";

const ELLIPSIS = "\u2026";

export function createChartsModule({ ui, state }) {
  function renderCharts(analytics) {
    if (!analytics) {
      return;
    }

    drawLineChart(ui.equityChart, analytics.equity, {
      lineColor: "#39d3ff",
      fillColor: "rgba(57, 211, 255, 0.15)",
      labels: analytics.equityDates,
      emptyLabel: "No equity data yet"
    });

    drawLineChart(ui.drawdownChart, analytics.drawdowns, {
      lineColor: "#ff5a7e",
      fillColor: "rgba(255, 90, 126, 0.16)",
      labels: analytics.drawdownDates,
      emptyLabel: "No drawdown data yet"
    });

    renderStrategyPerformanceChart(analytics);
    drawRadarChart(ui.traderScoreChart, analytics.traderScore);
  }

  function drawLineChart(canvas, data, options) {
    const ctxData = getCanvasContext(canvas);
    if (!ctxData) {
      return;
    }

    const { ctx, width, height } = ctxData;
    clearCanvas(ctx, width, height);

    const padX = 28;
    const padTop = 30;
    const padBottom = 34;
    const chartHeight = height - padTop - padBottom;
    drawGrid(ctx, width, height, padX, padTop, padBottom);

    if (!Array.isArray(data) || data.length < 2) {
      drawCenteredText(ctx, width, height, options.emptyLabel || "No data");
      return;
    }

    let min = Math.min(...data);
    let max = Math.max(...data);

    if (min === max) {
      min -= 1;
      max += 1;
    }

    const points = data.map((value, index) => {
      const x = padX + (index / (data.length - 1)) * (width - padX * 2);
      const y = height - padBottom - ((value - min) / (max - min)) * chartHeight;
      return { x, y };
    });

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    ctx.strokeStyle = options.lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.lineTo(points[points.length - 1].x, height - padBottom);
    ctx.lineTo(points[0].x, height - padBottom);
    ctx.closePath();
    ctx.fillStyle = options.fillColor;
    ctx.fill();

    const last = data[data.length - 1];
    ctx.fillStyle = "#d3e6ff";
    ctx.font = "600 12px JetBrains Mono, Consolas, monospace";
    ctx.fillText(`Last: ${formatCurrency(last)}`, padX, padTop - 10);

    ctx.fillStyle = options.lineColor;
    points.forEach((point, index) => {
      const radius = index === 0 || index === points.length - 1 ? 4.5 : 2.5;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(8, 12, 24, 0.92)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    drawLineChartDateLabels(ctx, points, options.labels, height, padBottom);
  }

  function drawLineChartDateLabels(ctx, points, labels, height, padBottom) {
    if (!Array.isArray(labels) || labels.length !== points.length || !points.length) {
      return;
    }

    const indices = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
    ctx.fillStyle = "rgba(182, 198, 228, 0.76)";
    ctx.font = "500 10px JetBrains Mono, Consolas, monospace";
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
      ctx.fillText(label, points[index].x, height - padBottom + 12);
    });

    ctx.textAlign = "left";
  }

  function renderStrategyPerformanceChart(analytics) {
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
    drawStrategyPerformanceChart(ui.strategyPerformanceChart, sortedEntries, {
      metric,
      emptyLabel: `No ${dimension} performance data yet`
    });
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

  function drawStrategyPerformanceChart(canvas, entries, options) {
    const ctxData = getCanvasContext(canvas);
    if (!ctxData) {
      return;
    }

    const { ctx, width, height } = ctxData;
    clearCanvas(ctx, width, height);

    if (!Array.isArray(entries) || !entries.length) {
      drawCenteredText(ctx, width, height, options.emptyLabel || "No strategy data");
      return;
    }

    const metric = options.metric === "count" ? "count" : "pnl";
    const padLeft = width < 460 ? 112 : 142;
    const padRight = 18;
    const padTop = 16;
    const padBottom = 26;
    const chartHeight = height - padTop - padBottom;
    const rowGap = chartHeight / entries.length;
    const barHeight = Math.min(24, rowGap * 0.56);
    const labelColor = "#dbe8ff";
    ctx.strokeStyle = "rgba(132, 156, 214, 0.1)";
    ctx.lineWidth = 1;

    entries.forEach((_, index) => {
      const y = padTop + rowGap * index + rowGap / 2;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
    });

    ctx.font = width < 460 ? '500 11px "JetBrains Mono", "Consolas", monospace' : '500 12px "JetBrains Mono", "Consolas", monospace';
    ctx.textBaseline = "middle";

    if (metric === "count") {
      const maxValue = Math.max(...entries.map((entry) => entry.count), 1);
      const zeroX = padLeft;
      const usableWidth = width - padLeft - padRight;

      ctx.strokeStyle = "rgba(87, 161, 255, 0.24)";
      ctx.beginPath();
      ctx.moveTo(zeroX, padTop - 2);
      ctx.lineTo(zeroX, height - padBottom + 2);
      ctx.stroke();

      entries.forEach((entry, index) => {
        const centerY = padTop + rowGap * index + rowGap / 2;
        const length = (entry.count / maxValue) * usableWidth;
        const labelX = padLeft - 12;
        ctx.fillStyle = labelColor;
        ctx.textAlign = "right";
        drawPerformanceCanvasLabel(ctx, entry.label, labelX, centerY, width);

        fillRoundedRect(ctx, zeroX, centerY - barHeight / 2, length, barHeight, 8, "rgba(87, 161, 255, 0.86)");
        ctx.fillStyle = "#eaf2ff";
        ctx.textAlign = "left";
        ctx.fillText(String(entry.count), Math.min(zeroX + length + 8, width - padRight - 14), centerY);
      });

      drawStrategyAxisLabels(ctx, {
        left: zeroX,
        right: width - padRight,
        bottom: height - padBottom + 12,
        values: [0, Math.round(maxValue / 2), maxValue],
        formatter: (value) => String(value)
      });
      return;
    }

    const maxAbs = Math.max(...entries.map((entry) => Math.abs(entry.pnl)), 1);
    const zeroX = padLeft + (width - padLeft - padRight) / 2;
    const barWidth = (width - padLeft - padRight) / 2 - 8;

    ctx.strokeStyle = "rgba(132, 156, 214, 0.24)";
    ctx.beginPath();
    ctx.moveTo(zeroX, padTop - 2);
    ctx.lineTo(zeroX, height - padBottom + 2);
    ctx.stroke();

    entries.forEach((entry, index) => {
      const centerY = padTop + rowGap * index + rowGap / 2;
      const labelX = padLeft - 12;
      const amount = entry.pnl;
      const length = (Math.abs(amount) / maxAbs) * barWidth;
      const barX = amount >= 0 ? zeroX : zeroX - length;
      const barColor = amount >= 0 ? "rgba(42, 212, 143, 0.88)" : "rgba(255, 90, 126, 0.9)";

      ctx.fillStyle = labelColor;
      ctx.textAlign = "right";
      drawPerformanceCanvasLabel(ctx, entry.label, labelX, centerY, width);

      fillRoundedRect(ctx, barX, centerY - barHeight / 2, Math.max(length, 2), barHeight, 8, barColor);
    });

    drawStrategyAxisLabels(ctx, {
      left: padLeft,
      right: width - padRight,
      bottom: height - padBottom + 12,
      values: [-maxAbs, 0, maxAbs],
      formatter: formatCompactCurrency
    });
  }

  function drawStrategyAxisLabels(ctx, options) {
    const { left, right, bottom, values, formatter } = options;
    const steps = Math.max(values.length - 1, 1);
    ctx.fillStyle = "rgba(168, 188, 226, 0.72)";
    ctx.font = '500 10px "JetBrains Mono", "Consolas", monospace';
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

  function fillRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
    const safeWidth = Math.max(width, 2);
    const safeHeight = Math.max(height, 2);
    const safeRadius = Math.min(radius, safeHeight / 2, safeWidth / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, safeWidth, safeHeight, safeRadius);
    } else {
      ctx.moveTo(x + safeRadius, y);
      ctx.arcTo(x + safeWidth, y, x + safeWidth, y + safeHeight, safeRadius);
      ctx.arcTo(x + safeWidth, y + safeHeight, x, y + safeHeight, safeRadius);
      ctx.arcTo(x, y + safeHeight, x, y, safeRadius);
      ctx.arcTo(x, y, x + safeWidth, y, safeRadius);
      ctx.closePath();
    }
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function drawRadarChart(canvas, scoreData) {
    const ctxData = getCanvasContext(canvas);
    if (!ctxData) {
      return;
    }

    const { ctx, width, height } = ctxData;
    clearCanvas(ctx, width, height);

    const metrics = Array.isArray(scoreData?.metrics) ? scoreData.metrics : [];
    if (!metrics.length) {
      drawCenteredText(ctx, width, height, "No trader score data yet");
      return;
    }

    const centerX = width / 2;
    const centerY = height / 2 - 6;
    const radius = Math.min(width * 0.24, height * 0.3);
    const steps = 5;
    const angleStep = (Math.PI * 2) / metrics.length;

    ctx.strokeStyle = "rgba(132, 156, 214, 0.2)";
    ctx.lineWidth = 1;
    for (let ring = 1; ring <= steps; ring += 1) {
      const ringRadius = (radius / steps) * ring;
      ctx.beginPath();
      metrics.forEach((_, index) => {
        const angle = -Math.PI / 2 + index * angleStep;
        const x = centerX + Math.cos(angle) * ringRadius;
        const y = centerY + Math.sin(angle) * ringRadius;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.stroke();
    }

    metrics.forEach((metric, index) => {
      const angle = -Math.PI / 2 + index * angleStep;
      const outerX = centerX + Math.cos(angle) * radius;
      const outerY = centerY + Math.sin(angle) * radius;

      ctx.strokeStyle = "rgba(132, 156, 214, 0.26)";
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(outerX, outerY);
      ctx.stroke();

      const labelX = centerX + Math.cos(angle) * (radius + 24);
      const labelY = centerY + Math.sin(angle) * (radius + 22);
      ctx.fillStyle = "#cbdcff";
      ctx.font = "500 12px Sora, Manrope, sans-serif";
      ctx.textAlign = labelX >= centerX + 6 ? "left" : labelX <= centerX - 6 ? "right" : "center";
      ctx.textBaseline = labelY >= centerY ? "top" : "bottom";
      ctx.fillText(metric.label, labelX, labelY);
    });

    ctx.beginPath();
    metrics.forEach((metric, index) => {
      const angle = -Math.PI / 2 + index * angleStep;
      const pointRadius = radius * (clamp(metric.value, 0, 100) / 100);
      const x = centerX + Math.cos(angle) * pointRadius;
      const y = centerY + Math.sin(angle) * pointRadius;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(89, 113, 255, 0.32)";
    ctx.strokeStyle = "#8b8cff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    metrics.forEach((metric, index) => {
      const angle = -Math.PI / 2 + index * angleStep;
      const pointRadius = radius * (clamp(metric.value, 0, 100) / 100);
      const x = centerX + Math.cos(angle) * pointRadius;
      const y = centerY + Math.sin(angle) * pointRadius;
      ctx.beginPath();
      ctx.fillStyle = "#c5ccff";
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function getCanvasContext(canvas) {
    if (!canvas) {
      return null;
    }

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 900;
    const height = Number(canvas.dataset.height || 280);

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width, height };
  }

  function clearCanvas(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
  }

  function drawGrid(ctx, width, height, padX, padTop = padX, padBottom = padTop) {
    ctx.strokeStyle = "rgba(130, 157, 210, 0.2)";
    ctx.lineWidth = 1;
    const chartHeight = height - padTop - padBottom;

    for (let i = 0; i <= 4; i += 1) {
      const y = padTop + (i / 4) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(width - padX, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(130, 157, 210, 0.35)";
    ctx.beginPath();
    ctx.moveTo(padX, height - padBottom);
    ctx.lineTo(width - padX, height - padBottom);
    ctx.stroke();
  }

  function drawCenteredText(ctx, width, height, text) {
    ctx.fillStyle = "#9db0d8";
    ctx.font = "500 12px JetBrains Mono, Consolas, monospace";
    const textWidth = ctx.measureText(text).width;
    ctx.fillText(text, (width - textWidth) / 2, height / 2);
  }

  return {
    renderCharts
  };
}
