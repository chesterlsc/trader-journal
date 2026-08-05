// Drives the REAL guest-mode storage indirection and carry-over helpers out of
// app.js (sliced by name) against fake Storage objects. The invariant under
// test: a demo session never touches localStorage, and a sign-up never carries
// fabricated sample rows into a real account.
// Run: node guest-storage-check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = "/Users/macbookairm3/Documents/Trader-Journal";
const appSrc = readFileSync(`${ROOT}/app.js`, "utf8");
const coreSrc = readFileSync(`${ROOT}/src/lib/core.js`, "utf8");

function takeFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3);
}
function takeConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `missing const ${name}`);
  return src.slice(start, src.indexOf(";\n", start) + 2);
}
function takeBlockConst(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `missing const ${name}`);
  return src.slice(start, src.indexOf("\n};", start) + 3);
}

class FakeStore {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  keys() { return [...this.map.keys()]; }
}

const localStore = new FakeStore();
const sessionStore = new FakeStore();
const state = { auth: { guestMode: false }, trades: [], reflections: [] };

const bundle = [
  takeFunction(coreSrc, "readStorageJson"),
  takeFunction(coreSrc, "writeStorageJson"),
  takeBlockConst(appSrc, "STORAGE_KEYS"),
  takeConst(appSrc, "GUEST_MODE_KEY"),
  takeConst(appSrc, "GUEST_KEY_PREFIX"),
  takeConst(appSrc, "DEMO_BATCH_ID"),
  takeConst(appSrc, "DEMO_REFLECTION_TAG"),
  takeFunction(appSrc, "journalStore"),
  takeFunction(appSrc, "journalKey"),
  takeFunction(appSrc, "collectGuestOwnWork"),
  takeFunction(appSrc, "applyGuestCarryOver"),
  `return { STORAGE_KEYS, GUEST_KEY_PREFIX, DEMO_BATCH_ID, journalStore, journalKey,
            collectGuestOwnWork, applyGuestCarryOver, writeStorageJson, readStorageJson };`
]
  .join("\n")
  .replace(/^export function/gm, "function");

// eslint-disable-next-line no-new-func
const api = new Function("state", "window", "localStorage", bundle)(
  state,
  { sessionStorage: sessionStore, localStorage: localStore },
  localStore
);

const write = () =>
  api.writeStorageJson(api.journalKey(api.STORAGE_KEYS.trades), state.trades, api.journalStore());

// --- 1. real session writes localStorage, unprefixed -----------------------
state.trades = [{ id: "real-1" }];
write();
assert.deepEqual(localStore.keys(), ["axiom_journal_trades_v1"]);
assert.equal(sessionStore.keys().length, 0);

// --- 2. demo session writes sessionStorage ONLY, under a prefix ------------
const localBefore = JSON.stringify([...localStore.map]);
state.auth.guestMode = true;
state.trades = [{ id: "demo-a" }, { id: "demo-b" }];
write();
assert.deepEqual(
  sessionStore.keys(),
  ["demo:axiom_journal_trades_v1"],
  "demo journal is prefixed inside sessionStorage"
);
assert.equal(
  JSON.stringify([...localStore.map]),
  localBefore,
  "a demo session must not touch localStorage at all"
);
assert.ok(
  sessionStore.keys().every((k) => k.startsWith(api.GUEST_KEY_PREFIX)),
  "no demo key may collide with a real key name"
);

// --- 3. the real journal is still intact and readable after the demo -------
state.auth.guestMode = false;
assert.deepEqual(
  api.readStorageJson(api.journalKey(api.STORAGE_KEYS.trades), [], api.journalStore()),
  [{ id: "real-1" }],
  "exiting the demo returns the untouched real journal"
);

// --- 4. carry-over excludes the seeded sample rows -------------------------
state.auth.guestMode = true;
state.trades = [
  { id: "s1", importBatchId: api.DEMO_BATCH_ID },
  { id: "s2", importBatchId: api.DEMO_BATCH_ID },
  { id: "mine-1", importBatchId: "" },
  { id: "mine-2", importBatchId: "" }
];
state.reflections = [
  { id: "sr", tags: ["sample"] },
  { id: "mr", tags: ["discipline"] }
];
const carry = api.collectGuestOwnWork();
assert.deepEqual(carry.trades.map((t) => t.id), ["mine-1", "mine-2"], "sample trades excluded");
assert.deepEqual(carry.reflections.map((r) => r.id), ["mr"], "sample reflections excluded");

// --- 5. carry-over APPENDS, never replaces, and never duplicates -----------
state.auth.guestMode = false;
state.trades = [{ id: "existing-account-trade" }];
state.reflections = [];
const added = api.applyGuestCarryOver(carry);
assert.equal(added, 2);
assert.deepEqual(
  state.trades.map((t) => t.id),
  ["existing-account-trade", "mine-1", "mine-2"],
  "the existing journal survives untouched at the head of the array"
);
assert.equal(api.applyGuestCarryOver(carry), 0, "re-applying the same carry adds nothing");
assert.equal(state.trades.length, 3);
assert.equal(api.applyGuestCarryOver(null), 0);

console.log("PASS  demo writes are sessionStorage-only and prefixed; carry-over drops samples and appends");
