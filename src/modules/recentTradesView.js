import { ensureNumber, ensurePositiveNumber, escapeHtml, sortTradesDesc } from "../lib/core.js";

const DASH = "\u2014";
const PLUS_MINUS = "\u00B1";

export function createRecentTradesView(deps) {
  const {
    state,
    ui,
    canAccessApp,
    switchView,
    setAuthIntent,
    syncLandingExpandedLayout,
    isMobileViewport,
    getClosedTradeResolution,
    getClosedTradeToneClass,
    getOpenTradeLiveSnapshot,
    getLiveToneClass,
    formatProgressTradePrice,
    formatCompactTradeDate,
    formatSignedPips,
    sortRecentTradeRowsDesc
  } = deps;

  function renderHeroRecentTrades() {
    if (!ui.recentTradesList) {
      return;
    }

    const trades = getRecentTradesSource();
    if (!trades.length) {
      ui.recentTradesList.innerHTML = '<p class="recent-trade-empty">No trades yet.</p>';
      if (ui.landingScrollHint) {
        ui.landingScrollHint.style.display = "none";
      }
      syncLandingExpandedLayout();
      return;
    }

    const closedTrades = trades.filter((trade) => trade.status !== "open").slice(0, 10);
    const openTrades = trades.filter((trade) => trade.status === "open").slice(0, 10);

    ui.recentTradesList.innerHTML = [
      renderTradeFeedSection({
        key: "open",
        title: "Public In Progress Trades",
        trades: openTrades,
        emptyLabel: "No in progress trades yet.",
        renderer: renderOpenTradeFeedCard,
        sectionOrder: 0
      }),
      renderTradeFeedSection({
        key: "closed",
        title: "Public Closed Trades",
        trades: closedTrades,
        emptyLabel: "No closed trades yet.",
        renderer: renderClosedTradeFeedCard,
        sectionOrder: 1
      })
    ].join("");

    if (ui.landingScrollHint) {
      const hasHiddenMobileContent = isMobileViewport() && closedTrades.length > 0;
      ui.landingScrollHint.style.display = hasHiddenMobileContent ? "" : "none";
      ui.landingScrollHint.classList.toggle("is-open", ui.recentTradesList.classList.contains("is-preview-expanded"));
      const labelNode = ui.landingScrollHint.querySelector(".landing-scroll-hint-label");
      if (labelNode) {
        labelNode.textContent = ui.recentTradesList.classList.contains("is-preview-expanded") ? "Hide trades" : "View trades";
      }
    }

    syncLandingExpandedLayout();
  }

  function handleRecentTradesClick(event) {
    const toggle = event.target.closest("[data-trade-feed-toggle]");
    if (toggle) {
      const key = String(toggle.dataset.tradeFeedToggle || "");
      if (key === "closed" || key === "open") {
        const stateKey = key === "closed" ? "closedExpanded" : "openExpanded";
        state.landingFeed[stateKey] = !state.landingFeed[stateKey];
        renderHeroRecentTrades();
      }
      return;
    }

    const row = event.target.closest("[data-trade-id]");
    if (!row) {
      return;
    }

    if (canAccessApp()) {
      switchView("journal");
      return;
    }

    setAuthIntent("login", { focus: true });
  }

  function getRecentTradesSource() {
    if (canAccessApp() && Array.isArray(state.trades) && state.trades.length > 0) {
      return [...state.trades].sort(sortTradesDesc);
    }

    if (!canAccessApp() && Array.isArray(state.publicRecentTrades) && state.publicRecentTrades.length > 0) {
      return [...state.publicRecentTrades].sort(sortTradesDesc);
    }

    return canAccessApp() && Array.isArray(state.recentTrades) ? [...state.recentTrades].sort(sortTradesDesc) : [];
  }

  function renderTradeFeedSection({ key, title, trades, emptyLabel, renderer, sectionOrder = 0 }) {
    const expanded = key === "closed" ? state.landingFeed.closedExpanded : state.landingFeed.openExpanded;
    const firstTrade = trades[0];
    const remainingTrades = trades.slice(1, 10);
    const canExpand = remainingTrades.length > 0;

    return `
      <section class="recent-trades-card recent-trades-card-${escapeHtml(key)}" aria-label="${escapeHtml(title)}" style="--trade-section-order:${Number(sectionOrder)};">
        <div class="recent-trades-header">
          <p class="recent-trades-label">${escapeHtml(title)}</p>
          ${canExpand ? `<button class="recent-trades-toggle" type="button" data-trade-feed-toggle="${escapeHtml(key)}">${expanded ? "Hide Trades" : "Show Trades"}</button>` : ""}
        </div>
        <div class="recent-trades-list">
          ${firstTrade ? renderer(firstTrade, 0) : `<p class="recent-trade-empty">${escapeHtml(emptyLabel)}</p>`}
        </div>
        ${expanded && remainingTrades.length ? `<div class="recent-trades-list recent-trades-list-expanded">${remainingTrades.map((trade, index) => renderer(trade, index + 1)).join("")}</div>` : ""}
      </section>
    `;
  }

  function renderTradeVerifiedPill() {
    return `
      <div class="recent-trades-verified recent-trades-verified-card" aria-label="Verified Vantage trades">
        <span class="recent-trades-verified-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M12 1.8 14.74 4l3.49-.27 1.34 3.24 3.05 1.72-.81 3.4.81 3.4-3.05 1.72-1.34 3.24-3.49-.27L12 22.2l-2.74-2.2-3.49.27-1.34-3.24-3.05-1.72.81-3.4-.81-3.4 3.05-1.72L5.77 3.73 9.26 4 12 1.8Z" />
            <path d="m7.8 12.3 2.64 2.64L16.8 8.58" />
          </svg>
        </span>
        <span class="recent-trades-verified-copy">
          <strong>Verified</strong>
          <span>Vantage Trades</span>
        </span>
      </div>
    `;
  }

  function renderClosedTradeFeedCard(trade, cardOrder = 0) {
    const directionClass = trade.direction === "Sell" ? "recent-trade-direction recent-trade-direction-sell" : "recent-trade-direction recent-trade-direction-buy";
    const resolution = getClosedTradeResolution(trade);
    const rowToneClass = getClosedTradeToneClass(trade, resolution);
    const tpCellClass = resolution?.type === "tp" ? "recent-trade-price-cell recent-trade-price-cell-positive" : "recent-trade-price-cell";
    const slCellClass = resolution?.type === "sl" ? "recent-trade-price-cell recent-trade-price-cell-negative" : "recent-trade-price-cell";
    const closedPips = ensureNumber(trade.pips, NaN);
    const closedPipsTone = getLiveToneClass(closedPips);
    const closedPipsText = formatSignedPips(closedPips);
    const exitCellClass = rowToneClass === "recent-trade-row-public-positive"
      ? "recent-trade-price-cell recent-trade-price-cell-positive"
      : rowToneClass === "recent-trade-row-public-negative"
        ? "recent-trade-price-cell recent-trade-price-cell-negative"
        : "recent-trade-price-cell";
    return `
      <button class="recent-trade-row recent-trade-row-public ${rowToneClass}" type="button" data-trade-id="${escapeHtml(trade.id)}" style="--trade-row-order:${Number(cardOrder)};">
        <div class="recent-trade-main">
          <div class="recent-trade-top">
            <strong class="recent-trade-symbol">${escapeHtml(trade.asset)}</strong>
            <span class="${directionClass}">${escapeHtml(trade.direction)}</span>
            ${resolution ? `<span class="${escapeHtml(resolution.className)}">${escapeHtml(resolution.label)}</span>` : ""}
            ${renderTradeVerifiedPill()}
          </div>
          <div class="recent-trade-prices recent-trade-prices-public">
            <span class="recent-trade-price-cell"><em>Entry</em><strong>${formatProgressTradePrice(trade.entryPrice)}</strong></span>
            <span class="${slCellClass}"><em>SL</em><strong>${formatProgressTradePrice(trade.stopLoss)}</strong></span>
            <span class="${tpCellClass}"><em>TP</em><strong>${formatProgressTradePrice(trade.takeProfit)}</strong></span>
            <span class="${exitCellClass}"><em>Exit</em><strong>${formatProgressTradePrice(trade.exitPrice)}</strong></span>
          </div>
          <div class="recent-trade-foot">
            <div class="recent-trade-time">${escapeHtml(formatCompactTradeDate(trade))}</div>
            <div class="recent-trade-pips ${closedPipsTone}">${escapeHtml(closedPipsText)}</div>
          </div>
        </div>
      </button>
    `;
  }

  function renderOpenTradeFeedCard(trade, cardOrder = 0) {
    const directionClass = trade.direction === "Sell" ? "recent-trade-direction recent-trade-direction-sell" : "recent-trade-direction recent-trade-direction-buy";
    const liveSnapshot = getOpenTradeLiveSnapshot(trade);
    const currentPrice = liveSnapshot?.currentPrice ?? null;
    const livePips = liveSnapshot?.pips ?? null;
    const pipsTone = getLiveToneClass(livePips);
    const pipsText = Number.isFinite(livePips) ? `${livePips > 0 ? "+" : livePips < 0 ? "-" : PLUS_MINUS}${Math.abs(livePips).toFixed(2)} pips` : "OPEN";
    const rowToneClass = pipsTone === "pnl-positive"
      ? "recent-trade-row-public-positive"
      : pipsTone === "pnl-negative"
        ? "recent-trade-row-public-negative"
        : "recent-trade-row-public-neutral";
    const currentCellClass = pipsTone === "pnl-positive"
      ? "recent-trade-price-cell recent-trade-price-cell-positive"
      : pipsTone === "pnl-negative"
        ? "recent-trade-price-cell recent-trade-price-cell-negative"
        : "recent-trade-price-cell";

    return `
      <button class="recent-trade-row recent-trade-row-public ${rowToneClass}" type="button" data-trade-id="${escapeHtml(trade.id)}" style="--trade-row-order:${Number(cardOrder)};">
        <div class="recent-trade-main">
          <div class="recent-trade-top">
            <strong class="recent-trade-symbol">${escapeHtml(trade.asset)}</strong>
            <span class="${directionClass}">${escapeHtml(trade.direction)}</span>
            <span class="recent-trade-status recent-trade-status-open">OPEN</span>
            ${renderTradeVerifiedPill()}
          </div>
          <div class="recent-trade-prices recent-trade-prices-public">
            <span class="recent-trade-price-cell"><em>Entry</em><strong>${formatProgressTradePrice(trade.entryPrice)}</strong></span>
            <span class="recent-trade-price-cell"><em>SL</em><strong>${formatProgressTradePrice(trade.stopLoss)}</strong></span>
            <span class="recent-trade-price-cell"><em>TP</em><strong>${formatProgressTradePrice(trade.takeProfit)}</strong></span>
            <span class="${currentCellClass}"><em>Current</em><strong>${Number.isFinite(currentPrice) ? formatProgressTradePrice(currentPrice) : DASH}</strong></span>
          </div>
          <div class="recent-trade-foot">
            <div class="recent-trade-time">${escapeHtml(formatCompactTradeDate(trade))}</div>
            <div class="recent-trade-pips ${pipsTone}">${escapeHtml(pipsText)}</div>
          </div>
        </div>
      </button>
    `;
  }

  function normalizeRecentTrades(input) {
    if (!Array.isArray(input)) {
      return [];
    }

    return input
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id || ""),
        asset: String(item.symbol || item.asset || "UNKNOWN"),
        date: String(item.date || ""),
        direction: String(item.direction || "Buy"),
        entryPrice: ensurePositiveNumber(item.entry_price ?? item.entryPrice, 0),
        stopLoss: ensurePositiveNumber(item.stop_loss ?? item.stopLoss, 0),
        takeProfit: ensurePositiveNumber(item.take_profit ?? item.takeProfit, 0),
        exitPrice: ensurePositiveNumber(item.exit_price ?? item.exitPrice, 0),
        status: item.status === "open" ? "open" : "closed",
        netPnl: ensureNumber(item.profit_loss ?? item.profitLoss, 0),
        pips: ensureNumber(item.pips, 0),
        createdAt: String(item.created_at || item.createdAt || ""),
        closedAt: String(item.closed_at || item.closedAt || ""),
        updatedAt: String(item.closed_at || item.closedAt || item.created_at || item.createdAt || "")
      }))
      .sort(sortRecentTradeRowsDesc);
  }

  return {
    renderHeroRecentTrades,
    handleRecentTradesClick,
    normalizeRecentTrades
  };
}
