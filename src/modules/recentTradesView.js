import { ensureNumber, ensurePositiveNumber, escapeHtml, sortTradesDesc } from "../lib/core.js";

export function createRecentTradesView(deps) {
  const {
    state,
    ui,
    canAccessApp,
    switchView,
    setAuthIntent,
    syncLandingExpandedLayout,
    isMobileViewport,
    formatCompactTradeDate,
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
        title: "Open Positions",
        trades: openTrades,
        emptyLabel: "No in progress trades yet.",
        sectionOrder: 0,
        showLiveTag: true
      }),
      renderTradeFeedSection({
        key: "closed",
        title: "Closed Trades",
        trades: closedTrades,
        emptyLabel: "No closed trades yet.",
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

  function renderTradeFeedSection({ key, title, trades, emptyLabel, sectionOrder = 0, showLiveTag = false }) {
    const expanded = key === "closed" ? state.landingFeed.closedExpanded : state.landingFeed.openExpanded;
    const firstTrade = trades[0];
    const remainingTrades = trades.slice(1, 10);
    const canExpand = remainingTrades.length > 0;

    return `
      <section class="recent-trades-card recent-trades-card-${escapeHtml(key)}" aria-label="${escapeHtml(title)}" style="--trade-section-order:${Number(sectionOrder)};">
        <div class="recent-trades-header">
          <p class="recent-trades-label">${escapeHtml(title)}</p>
          <div class="recent-trades-header-actions">
            ${showLiveTag ? '<span class="recent-trades-live-tag">Live Feed &middot; Delayed</span>' : ""}
            ${canExpand ? `<button class="recent-trades-toggle" type="button" data-trade-feed-toggle="${escapeHtml(key)}">${expanded ? "Hide Trades" : "Show Trades"}</button>` : ""}
          </div>
        </div>
        <div class="recent-trades-list">
          ${firstTrade ? renderTradeTapeRow(firstTrade, 0) : `<p class="recent-trade-empty">${escapeHtml(emptyLabel)}</p>`}
        </div>
        ${expanded && remainingTrades.length ? `<div class="recent-trades-list recent-trades-list-expanded">${remainingTrades.map((trade, index) => renderTradeTapeRow(trade, index + 1)).join("")}</div>` : ""}
      </section>
    `;
  }

  // Result comes from the whitelisted public feed (win/loss/flat) or, for an
  // authenticated preview of own trades, from the stored netPnl sign.
  function renderTradeResultBadge(trade) {
    if (trade.status === "open") {
      return '<span class="recent-trade-status recent-trade-status-open"><span class="live-pulse-dot" aria-hidden="true"></span>Open</span>';
    }

    const result = String(trade.result || "").toLowerCase();
    if (result === "win" || (result !== "loss" && ensureNumber(trade.netPnl, 0) > 0)) {
      return '<span class="recent-trade-status recent-trade-status-positive">Win</span>';
    }

    if (result === "loss" || ensureNumber(trade.netPnl, 0) < 0) {
      return '<span class="recent-trade-status recent-trade-status-negative">Loss</span>';
    }

    return '<span class="recent-trade-status recent-trade-status-flat">Flat</span>';
  }

  // Terminal tape row: symbol | direction | result | date. The public feed is
  // whitelisted to those fields — no prices or P&L leave the server.
  function renderTradeTapeRow(trade, cardOrder = 0) {
    const isSell = String(trade.direction || "").toLowerCase() === "sell";
    return `
      <button class="recent-trade-row" type="button" data-trade-id="${escapeHtml(String(trade.id || ""))}" style="--trade-row-order:${Number(cardOrder)};">
        <span class="recent-trade-symbol">${escapeHtml(trade.asset)}</span>
        <span class="recent-trade-direction ${isSell ? "recent-trade-direction-sell" : "recent-trade-direction-buy"}">${isSell ? "Short" : "Long"}</span>
        ${renderTradeResultBadge(trade)}
        <span class="recent-trade-time">${escapeHtml(formatCompactTradeDate(trade))}</span>
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
        result: String(item.result || ""),
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
