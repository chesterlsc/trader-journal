import { ensureNumber, ensurePositiveNumber, escapeHtml, sortTradesDesc } from "../lib/core.js";

/* 1d landing — the live tape.
   One row per CLOSED trade, no sections, no Show/Hide. The public feed is
   whitelisted server-side to symbol / direction / status / result / date
   (trade_handler.php `public_recent_trades`), so a row can only ever print
   what is in that whitelist — no prices, sizes, R-multiples or P&L. The
   mockup's "+2.4R" column is therefore not rendered: it cannot be produced
   truthfully for a logged-out visitor.

   Depth as data (clay-v2 §5): a winning row is RAISED, a losing row is
   SUNK. Colour and the result word carry the same state so depth is never
   the only signal (WCAG 1.4.1). */

const TAPE_ROW_LIMIT = 7;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function createRecentTradesView(deps) {
  const {
    state,
    ui,
    canAccessApp,
    switchView,
    setAuthIntent,
    formatCompactTradeDate,
    sortRecentTradeRowsDesc
  } = deps;

  function renderHeroRecentTrades() {
    if (!ui.recentTradesList) {
      return;
    }

    // Demo, local preview and an authenticated session all read the tape off
    // the journal in this browser, not the public feed — the caption has to
    // say which, or the landing claims someone else's rows as public ones.
    const isOwnJournal = canAccessApp();
    const closedTrades = getRecentTradesSource().filter((trade) => trade.status !== "open");

    ui.recentTradesList.innerHTML = closedTrades.length
      ? closedTrades.slice(0, TAPE_ROW_LIMIT).map(renderTapeRow).join("")
      : `<p class="lnd-tape-empty">${
          isOwnJournal ? "No closed trades in this journal yet." : "No closed trades on the public feed yet."
        }</p>`;

    if (ui.lndTapeNote) {
      ui.lndTapeNote.textContent = isOwnJournal
        ? "Raised rows made money. Sunk rows lost it. These are closed trades from the journal open in this browser."
        : "Raised rows made money. Sunk rows lost it. Nothing here is a mock-up — it is the public feed, one row per closed trade.";
    }

    renderTapeWeekCount(closedTrades);
  }

  // The mockup's "1,284 trades journalled this week" has no backend counter
  // behind it. This counts the rows actually on the tape — nothing else — and
  // says so in the label. Hidden at zero rather than printing "0".
  function renderTapeWeekCount(closedTrades) {
    if (!ui.lndTapeCount || !ui.lndTapeCountText) {
      return;
    }

    const cutoff = Date.now() - WEEK_MS;
    const count = closedTrades.filter((trade) => {
      const stamp = Date.parse(trade.closedAt || trade.date || "");
      return Number.isFinite(stamp) && stamp >= cutoff;
    }).length;

    ui.lndTapeCount.hidden = count === 0;
    ui.lndTapeCountText.textContent = `${count} ${count === 1 ? "trade" : "trades"} on the tape this week`;
  }

  function handleRecentTradesClick(event) {
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

  // Result comes from the whitelisted public feed (win/loss/flat) or, for an
  // authenticated preview of own trades, from the stored netPnl sign.
  function getTradeOutcome(trade) {
    const result = String(trade.result || "").toLowerCase();
    if (result === "win" || (result !== "loss" && result !== "flat" && ensureNumber(trade.netPnl, 0) > 0)) {
      return { key: "win", label: "Win" };
    }
    if (result === "loss" || ensureNumber(trade.netPnl, 0) < 0) {
      return { key: "loss", label: "Loss" };
    }
    return { key: "flat", label: "Flat" };
  }

  function renderTapeRow(trade, order = 0) {
    const isSell = String(trade.direction || "").toLowerCase() === "sell";
    const outcome = getTradeOutcome(trade);
    const meta = `${isSell ? "Short" : "Long"} · ${formatCompactTradeDate(trade)}`;

    return `
      <button class="lnd-row is-${outcome.key}" type="button" data-trade-id="${escapeHtml(String(trade.id || ""))}" style="--row-order:${Number(order)};">
        <span class="lnd-row-symbol">${escapeHtml(trade.asset)}</span>
        <span class="lnd-row-meta">${escapeHtml(meta)}</span>
        <span class="lnd-row-result">${outcome.label}</span>
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
