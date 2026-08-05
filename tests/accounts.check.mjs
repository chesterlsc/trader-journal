// Multi-account scoping, driven out of the REAL app.js functions (sliced by
// name, never re-implemented here).
//
// The whole feature rests on one trick: state.trades holds only the ACTIVE
// account's rows, state.otherTrades holds the rest, and persistState writes
// allTrades(). Fifty existing readers of state.trades became account-scoped
// without being edited — which is elegant right up until a bug in the split
// deletes somebody's journal. So the invariants below are the ones with teeth:
//
//   · No trade is ever lost by a split, a switch, or an archive.
//   · A journal written before accounts existed migrates whole.
//   · A trade pointing at a deleted account is adopted, never orphaned.
//   · Scoping is real: two accounts never appear in one list.
//
// Run: node tests/accounts.check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { normalizePropRules } from "../src/lib/propRules.js";

const ROOT = "/Users/macbookairm3/Documents/Trader-Journal";
const appSrc = readFileSync(`${ROOT}/app.js`, "utf8");
const coreSrc = readFileSync(`${ROOT}/src/lib/core.js`, "utf8");

function takeFunction(src, name) {
  const start = src.search(new RegExp(`^(export )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3).replace(/^export function/, "function");
}

function takeConst(src, name, open, close) {
  const start = src.indexOf(`const ${name} = ${open}`);
  assert.ok(start >= 0, `missing const ${name}`);
  const end = src.indexOf(close, start);
  assert.ok(end > start, `unterminated const ${name}`);
  return src.slice(start, end + close.length);
}

// A one-line `const NAME = value;`, taken verbatim so the test cannot drift
// from the source it is checking.
function takeLine(src, name) {
  const match = new RegExp(`^const ${name} = .*;$`, "m").exec(src);
  assert.ok(match, `missing const ${name}`);
  return match[0];
}

const bundle = [
  takeConst(appSrc, "ACCOUNT_TYPES", "[", "];"),
  takeLine(appSrc, "ACCOUNT_TYPE_IDS"),
  takeLine(appSrc, "MAX_ACCOUNTS"),
  takeLine(appSrc, "DEFAULT_ACCOUNT_LABEL"),
  takeFunction(coreSrc, "ensureNonNegative"),
  takeFunction(appSrc, "getAccounts"),
  takeFunction(appSrc, "getVisibleAccounts"),
  takeFunction(appSrc, "getActiveAccount"),
  takeFunction(appSrc, "getAccountById"),
  takeFunction(appSrc, "accountTypeLabel"),
  takeFunction(appSrc, "makeAccount"),
  takeFunction(appSrc, "normalizeAccounts"),
  takeFunction(appSrc, "ensureAccounts"),
  takeFunction(appSrc, "allTrades"),
  takeFunction(appSrc, "adoptAllTrades"),
  takeFunction(appSrc, "applyActiveAccount"),
  takeFunction(appSrc, "countAccountTrades"),
  `return { getAccounts, getVisibleAccounts, getActiveAccount, getAccountById, accountTypeLabel,
            makeAccount, normalizeAccounts, ensureAccounts, allTrades, adoptAllTrades,
            applyActiveAccount, countAccountTrades };`
].join("\n");

let idCounter = 0;
const state = { trades: [], otherTrades: [], settings: {} };

// eslint-disable-next-line no-new-func
const api = new Function(
  "state",
  "createId",
  "normalizePropRules",
  bundle
)(state, () => `id-${(idCounter += 1)}`, normalizePropRules);

const reset = (settings, trades = [], otherTrades = []) => {
  state.settings = settings;
  state.trades = trades;
  state.otherTrades = otherTrades;
};

const ids = (list) => list.map((trade) => trade.id).sort();

/* ── 1. The migration: a journal written before accounts existed ─────────── */
{
  reset({ startingBalance: 25000, accounts: [], activeAccountId: "" });
  const legacy = [
    { id: "t1", date: "2026-07-01", netPnl: 100 },
    { id: "t2", date: "2026-07-02", netPnl: -50 },
    { id: "t3", date: "2026-07-03", netPnl: 25 }
  ];
  api.adoptAllTrades(legacy);

  assert.equal(state.settings.accounts.length, 1, "one account is created, not one per trade");
  const main = state.settings.accounts[0];
  assert.equal(main.label, "Main");
  assert.equal(main.startingBalance, 25000, "the migrated account inherits the trader's real starting balance");
  assert.equal(main.prop.enabled, false, "a migrated account is not a prop account until the trader says so");
  assert.equal(state.settings.activeAccountId, main.id);

  assert.deepEqual(ids(state.trades), ["t1", "t2", "t3"], "every legacy trade lands in the new account");
  assert.equal(state.otherTrades.length, 0);
  assert.deepEqual(ids(api.allTrades()), ["t1", "t2", "t3"], "nothing is lost by the split");
  for (const trade of state.trades) {
    assert.equal(trade.accountId, main.id, "and every one of them is stamped");
  }
}

/* ── 2. Scoping is real ──────────────────────────────────────────────────── */
{
  reset(
    {
      startingBalance: 25000,
      accounts: [
        { id: "a", label: "25K Eval", startingBalance: 25000 },
        { id: "b", label: "50K Funded", startingBalance: 50000 }
      ],
      activeAccountId: "a"
    },
    [],
    []
  );
  const everything = [
    { id: "a1", accountId: "a" },
    { id: "a2", accountId: "a" },
    { id: "b1", accountId: "b" },
    { id: "b2", accountId: "b" },
    { id: "b3", accountId: "b" }
  ];
  api.adoptAllTrades(everything);

  assert.deepEqual(ids(state.trades), ["a1", "a2"], "the active account sees only its own trades");
  assert.deepEqual(ids(state.otherTrades), ["b1", "b2", "b3"]);
  assert.deepEqual(ids(api.allTrades()), ["a1", "a2", "b1", "b2", "b3"], "and the journal is still whole");
  assert.equal(api.countAccountTrades("b"), 3, "the other account's rows are still countable");

  // The switch. This is the sequence switchAccount() performs, and getting the
  // order wrong here is how the OUTGOING account's trades get orphaned.
  const carried = api.allTrades();
  state.settings.activeAccountId = "b";
  api.adoptAllTrades(carried);

  assert.deepEqual(ids(state.trades), ["b1", "b2", "b3"], "the new active account is now the visible one");
  assert.deepEqual(ids(state.otherTrades), ["a1", "a2"], "and the old one is parked, not deleted");
  assert.deepEqual(ids(api.allTrades()), ["a1", "a2", "b1", "b2", "b3"], "no trade was lost in the switch");
}

/* ── 3. A trade pointing at an account that no longer exists ─────────────── */
{
  reset({
    startingBalance: 10000,
    accounts: [{ id: "live", label: "Live", startingBalance: 10000 }],
    activeAccountId: "live"
  });
  api.adoptAllTrades([
    { id: "ok", accountId: "live" },
    { id: "orphan", accountId: "an-account-that-was-deleted" },
    { id: "blank", accountId: "" }
  ]);

  assert.deepEqual(ids(state.trades), ["blank", "ok", "orphan"], "an orphan is adopted, never dropped");
  assert.equal(state.otherTrades.length, 0);
  assert.deepEqual(ids(api.allTrades()), ["blank", "ok", "orphan"]);
}

/* ── 4. Archiving keeps the trades ───────────────────────────────────────── */
{
  reset({
    startingBalance: 25000,
    accounts: [
      { id: "a", label: "Old", startingBalance: 25000 },
      { id: "b", label: "New", startingBalance: 50000 }
    ],
    activeAccountId: "a"
  });
  api.adoptAllTrades([{ id: "a1", accountId: "a" }, { id: "b1", accountId: "b" }]);

  const everything = api.allTrades();
  api.getAccountById("a").archived = true;
  state.settings.activeAccountId = "";
  api.applyActiveAccount();
  api.adoptAllTrades(everything);

  assert.equal(api.getActiveAccount().id, "b", "archiving the active account moves you to a live one");
  assert.equal(api.countAccountTrades("a"), 1, "the archived account keeps every trade it owned");
  assert.deepEqual(ids(api.allTrades()), ["a1", "b1"], "archiving is not deletion");
  assert.deepEqual(
    api.getVisibleAccounts().map((account) => account.id),
    ["b"],
    "an archived account leaves the switcher"
  );
}

/* ── 5. An active id pointing at an archived account ─────────────────────── */
{
  reset({
    startingBalance: 10000,
    accounts: [
      { id: "gone", label: "Archived", startingBalance: 10000, archived: true },
      { id: "here", label: "Live", startingBalance: 10000 }
    ],
    activeAccountId: "gone"
  });
  assert.equal(api.getActiveAccount().id, "here", "an archived account is not a place to be standing");
}

// Every account archived is a degenerate state the UI prevents, but the getter
// still has to return something rather than dropping the trader into a blank app.
{
  reset({
    startingBalance: 10000,
    accounts: [{ id: "only", label: "Only", startingBalance: 10000, archived: true }],
    activeAccountId: "only"
  });
  assert.equal(api.getActiveAccount().id, "only", "the last account is shown even when archived");
}

/* ── 6. normalizeAccounts ────────────────────────────────────────────────── */
{
  const cleaned = api.normalizeAccounts([
    { id: "x", label: "  Spaced  ", type: "evaluation", startingBalance: "50000", currency: "usd" },
    { id: "x", label: "Duplicate id" },
    null,
    "nonsense",
    { label: "", type: "made-up", startingBalance: -5 }
  ]);

  assert.equal(cleaned.length, 3, "junk entries are dropped, real ones survive");
  assert.equal(cleaned[0].label, "Spaced");
  assert.equal(cleaned[0].startingBalance, 50000, "numeric strings coerce");
  assert.equal(cleaned[0].currency, "USD");
  assert.notEqual(cleaned[1].id, cleaned[0].id, "a duplicate id is re-minted — two accounts sharing one id would make every trade ambiguous");
  assert.equal(cleaned[2].label, "Account", "a nameless account still gets a name");
  assert.equal(cleaned[2].type, "personal", "an unknown type falls back rather than being stored");
  assert.equal(cleaned[2].startingBalance, 0, "a negative balance falls back to zero, not to a default");

  assert.deepEqual(api.normalizeAccounts("not an array"), []);
  assert.equal(
    api.normalizeAccounts(Array.from({ length: 40 }, (_, i) => ({ label: `a${i}` }))).length,
    24,
    "the account list is capped"
  );
}

/* ── 7. A $0 starting balance is a real value, not a missing one ─────────── */
{
  // Express-Funded accounts genuinely start at $0. If makeAccount treated that
  // as absent and substituted a default, the tracker's whole floor calculation
  // would be wrong for every funded account.
  const xfa = api.makeAccount({ label: "50K XFA", startingBalance: 0, type: "funded" });
  assert.equal(xfa.startingBalance, 0);
  assert.equal(xfa.type, "funded");
  assert.equal(xfa.prop.trailStopAt, 0, "the trail cap seeds from the account's own start");
}

/* ── 8. applyActiveAccount mirrors the starting balance, except at zero ──── */
{
  reset({
    startingBalance: 10000,
    accounts: [{ id: "a", label: "50K", startingBalance: 50000 }],
    activeAccountId: "a"
  });
  api.applyActiveAccount();
  assert.equal(state.settings.startingBalance, 50000, "the account owns its starting balance");

  reset({
    startingBalance: 10000,
    accounts: [{ id: "z", label: "XFA", startingBalance: 0 }],
    activeAccountId: "z"
  });
  api.applyActiveAccount();
  assert.equal(
    state.settings.startingBalance,
    10000,
    "a $0 account does not zero the settings balance — percentage and position-size maths need a real base"
  );
}

/* ── 9. ensureAccounts is idempotent ─────────────────────────────────────── */
{
  reset({ startingBalance: 10000, accounts: [], activeAccountId: "" });
  api.ensureAccounts();
  const firstId = state.settings.accounts[0].id;
  api.ensureAccounts();
  api.ensureAccounts();
  assert.equal(state.settings.accounts.length, 1, "repeated loads do not stack up default accounts");
  assert.equal(state.settings.accounts[0].id, firstId, "and the id is stable, so trades keep pointing at it");
}

console.log("accounts.check.mjs: OK — migration, scoping, switching and archiving all keep every trade");
