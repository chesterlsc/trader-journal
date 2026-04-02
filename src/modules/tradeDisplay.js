import { round } from "../lib/core.js";
import { formatCurrency } from "../lib/format.js";
import { normalizeMarketSymbol } from "./livePrices.js";

const DASH = "\u2014";
const PLUS_MINUS = "\u00B1";
const ARROW = "\u2192";

export function createTradeDisplayHelpers({ state, calculateTradeMetrics }) {
  function formatHeroPrice(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return DASH;
    }

    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4
    }).format(value);
  }

  function formatProgressTradePrice(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return DASH;
    }

    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  function parseIsoDate(value) {
    const date = new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatTradeTimeline(trade) {
    const entry = parseIsoDate(trade.createdAt);
    const exit = trade.status === "open" ? null : parseIsoDate(trade.closedAt || trade.updatedAt);

    if (!entry) {
      return trade.date || DASH;
    }

    const entryDate = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric"
    }).format(entry);
    const entryTime = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(entry);

    if (!exit) {
      return `${entryDate} ${entryTime} ${ARROW} --`;
    }

    const sameDay = entry.toDateString() === exit.toDateString();
    const exitLabel = sameDay
      ? new Intl.DateTimeFormat("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }).format(exit)
      : new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }).format(exit);

    return `${entryDate} ${entryTime} ${ARROW} ${exitLabel}`;
  }

  function parseTradeEntryDate(value) {
    const raw = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return null;
    }

    const [yearText, monthText, dayText] = raw.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatCompactTradeDate(trade) {
    const tradeDate = parseTradeEntryDate(trade.date);
    if (tradeDate) {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric"
      }).format(tradeDate);
    }

    const date = parseIsoDate(trade.createdAt || trade.closedAt || trade.updatedAt);
    if (!date) {
      return trade.date || DASH;
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function formatSignedPips(value) {
    if (!Number.isFinite(value)) {
      return DASH;
    }

    const sign = value > 0 ? "+" : value < 0 ? "-" : PLUS_MINUS;
    return `${sign}${Math.abs(value).toFixed(2)} pips`;
  }

  function getClosedTradeResolution(trade) {
    const exitPrice = Number(trade.exitPrice);
    const takeProfit = Number(trade.takeProfit);
    const stopLoss = Number(trade.stopLoss);

    if (!Number.isFinite(exitPrice)) {
      return null;
    }

    const tolerance = Math.max(Math.abs(exitPrice) * 0.0005, 0.01);

    if (Number.isFinite(takeProfit) && Math.abs(exitPrice - takeProfit) <= tolerance) {
      return {
        type: "tp",
        label: "TP Hit",
        className: "recent-trade-status recent-trade-status-positive"
      };
    }

    if (Number.isFinite(stopLoss) && Math.abs(exitPrice - stopLoss) <= tolerance) {
      return {
        type: "sl",
        label: "SL Hit",
        className: "recent-trade-status recent-trade-status-negative"
      };
    }

    return {
      type: "ts",
      label: "TS",
      className: "recent-trade-status recent-trade-status-trail"
    };
  }

  function getRecentTradeRowSortValue(trade) {
    const tradeDate = String(trade?.date || "").trim();
    if (tradeDate) {
      return `${tradeDate}T${String(trade?.createdAt || trade?.updatedAt || "").slice(11, 19) || "00:00:00"}`;
    }

    return String(trade?.createdAt || trade?.updatedAt || "");
  }

  function sortRecentTradeRowsDesc(a, b) {
    return getRecentTradeRowSortValue(b).localeCompare(getRecentTradeRowSortValue(a));
  }

  function sortRecentTradeRowsAsc(a, b) {
    return getRecentTradeRowSortValue(a).localeCompare(getRecentTradeRowSortValue(b));
  }

  function getClosedTradeToneClass(trade, resolution = getClosedTradeResolution(trade)) {
    if (resolution?.type === "tp") {
      return "recent-trade-row-public-positive";
    }

    if (resolution?.type === "sl") {
      return "recent-trade-row-public-negative";
    }

    if (Number(trade.netPnl) > 0 || String(trade.result || "").toLowerCase() === "win") {
      return "recent-trade-row-public-positive";
    }

    if (Number(trade.netPnl) < 0 || String(trade.result || "").toLowerCase() === "loss") {
      return "recent-trade-row-public-negative";
    }

    return "recent-trade-row-public-neutral";
  }

  function getLivePriceForSymbol(symbol) {
    const normalized = normalizeMarketSymbol(symbol);
    if (!normalized) {
      return null;
    }

    const price = state.marketData.currentPrices[normalized];
    return Number.isFinite(price) && price > 0 ? price : null;
  }

  function getOpenTradeLiveSnapshot(trade) {
    if (!trade || trade.status !== "open") {
      return null;
    }

    const currentPrice = getLivePriceForSymbol(trade.asset);
    const entryPrice = Number(trade.entryPrice);
    if (!Number.isFinite(currentPrice) || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return null;
    }

    const isSell = String(trade.direction || "").toLowerCase() === "sell";
    const livePercent = round(
      isSell
        ? ((entryPrice - currentPrice) / entryPrice) * 100
        : ((currentPrice - entryPrice) / entryPrice) * 100
    );
    const priceMove = round(currentPrice - entryPrice);
    const metrics = calculateTradeMetrics({
      ...trade,
      exitPrice: currentPrice
    });

    return {
      currentPrice,
      livePercent,
      priceMove,
      dollarPnl: Number.isFinite(metrics.netPnl) ? metrics.netPnl : null,
      pips: Number.isFinite(metrics.pips) ? metrics.pips : null,
      toneClass: getLiveToneClass(livePercent)
    };
  }

  function getOpenTradePnlPercent(trade) {
    return getOpenTradeLiveSnapshot(trade)?.livePercent ?? null;
  }

  function getOpenTradePriceMove(trade) {
    return getOpenTradeLiveSnapshot(trade)?.priceMove ?? null;
  }

  function getLiveToneClass(value) {
    if (!Number.isFinite(value) || value === 0) {
      return "";
    }

    return value > 0 ? "pnl-positive" : "pnl-negative";
  }

  function formatSignedPercent(value) {
    if (!Number.isFinite(value)) {
      return DASH;
    }

    const sign = value > 0 ? "+" : value < 0 ? "-" : PLUS_MINUS;
    return `${sign}${Math.abs(value).toFixed(2)}%`;
  }

  function formatPriceMove(value) {
    if (!Number.isFinite(value)) {
      return DASH;
    }

    const sign = value > 0 ? "+" : value < 0 ? "-" : PLUS_MINUS;
    return `${sign}${formatProgressTradePrice(Math.abs(value))}`;
  }

  function formatSignedCurrency(value) {
    if (!Number.isFinite(value)) {
      return DASH;
    }

    const sign = value > 0 ? "+" : value < 0 ? "-" : PLUS_MINUS;
    return `${sign}${formatCurrency(Math.abs(value))}`;
  }

  function formatLivePercentLabel(value, fallback = "OPEN") {
    return Number.isFinite(value) ? formatSignedPercent(value) : fallback;
  }

  function formatRecentTradeStatus(trade) {
    if (trade.status === "open") {
      return formatLivePercentLabel(getOpenTradePnlPercent(trade), "OPEN");
    }
    return formatCurrency(trade.netPnl);
  }

  function getRecentTradeStatusClass(trade) {
    if (trade.status !== "open") {
      return trade.netPnl > 0
        ? "recent-trade-status recent-trade-status-positive"
        : trade.netPnl < 0
          ? "recent-trade-status recent-trade-status-negative"
          : "recent-trade-status recent-trade-status-flat";
    }

    const livePercent = getOpenTradePnlPercent(trade);
    if (!Number.isFinite(livePercent)) {
      return "recent-trade-status recent-trade-status-open";
    }

    const toneClass = getLiveToneClass(livePercent);
    if (toneClass) {
      return `recent-trade-status ${toneClass === "pnl-positive" ? "recent-trade-status-positive" : "recent-trade-status-negative"}`;
    }

    return "recent-trade-status recent-trade-status-flat";
  }

  return {
    formatHeroPrice,
    formatProgressTradePrice,
    formatTradeTimeline,
    formatCompactTradeDate,
    formatRecentTradeStatus,
    getClosedTradeResolution,
    parseTradeEntryDate,
    formatSignedPips,
    sortRecentTradeRowsDesc,
    sortRecentTradeRowsAsc,
    getClosedTradeToneClass,
    getRecentTradeStatusClass,
    getOpenTradePnlPercent,
    getOpenTradePriceMove,
    getOpenTradeLiveSnapshot,
    getLiveToneClass,
    formatSignedPercent,
    formatPriceMove,
    formatSignedCurrency,
    formatLivePercentLabel,
    parseIsoDate
  };
}
