// Terminal Mode — the power on self test, as data. Pure: no DOM, no clock, no
// storage. app.js gathers live state and hands it in; this file decides what
// the machine is ALLOWED to say about it.
//
// The failure mode here is not a crash. It is a boot screen that looks
// impressive because it invented four of its thirteen numbers. So the rule is
// enforced in the library, where a test can hold it:
//
//   EVERY LINE IS TRUE OR ABSENT.
//
// There is no placeholder, no "unknown", no "--", and no zero dressed up as a
// figure. A brand new account boots to four lines and says nothing else. That
// is correct, and it must be allowed to happen: a four line POST on an empty
// journal is more persuasive than a thirteen line one that padded itself.

/** Minutes of clock skew below which the CLOCK line is not news. */
export const SKEW_FLOOR_MS = 250;

const pad2 = (n) => String(n).padStart(2, "0");

/** "2026-08-10T07:04:12.000Z" -> "07:04". Empty string for anything unparseable. */
export function utcHm(iso) {
  const ms = Date.parse(iso ?? "");
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * @param {object} input  live state, already gathered. Every field optional:
 *   an absent field produces an absent line, never a fabricated one.
 * @returns {Array<{k:string,v:string,head?:boolean,sub?:boolean,mount?:boolean,
 *                  payload?:boolean,meter?:{lit:number,n:number}}>}
 */
export function buildBootLog(input = {}) {
  const {
    build = "",
    session = {},
    storage = {},
    accounts = [],
    closed = 0,
    stamped = 0,
    events = 0,
    asOf = null,
    stale = false,
    skewMs = 0,
    edgeMinLog = 5,
    edgeMinVerdict = 10,
    budgetLeft = null,
    dailyMax = 0,
    debt = 0,
    worstWindow = null,
    money = (n) => String(n),
    signedMoney = (n) => String(n),
  } = input;

  const lines = [];
  const push = (k, v, extra = {}) => lines.push({ k, v, ...extra });

  push("TRADER JOURNAL · POWER ON SELF TEST", build ? `build ${build}` : "", { head: true });

  // Demo is never dressed as authenticated: the whole feature is a claim about
  // the trader's real record, so the line that says whose record it is has to
  // be the most honest one on the screen.
  push(
    "SESSION",
    session.guest
      ? "demo · nothing here is saved"
      : session.preview
        ? "local preview"
        : session.authenticated && session.username
          ? `${session.username} · authenticated`
          : "not signed in"
  );

  push(
    "STORAGE",
    session.guest
      ? "session only · discarded when this tab closes"
      : storage.lastWrite
        ? `local · last write ${storage.lastWrite}`
        : "unavailable · this session only"
  );

  push("ACCOUNTS", `${accounts.length} mounted`);
  accounts.slice(0, 3).forEach((account) => {
    push(`  /acct/${account.id}`, `${account.rows} rows${account.active ? " · active" : ""}`, { sub: true });
  });
  if (accounts.length > 3) {
    push("", `+${accounts.length - 3} more`, { sub: true });
  }

  // THE SIGNATURE LINE.
  push("MOUNT /journal", `${closed} closed · ${stamped} stamped`, {
    mount: true,
    meter: { lit: closed > 0 ? stamped / closed : 0, n: closed },
  });

  push(
    "CALENDAR",
    asOf === null
      ? "link down · no schedule · the desk runs on your record alone"
      : `${events} events · as of ${utcHm(asOf)} UTC · ${stale ? "stale" : "link up"}`
  );

  // A skew of 0.0s is not news. Omitted, not padded.
  if (Math.abs(skewMs) >= SKEW_FLOOR_MS) {
    const sign = skewMs >= 0 ? "+" : "-";
    push("CLOCK", `skew ${sign}${(Math.abs(skewMs) / 1000).toFixed(1)}s · drawn against the server`);
  }

  push("EDGE ENGINE", `floors ${edgeMinLog} for a rate, ${edgeMinVerdict} for a verdict`);

  // No budget set is not "0 left". It is no line.
  if (budgetLeft !== null && dailyMax > 0) {
    push("RISK", `${money(budgetLeft)} of ${money(dailyMax)} left today`);
  }

  // No debt is not a boot line.
  if (debt > 0) {
    push("DEBT", `${debt} closed trade${debt === 1 ? "" : "s"} with no note`);
  }

  push("DESK ONLINE", "", { head: true });

  // The payload: a machine that boots by telling you something true about
  // yourself. Needs no stamps and no archive, so it is real on visit one.
  if (worstWindow) {
    push(
      "",
      `> your worst window is the ${worstWindow.label}, ${worstWindow.slot} UTC, ${signedMoney(
        worstWindow.netPnl
      )} across ${worstWindow.n} trades`,
      { payload: true }
    );
  } else if (closed === 0) {
    push("", "> nothing on record yet. the schedule is real, the rest fills in as you trade.", { payload: true });
  }

  return lines;
}

/**
 * The mount meter, as text. Below `minLog` closed trades it refuses to render a
 * percentage at all: one closed trade carrying one stamp is not 100% coverage,
 * and that is the exact shape the lie would take.
 */
export function meterText(meter, cells = 20, minLog = 5) {
  if (!meter || meter.n < minLog) {
    return { bar: "░".repeat(cells), lit: 0, label: `coverage below ${minLog} trades` };
  }
  const lit = Math.round(meter.lit * cells);
  return {
    bar: "▓".repeat(lit) + "░".repeat(cells - lit),
    lit,
    label: `${Math.round(meter.lit * 100)}% context coverage`,
  };
}
