// The boot screen is the most tempting place in this whole product to lie. It
// is the first thing a new user sees, it is supposed to feel impressive, and
// nobody would ever check whether the numbers on it were real.
//
// So the rule is enforced in the data function, not in the markup:
//
//   EVERY LINE IS TRUE OR ABSENT.
//
// The load-bearing assertion is §2: an empty journal must not be able to
// produce a single non-zero digit outside the two thresholds that are
// constants. If a future edit pads the log, that assertion fails immediately.
//
// Run: node tests/termBoot.check.mjs
import assert from "node:assert/strict";
import { buildBootLog, meterText, utcHm, SKEW_FLOOR_MS } from "../src/lib/bootLog.js";

const render = (lines) => lines.map((l) => `${l.k} ${l.v}`).join("\n");
const find = (lines, k) => lines.find((l) => l.k === k);

// --- 1. A populated boot reports what it was given, exactly -----------------
{
  const lines = buildBootLog({
    build: "20260810-term3",
    session: { username: "chesterlsc", authenticated: true },
    storage: { lastWrite: "08:12:44" },
    accounts: [
      { id: "ftmo-100k", rows: 141, active: true },
      { id: "live", rows: 27, active: false },
    ],
    closed: 168,
    stamped: 41,
    events: 63,
    asOf: "2026-08-10T07:04:12.000Z",
    stale: false,
    skewMs: 400,
    budgetLeft: 310,
    dailyMax: 500,
    debt: 4,
    worstWindow: { label: "US data window", slot: "12:00-14:00", netPnl: -612, n: 14 },
    money: (n) => `$${n}`,
    signedMoney: (n) => `-$${Math.abs(n)}`,
  });

  assert.equal(find(lines, "SESSION").v, "chesterlsc · authenticated");
  assert.match(find(lines, "STORAGE").v, /08:12:44/);
  assert.equal(find(lines, "ACCOUNTS").v, "2 mounted");
  assert.equal(find(lines, "  /acct/ftmo-100k").v, "141 rows · active");
  assert.equal(find(lines, "  /acct/live").v, "27 rows", "only the active account is labelled active");

  const mount = find(lines, "MOUNT /journal");
  assert.equal(mount.v, "168 closed · 41 stamped");
  assert.ok(mount.mount, "the signature line must be flagged so the FLIP can find it");
  assert.match(find(lines, "CALENDAR").v, /63 events · as of 07:04 UTC · link up/);
  assert.match(find(lines, "CLOCK").v, /skew \+0\.4s/);
  assert.match(find(lines, "RISK").v, /\$310 of \$500 left today/);
  assert.equal(find(lines, "DEBT").v, "4 closed trades with no note");
  assert.match(render(lines), /worst window is the US data window, 12:00-14:00 UTC, -\$612 across 14 trades/);
}

// --- 2. THE LOAD-BEARING ASSERTION ------------------------------------------
// A brand new account. Four real lines and an honest closing sentence. No
// invented figure may appear anywhere, so the whole render is swept for digits.
{
  const lines = buildBootLog({ accounts: [], closed: 0, stamped: 0, events: 0, asOf: null });
  const text = render(lines);

  assert.equal(find(lines, "CLOCK"), undefined, "zero skew is not news, the line must be absent");
  assert.equal(find(lines, "RISK"), undefined, "no budget set is not '0 left', it is no line");
  assert.equal(find(lines, "DEBT"), undefined, "no debt is not a boot line");
  assert.equal(find(lines, "MOUNT /journal").v, "0 closed · 0 stamped", "the true zero is reported, not hidden");
  assert.match(find(lines, "CALENDAR").v, /link down/);
  assert.match(text, /nothing on record yet/);
  assert.ok(!/\d+%/.test(text), "an empty journal must not produce a percentage");

  // Every numeral in an empty boot must be a 0, or one of the two thresholds
  // which are constants rather than measurements.
  const numerals = text.match(/\d+/g) || [];
  const illegal = numerals.filter((n) => !["0", "5", "10"].includes(n));
  assert.deepEqual(illegal, [], `an empty journal invented figures: ${illegal.join(", ")}`);
}

// --- 3. Demo is never dressed as authenticated ------------------------------
{
  const guest = buildBootLog({ session: { guest: true, username: "chesterlsc", authenticated: true } });
  assert.equal(find(guest, "SESSION").v, "demo · nothing here is saved", "guest must win over a stale username");
  assert.match(find(guest, "STORAGE").v, /discarded when this tab closes/);

  const preview = buildBootLog({ session: { preview: true } });
  assert.equal(find(preview, "SESSION").v, "local preview");

  const anon = buildBootLog({ session: {} });
  assert.equal(find(anon, "SESSION").v, "not signed in");
}

// --- 4. The skew floor, both sides ------------------------------------------
assert.equal(find(buildBootLog({ skewMs: SKEW_FLOOR_MS - 1 }), "CLOCK"), undefined);
assert.ok(find(buildBootLog({ skewMs: SKEW_FLOOR_MS }), "CLOCK"), "at the floor the line appears");
assert.match(find(buildBootLog({ skewMs: -3000 }), "CLOCK").v, /skew -3\.0s/, "a negative skew prints negative");

// --- 5. The meter cannot claim coverage a thin sample cannot support --------
{
  // One closed trade carrying one stamp is NOT 100% coverage. This is the
  // exact shape the lie would take, and it is the same floor eventEdge.js
  // already enforces when it refuses a win rate under five samples.
  const thin = meterText({ lit: 1, n: 1 }, 20, 5);
  assert.equal(thin.lit, 0);
  assert.equal(thin.label, "coverage below 5 trades");
  assert.ok(!thin.label.includes("%"), "a 1-trade meter must not render a percentage");

  const real = meterText({ lit: 41 / 168, n: 168 }, 20, 5);
  assert.equal(real.lit, 5, "round(0.244 * 20) = 5 lit cells");
  assert.equal(real.label, "24% context coverage");
  assert.equal(real.bar.length, 20, "the bar is always full width, lit or not");

  const empty = meterText({ lit: 0, n: 0 }, 12, 5);
  assert.equal(empty.lit, 0);
  assert.equal(empty.bar.length, 12, "the phone meter is 12 cells");
}

// --- 6. Accounts are capped, and the overflow is counted honestly -----------
{
  const many = buildBootLog({
    accounts: Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, rows: i, active: i === 0 })),
  });
  assert.equal(find(many, "ACCOUNTS").v, "7 mounted", "the true total is always stated");
  assert.equal(many.filter((l) => l.sub).length, 4, "3 rows plus one overflow line");
  assert.equal(many.filter((l) => l.sub).at(-1).v, "+4 more");
}

// --- 7. Time formatting is UTC and never throws on rubbish ------------------
assert.equal(utcHm("2026-08-10T07:04:12.000Z"), "07:04");
assert.equal(utcHm("2026-08-10T23:00:00.000Z"), "23:00");
assert.equal(utcHm("not a date"), "");
assert.equal(utcHm(undefined), "");

console.log("termBoot.check.mjs: OK — every line true or absent, empty journal invents nothing");
