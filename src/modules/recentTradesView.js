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
    const source = getRecentTradesSource();
    // Open positions lead the tape — they are the live part — then closed.
    const openTrades = source.filter((trade) => trade.status === "open");
    const closedTrades = source.filter((trade) => trade.status !== "open");
    const rows = [...openTrades, ...closedTrades];

    ui.recentTradesList.innerHTML = rows.length
      ? rows.slice(0, TAPE_ROW_LIMIT).map(renderTapeRow).join("")
      : `<p class="lnd-tape-empty">${
          isOwnJournal ? "No trades in this journal yet." : "No trades on Leon\u2019s feed yet."
        }</p>`;

    if (ui.lndTapeNote) {
      ui.lndTapeNote.textContent = isOwnJournal
        ? "Raised rows made money. Sunk rows lost it. These are trades from the journal open in this browser."
        : "Raised rows made money. Sunk rows lost it. Open positions ride on top. Nothing here is a mock-up — it is Leon\u2019s public feed, straight from his real journal.";
    }

    renderTapeWeekCount(rows);
  }

  // The mockup's "1,284 trades journalled this week" has no backend counter
  // behind it. This counts the rows actually on the tape — nothing else — and
  // says so in the label. Hidden at zero rather than printing "0".
  function renderTapeWeekCount(tapeRows) {
    if (!ui.lndTapeCount || !ui.lndTapeCountText) {
      return;
    }

    const cutoff = Date.now() - WEEK_MS;
    const count = tapeRows.filter((trade) => {
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
    const outcome = trade.status === "open" ? { key: "open", label: "Open" } : getTradeOutcome(trade);
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

  /* Dashboard Leon tape: strictly the PUBLIC feed — never the own-journal
     fallback the landing uses, or a logged-in user's rows would be captioned
     as Leon's. Open rows lead (they are the "live" part), then closed. Rows
     are static divs, not buttons: Leon's entries are not links into this
     user's journal. */
  function renderDashLeonTape() {
    if (!ui.dashLeonTape || !ui.dashLeonTapeList) {
      return;
    }

    const rows = Array.isArray(state.publicRecentTrades) ? state.publicRecentTrades : [];
    ui.dashLeonTape.hidden = rows.length === 0;
    if (!rows.length) {
      ui.dashLeonTapeList.innerHTML = "";
      return;
    }

    const open = rows.filter((trade) => trade.status === "open");
    const closed = rows.filter((trade) => trade.status !== "open");
    ui.dashLeonTapeList.innerHTML = [...open, ...closed]
      .slice(0, TAPE_ROW_LIMIT)
      .map((trade, order) => renderLeonRow(trade, order))
      .join("");
  }

  function renderLeonRow(trade, order) {
    const isSell = String(trade.direction || "").toLowerCase() === "sell";
    const isOpen = trade.status === "open";
    const outcome = isOpen ? { key: "open", label: "Open" } : getTradeOutcome(trade);
    const meta = `${isSell ? "Short" : "Long"} · ${formatCompactTradeDate(trade)}`;

    return `
      <div class="lnd-row is-${outcome.key}" style="--row-order:${Number(order)};">
        <span class="lnd-row-symbol">${escapeHtml(trade.asset)}</span>
        <span class="lnd-row-meta">${escapeHtml(meta)}</span>
        <span class="lnd-row-result">${outcome.label}</span>
      </div>
    `;
  }

  return {
    renderHeroRecentTrades,
    renderDashLeonTape,
    handleRecentTradesClick,
    normalizeRecentTrades
  };
}
