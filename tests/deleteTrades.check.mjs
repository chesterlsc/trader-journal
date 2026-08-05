// The two delete affordances, driven out of the REAL app.js (sliced by name,
// no duplication). Deleting is the only action in this journal with no natural
// recovery, so the three things that must never silently rot are:
//
//   1. "Delete all" deletes what the header SAYS it deletes — getFilteredTrades()
//      and nothing else. A bulk delete that ignores the filter, or one that
//      quietly widens to the whole journal, both look identical from the code.
//   2. The typed confirmation actually rejects a stray Enter/OK.
//   3. Undo restores exactly what went, and never duplicates a row that came
//      back some other way — the undo window is 30s, long enough for the trader
//      to log a new trade or import a backup in between.
//
// Run: node tests/deleteTrades.check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const appSrc = readFileSync(`${ROOT}/app.js`, "utf8");

function takeFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3);
}

const bundle = [
  takeFunction(appSrc, "isTradeJournalled"),
  takeFunction(appSrc, "isRuleBroken"),
  takeFunction(appSrc, "getFilteredTrades"),
  takeFunction(appSrc, "restoreTrades"),
  takeFunction(appSrc, "isBulkDeleteConfirmed"),
  takeFunction(appSrc, "removeTrades"),
  "return { getFilteredTrades, restoreTrades, isBulkDeleteConfirmed, removeTrades };"
].join("\n");

const trade = (over) => ({
  id: over.id,
  date: "2026-08-05",
  asset: "BTCUSDT",
  market: "Crypto",
  setupType: "Liquidity Grab",
  session: "London",
  timeframe: "H1",
  psychology: "Focused",
  status: "closed",
  result: "Win",
  riskPercent: 1,
  notes: "",
  journalledAt: "2026-08-05T10:00:00.000Z",
  ...over
});

const ALL = [
  trade({ id: "a", result: "Win" }),
  trade({ id: "b", result: "Loss" }),
  trade({ id: "c", result: "Loss", session: "New York" }),
  trade({ id: "d", result: "Win", session: "New York" }),
  trade({ id: "e", status: "open", result: "Open" })
];

// Enough of the app's globals for the sliced functions to run. persistState /
// renderAll / setMessage / showCaptureToast are recorded, not stubbed away:
// the point of removeTrades() is that EVERY delete route goes through the same
// persist + undo pair, so the test asserts they were called.
function harness() {
  const calls = { persist: 0, render: 0, closeSwipe: 0, toast: null, message: null };
  const state = {
    trades: ALL.map((t) => ({ ...t })),
    settings: { riskPerTrade: 1 },
    filters: {
      dateFrom: "",
      dateTo: "",
      market: "all",
      setup: "all",
      session: "all",
      timeframe: "all",
      psychology: "all",
      search: "",
      quick: "all"
    }
  };
  const env = {
    state,
    UNDO_TOAST_MS: 30000,
    ui: { journalMessage: {} },
    persistState: () => { calls.persist += 1; },
    renderAll: () => { calls.render += 1; },
    closeRowSwipe: () => { calls.closeSwipe += 1; },
    setMessage: (_node, text) => { calls.message = text; },
    showCaptureToast: (text, tone, options) => { calls.toast = { text, tone, ...options }; }
  };
  const names = Object.keys(env);
  // eslint-disable-next-line no-new-func
  const api = new Function(...names, bundle)(...names.map((n) => env[n]));
  return { api, state, calls };
}

/* --- 1. Delete all is scoped to the filter, not to the journal ------------ */
{
  const { api, state } = harness();
  assert.equal(api.getFilteredTrades().length, 5, "unfiltered, every trade is in scope");

  state.filters.quick = "losses";
  assert.deepEqual(
    api.getFilteredTrades().map((t) => t.id),
    ["b", "c"],
    "a chip narrows what Delete all would take"
  );

  state.filters.session = "New York";
  assert.deepEqual(
    api.getFilteredTrades().map((t) => t.id),
    ["c"],
    "chip AND dropdown compose — the count in the prompt is the intersection"
  );

  state.filters.quick = "all";
  state.filters.session = "all";
  state.filters.search = "nothing-matches-this";
  assert.deepEqual(api.getFilteredTrades(), [], "an empty selection is empty, not everything");
}

/* --- 2. The typed confirmation ------------------------------------------- */
{
  const { api } = harness();
  const ok = (answer, count) => api.isBulkDeleteConfirmed(answer, count);

  assert.equal(ok("DELETE", 44), true, "the word, as printed");
  assert.equal(ok("delete", 44), true, "case is not the point — intent is");
  assert.equal(ok("  DELETE  ", 44), true, "a phone keyboard's trailing space is not a rejection");
  assert.equal(ok("44", 44), true, "the exact count is the other accepted answer");

  assert.equal(ok(null, 44), false, "Cancel is not confirmation");
  assert.equal(ok("", 44), false, "a bare Enter through the prompt is not confirmation");
  assert.equal(ok("   ", 44), false, "whitespace is not confirmation");
  assert.equal(ok("yes", 44), false, "the habitual answer is not confirmation");
  assert.equal(ok("y", 44), false);
  assert.equal(ok("43", 44), false, "a stale count — the filter changed under them — is refused");
  assert.equal(ok("4", 44), false, "a prefix of the count is not the count");
  assert.equal(ok("0", 0), true, "…but the guard is arithmetic, not a truthiness accident");
  assert.equal(ok("delete all", 44), false, "close is not equal");
}

