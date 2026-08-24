import { ensureNumber, ensurePositiveNumber, escapeHtml, normalizeDirection, sortTradesDesc } from "../lib/core.js";

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
    sortRecentTradeRowsDesc,
    formatTapePrice,
    tapePips
  } = deps;

  /* Second line of a tape row: E / SL / TP with pip distances. The feed
     owner publishes these deliberately; rows without prices (older cached
     feeds, other sources) render exactly as before — no zeros invented. */
  function renderTapePrices(trade) {
    if (!(trade.entryPrice > 0) || typeof formatTapePrice !== "function") {
      return "";
    }
    const cells = [`<span class="lnd-row-pcell"><span class="lnd-row-plabel">E</span>${formatTapePrice(trade.entryPrice)}</span>`];
    [["SL", trade.stopLoss], ["TP", trade.takeProfit]].forEach(([label, price]) => {
      if (!(price > 0)) {
        return;
      }
      const pips = typeof tapePips === "function" ? tapePips(trade, price) : null;
      const tail = pips !== null && Number.isFinite(pips) ? ` · ${Math.round(pips * 10) / 10}p` : "";
      cells.push(`<span class="lnd-row-pcell"><span class="lnd-row-plabel">${label}</span>${formatTapePrice(price)}${tail}</span>`);
    });
    return `<span class="lnd-row-prices">${cells.join("")}</span>`;
  }

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
        : "Raised rows made money. Sunk rows lost it. Open positions ride on top. Nothing here is a mock-up. It is Leon\u2019s public feed, straight from his real journal.";
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

  // TWO KINDS OF PROVENANCE, and the difference is the point.
  //
  // A row a BROKER EXPORT produced wears the blue check: the fills, prices and
  // sizes came out of TopstepX, so the numbers are not this trader's word.
  // The label names the source rather than saying "verified" on its own,
  // because what is verified is WHERE IT CAME FROM.
  //
  // A row the trader JOURNALLED THEMSELVES wears a quieter pen mark. It is
  // still their real record, and the tape says so, but it is self reported
  // and must never borrow the check that means a broker file said it.
  function renderTapeMark(trade) {
    if (String(trade.importSource || "").toLowerCase().startsWith("topstepx")) {
      return `<span class="lnd-row-mark is-broker" title="From a TopstepX export: fills, prices and sizes came from the broker">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path class="lnd-row-mark-disc" d="M12 1.5l2.6 2 3.2-.3 1 3.1 2.7 1.8-1.2 3 1.2 3-2.7 1.8-1 3.1-3.2-.3-2.6 2-2.6-2-3.2.3-1-3.1L2.5 15l1.2-3-1.2-3 2.7-1.8 1-3.1 3.2.3z"/>
            <path class="lnd-row-mark-tick" d="M8.2 12.3l2.6 2.6 5-5.2"/>
          </svg>
          <i>Topstep import</i>
          <span class="visually-hidden">Verified from a TopstepX broker export</span>
        </span>`;
    }
    return `<span class="lnd-row-mark is-self" title="Journalled by hand in Trader Journal">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path class="lnd-row-mark-pen" d="M4.5 19.5l1-3.6L15.2 6.2l2.6 2.6-9.7 9.7z"/>
          <path class="lnd-row-mark-pen" d="M14.9 4.4l2.1-2.1 4.7 4.7-2.1 2.1"/>
        </svg>
        <i>Journalled</i>
        <span class="visually-hidden">Journalled by hand</span>
      </span>`;
  }

  /* ONE row, two surfaces. The website's hero tape and the app's Leon panel
     render the same four children from the same data; they differed only in
     the wrapper — a <button> that opens the trade on the landing, an inert
     <div> on the dashboard where there is nothing to open. That is a single
     branch, not a reason for a second template, and keeping two meant every
     change to a tape row was a change in two places.

     interactive is the surface switch: true for the website's clickable rows
     (handleRecentTradesClick reads data-trade-id), false for the app's. */
  function renderTapeRow(trade, order = 0, { interactive = true } = {}) {
    // Same predicate as the review queue, for the same reason: a literal
    // === "sell" misses "Short", "S" and untrimmed values, and prints the WRONG
    // SIDE for each. This tape is on the public landing page.
    const isSell = normalizeDirection(trade.direction) === "Sell";
    const outcome = trade.status === "open" ? { key: "open", label: "Open" } : getTradeOutcome(trade);
    const meta = `${isSell ? "Short" : "Long"} · ${formatCompactTradeDate(trade)}`;
    const tag = interactive ? "button" : "div";
    const attrs = interactive
      ? ` type="button" data-trade-id="${escapeHtml(String(trade.id || ""))}"`
      : "";

    return `
      <${tag} class="lnd-row is-${outcome.key}"${attrs} style="--row-order:${Number(order)};">
        <span class="lnd-row-symbol">${escapeHtml(trade.asset)}${renderTapeMark(trade)}</span>
        <span class="lnd-row-meta">${escapeHtml(meta)}</span>
        <span class="lnd-row-result">${outcome.label}</span>
        ${renderTapePrices(trade)}
      </${tag}>
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
        importSource: String(item.import_source ?? item.importSource ?? ""),
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
      .map((trade, order) => renderTapeRow(trade, order, { interactive: false }))
      .join("");
  }

  return {
    renderHeroRecentTrades,
    renderDashLeonTape,
    handleRecentTradesClick,
    normalizeRecentTrades
  };
}
