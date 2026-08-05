// Drives the REAL 1d landing tape (src/modules/recentTradesView.js) with stub
// deps. Two things here can rot silently and both are honesty bugs, not
// cosmetic ones:
//   1. the "N trades on the tape this week" badge must count ONLY the rows on
//      the tape inside a real 7-day window — the mockup's 1,284 is a number the
//      app has no backend for, and a broken window would quietly invent one;
//   2. the caption must never call a demo/preview journal "the public feed".
// The depth rule is checked too: raised/sunk is only legal because the result
// WORD ships with it (WCAG 1.4.1).
// Run: node tests/landingTape.check.mjs
import assert from "node:assert/strict";
import { createRecentTradesView } from "../src/modules/recentTradesView.js";

const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

function harness({ trades, canAccess = false }) {
  const ui = {
    recentTradesList: { innerHTML: "" },
    lndTapeCount: { hidden: null },
    lndTapeCountText: { textContent: "" },
    lndTapeNote: { textContent: "" }
  };
  const state = { trades: [], publicRecentTrades: trades, recentTrades: [] };
  if (canAccess) {
    state.trades = trades;
    state.publicRecentTrades = [];
  }
  const view = createRecentTradesView({
    state,
    ui,
    canAccessApp: () => canAccess,
    switchView: () => {},
    setAuthIntent: () => {},
    formatCompactTradeDate: (trade) => trade.date,
    sortRecentTradeRowsDesc: () => 0
  });
  view.renderHeroRecentTrades();
  return { ui, view };
}

const row = (over) => ({ id: "t", asset: "BTCUSDT", direction: "Buy", status: "closed", result: "win", netPnl: 1, date: iso(1), closedAt: "", ...over });

// 1. Open positions never reach the tape — the mockup is one row per CLOSED trade.
{
  const { ui } = harness({
    trades: [row({ id: "a" }), row({ id: "b", status: "open", result: "" })]
  });
  assert.equal((ui.recentTradesList.innerHTML.match(/class="lnd-row is-/g) || []).length, 1, "open trade leaked onto the tape");
}

// 2. Depth as data — and the result WORD travels with it, in every case.
{
  const { ui } = harness({
    trades: [
      row({ id: "w", result: "win" }),
      row({ id: "l", result: "loss", netPnl: -1 }),
      row({ id: "f", result: "flat", netPnl: 0 })
    ]
  });
  const html = ui.recentTradesList.innerHTML;
  for (const [cls, word] of [["is-win", "Win"], ["is-loss", "Loss"], ["is-flat", "Flat"]]) {
    assert.ok(html.includes(`lnd-row ${cls}`), `missing depth class ${cls}`);
    assert.ok(html.includes(`>${word}</span>`), `depth class ${cls} shipped without its word`);
  }
}

// 2b. Own-journal rows carry no `result` string — the sign of netPnl decides.
{
  const { ui } = harness({
    trades: [row({ id: "p", result: "", netPnl: 42 }), row({ id: "n", result: "", netPnl: -42 })],
    canAccess: true
  });
  assert.ok(ui.recentTradesList.innerHTML.includes("lnd-row is-win"), "positive netPnl did not read as a win");
  assert.ok(ui.recentTradesList.innerHTML.includes("lnd-row is-loss"), "negative netPnl did not read as a loss");
}

// 3. The tape is capped, but the counter counts the WHOLE feed it was given —
//    it says "on the tape this week", so it must not silently mean "of 7".
{
  const trades = Array.from({ length: 12 }, (_, i) => row({ id: `t${i}`, date: iso(1) }));
  const { ui } = harness({ trades });
  assert.equal((ui.recentTradesList.innerHTML.match(/class="lnd-row is-/g) || []).length, 7, "tape row cap changed");
  assert.equal(ui.lndTapeCountText.textContent, "12 trades on the tape this week");
  assert.equal(ui.lndTapeCount.hidden, false);
}

// 4. The 7-day window is real: older rows are excluded, and zero hides the badge.
{
  const { ui } = harness({ trades: [row({ id: "old", date: iso(30) }), row({ id: "old2", date: iso(8) })] });
  assert.equal(ui.lndTapeCount.hidden, true, "badge shown with nothing to count");
  assert.equal(ui.lndTapeCountText.textContent, "0 trades on the tape this week");
}
{
  const { ui } = harness({ trades: [row({ id: "new", date: iso(0) }), row({ id: "old", date: iso(9) })] });
  assert.equal(ui.lndTapeCountText.textContent, "1 trade on the tape this week", "singular/window wrong");
}

// 5. Honesty: the caption may only say "public feed" when the rows really are it.
{
  const publicView = harness({ trades: [row({ id: "a" })], canAccess: false });
  assert.match(publicView.ui.lndTapeNote.textContent, /public feed/);
  const ownView = harness({ trades: [row({ id: "a" })], canAccess: true });
  assert.doesNotMatch(ownView.ui.lndTapeNote.textContent, /public feed/, "a demo/preview journal was captioned as the public feed");
  assert.match(ownView.ui.lndTapeNote.textContent, /this browser/);
}

// 6. Empty feed still says which feed is empty.
{
  const { ui } = harness({ trades: [] });
  assert.match(ui.recentTradesList.innerHTML, /No closed trades on the public feed yet\./);
  assert.equal(ui.lndTapeCount.hidden, true);
}

console.log("OK — landing tape: closed-only, depth+word, honest counter, honest caption");