/* --- 3. removeTrades: one path, and it persists ---------------------------- */
{
  const { api, state, calls } = harness();
  const doomed = state.trades.filter((t) => t.result === "Loss");

  api.removeTrades(doomed, "Deleted 2 trades.");
  assert.deepEqual(state.trades.map((t) => t.id), ["a", "d", "e"], "exactly the doomed rows went");
  assert.equal(calls.persist, 1, "the delete is written through persistState — demo mode included");
  assert.equal(calls.render, 1);
  assert.equal(calls.closeSwipe, 1, "an open swipe reveal cannot survive its own row");
  assert.ok(typeof calls.toast.onUndo === "function", "every delete offers an undo");
  assert.equal(calls.toast.duration, 30000, "the undo window is generous, not the 5s default");

  calls.toast.onUndo();
  assert.deepEqual(
    state.trades.map((t) => t.id).sort(),
    ["a", "b", "c", "d", "e"],
    "undo restores every deleted trade"
  );
  assert.equal(calls.persist, 2, "the restore is persisted too — undo is not a render-only illusion");
  assert.match(calls.message, /Restored 2 trades/);
}

/* --- 4. removeTrades on an empty selection is a no-op --------------------- */
{
  const { api, state, calls } = harness();
  api.removeTrades([], "should never show");
  assert.equal(state.trades.length, 5);
  assert.equal(calls.persist, 0, "an empty delete must not write, and must not offer an undo");
  assert.equal(calls.toast, null);
}

/* --- 5. Undo is an id-keyed union, not a concat --------------------------- */
{
  const { api } = harness();
  const current = [trade({ id: "a" }), trade({ id: "z" })];
  const removed = [trade({ id: "b" }), trade({ id: "c" })];

  assert.deepEqual(
    api.restoreTrades(current, removed).map((t) => t.id),
    ["a", "z", "b", "c"],
    "the removed rows come back"
  );

  // The undo toast outlives the delete by 30s: an import, or a re-log of the
  // same trade, can put a doomed id back before Undo is pressed.
  assert.deepEqual(
    api.restoreTrades([...current, trade({ id: "b" })], removed).map((t) => t.id),
    ["a", "z", "b", "c"],
    "a row that is already back is not duplicated by undo"
  );

  assert.deepEqual(
    api.restoreTrades(current, []).map((t) => t.id),
    ["a", "z"],
    "undoing nothing changes nothing"
  );

  // Ids arrive as numbers from a server round-trip and as strings from
  // localStorage; the union has to see through that.
  assert.deepEqual(
    api.restoreTrades([{ id: 7 }], [{ id: "7" }]).length,
    1,
    "id 7 and id \"7\" are the same trade"
  );

  assert.equal(current.length, 2, "restoreTrades does not mutate its input");
}

/* --- 6. The swipe must not be a delete ------------------------------------
   Structural, because the failure mode is a one-word edit: if openRowSwipe()
   ever calls a delete directly instead of rendering a button that routes into
   the existing confirm, a pocket swipe destroys a trade silently. */
{
  // Comments stripped: the prose in there legitimately names deleteTrade().
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const openRowSwipe = stripComments(takeFunction(appSrc, "openRowSwipe"));
  assert.ok(
    !/removeTrades\(|deleteTrade\(|state\.trades\s*=/.test(openRowSwipe),
    "openRowSwipe() must only REVEAL the action — it may not delete, directly or otherwise"
  );
  assert.match(
    openRowSwipe,
    /dataset\.action\s*=\s*"delete"/,
    "the revealed button routes through the existing table click delegate, so it inherits the confirm"
  );

  // pan-y is what keeps vertical page scrolling native while a horizontal
  // swipe is being judged; without it the row can swallow a scroll.
  const clay = readFileSync(`${ROOT}/clay-v2.css`, "utf8");
  assert.match(
    clay,
    /#journal tbody tr\[data-trade-id\][\s\S]{0,200}touch-action:\s*pan-y/,
    "the swipeable row must declare touch-action: pan-y"
  );
  assert.ok(
    !/preventDefault/.test(stripComments(takeFunction(appSrc, "bindRowSwipe"))),
    "the swipe never calls preventDefault — the browser keeps the vertical axis"
  );
}

console.log("deleteTrades.check.mjs: OK — filtered scope, typed confirm, undo restore, swipe-reveals-only");
