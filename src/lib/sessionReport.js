// Session Intelligence analytics.
//
// This module consumes normalized journal trades only. Topstep Orders rows are
// reconstructed upstream; raw order rows are never interpreted here. All
// execution-time, P&L-basis, timezone, confidence and missing-data decisions
// stay in this pure module so the UI cannot accidentally invent a second set
// of analytics rules.

export const DEFAULT_REPORT_TIME_ZONE = "America/New_York";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MINUTES = 24 * 60;
const OFF_SESSION = "Off session";
const UNRESOLVED_SESSION = "Unresolved";
const SESSION_ROW_LABELS = Object.freeze(["Asia", "London", "New York", OFF_SESSION]);
const WEEKDAY_INDEX = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
const DEFAULT_SESSION_DAYS = Object.freeze([1, 2, 3, 4, 5]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const CONFIDENCE_THRESHOLDS = Object.freeze({
  early: Object.freeze({ min: 1, label: "Early signal" }),
  developing: Object.freeze({ min: 3, label: "Developing" }),
  reliable: Object.freeze({ min: 5, label: "Reliable" })
});

// Kept for existing app integrations. Confidence is now centralized above.
export const MIN_RELIABLE_HOUR_SAMPLES = CONFIDENCE_THRESHOLDS.reliable.min;

export const SESSION_WINDOWS = Object.freeze([
  Object.freeze({
    id: "asia",
    label: "Asia",
    timeZone: "Asia/Tokyo",
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    weekdays: DEFAULT_SESSION_DAYS
  }),
  Object.freeze({
    id: "london",
    label: "London",
    timeZone: "Europe/London",
    startMinute: 8 * 60,
    endMinute: 16 * 60 + 30,
    weekdays: DEFAULT_SESSION_DAYS
  }),
  Object.freeze({
    id: "new-york",
    label: "New York",
    timeZone: "America/New_York",
    startMinute: 9 * 60 + 30,
    endMinute: 16 * 60,
    weekdays: DEFAULT_SESSION_DAYS
  })
]);

export const DURATION_BANDS = Object.freeze([
  Object.freeze({ key: "under-1m", label: "Under 1 minute", minMs: 0, maxMs: MINUTE_MS }),
  Object.freeze({ key: "1m-5m", label: "1 to 5 minutes", minMs: MINUTE_MS, maxMs: 5 * MINUTE_MS }),
  Object.freeze({ key: "5m-15m", label: "5 to 15 minutes", minMs: 5 * MINUTE_MS, maxMs: 15 * MINUTE_MS }),
  Object.freeze({ key: "15m-30m", label: "15 to 30 minutes", minMs: 15 * MINUTE_MS, maxMs: 30 * MINUTE_MS }),
  Object.freeze({ key: "30m-60m", label: "30 to 60 minutes", minMs: 30 * MINUTE_MS, maxMs: HOUR_MS }),
  Object.freeze({ key: "1h-2h", label: "1 to 2 hours", minMs: HOUR_MS, maxMs: 2 * HOUR_MS }),
  Object.freeze({ key: "2h-plus", label: "2 hours or longer", minMs: 2 * HOUR_MS, maxMs: Infinity })
]);

const FORMATTERS = new Map();

export function isValidTimeZone(value) {
  const timeZone = String(value || "").trim();
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function requireTimeZone(value, fallback = "") {
  const timeZone = String(value || fallback).trim();
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Invalid IANA time zone: ${timeZone || "(empty)"}`);
  }
  return timeZone;
}

function zonedFormatter(timeZone) {
  if (!FORMATTERS.has(timeZone)) {
    FORMATTERS.set(timeZone, new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }));
  }
  return FORMATTERS.get(timeZone);
}

export function getZonedDateParts(instant, timeZone) {
  const instantMs = instant instanceof Date ? instant.getTime() : Number(instant);
  if (!Number.isFinite(instantMs) || !isValidTimeZone(timeZone)) return null;

  const values = {};
  for (const part of zonedFormatter(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  const result = {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: String(values.weekday || ""),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
  return [result.year, result.month, result.day, result.hour, result.minute, result.second]
    .every(Number.isFinite)
    ? result
    : null;
}

function validDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseTimestampParts(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return null;

  const iso = value.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+\-]\d{2}:?\d{2})?$/i
  );
  if (iso) {
    return normalizeTimestampParts({
      year: iso[1], month: iso[2], day: iso[3], hour: iso[4], minute: iso[5],
      second: iso[6] || "0", fraction: iso[7] || "", meridiem: "", zone: iso[8] || ""
    });
  }

  const us = value.match(
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(AM|PM)?\s*(Z|[+\-]\d{2}:?\d{2})?$/i
  );
  if (!us) return null;
  return normalizeTimestampParts({
    year: us[3], month: us[1], day: us[2], hour: us[4], minute: us[5],
    second: us[6] || "0", fraction: us[7] || "", meridiem: us[8] || "", zone: us[9] || ""
  });
}

function normalizeTimestampParts(input) {
  const year = Number(input.year);
  const month = Number(input.month);
  const day = Number(input.day);
  let hour = Number(input.hour);
  const minute = Number(input.minute);
  const second = Number(input.second);
  const meridiem = String(input.meridiem || "").toUpperCase();

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = meridiem === "AM" ? hour % 12 : (hour % 12) + 12;
  }
  if (
    !validDateParts(year, month, day) ||
    !Number.isInteger(hour) || hour < 0 || hour > 23 ||
    !Number.isInteger(minute) || minute < 0 || minute > 59 ||
    !Number.isInteger(second) || second < 0 || second > 59
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond: Number((String(input.fraction || "") + "000").slice(0, 3)),
    zone: String(input.zone || "").toUpperCase()
  };
}

function explicitOffsetMinutes(zone) {
  if (zone === "Z") return 0;
  let value = String(zone || "").toUpperCase();
  if (/^[+\-]\d{4}$/.test(value)) value = `${value.slice(0, 3)}:${value.slice(3)}`;
  const match = value.match(/^([+\-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  return (match[1] === "+" ? 1 : -1) * (hours * 60 + minutes);
}

function zoneOffsetAt(instantMs, timeZone) {
  const local = getZonedDateParts(instantMs, timeZone);
  if (!local) return null;
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const wholeSecondInstant = Math.floor(instantMs / 1000) * 1000;
  return localAsUtc - wholeSecondInstant;
}

function sameWallClock(parts, instantMs, timeZone) {
  const local = getZonedDateParts(instantMs, timeZone);
  return Boolean(local) &&
    local.year === parts.year && local.month === parts.month && local.day === parts.day &&
    local.hour === parts.hour && local.minute === parts.minute && local.second === parts.second;
}

// Resolve a zone-less wall clock without Date.parse. During a repeated DST
// hour the earlier occurrence wins deterministically; nonexistent spring-
// forward wall times stay unresolved.
function wallClockInZone(parts, timeZone) {
  if (!isValidTimeZone(timeZone)) return null;
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );
  const offsets = new Set();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const offset = zoneOffsetAt(wallAsUtc + delta * HOUR_MS, timeZone);
    if (Number.isFinite(offset)) offsets.add(offset);
  }
  const matches = [...offsets]
    .map((offset) => wallAsUtc - offset)
    .filter((instantMs) => sameWallClock(parts, instantMs, timeZone))
    .sort((left, right) => left - right);
  return matches[0] ?? null;
}

export function parseExecutionTimestamp(rawValue, options = {}) {
  const parts = parseTimestampParts(rawValue);
  if (!parts) return { instantMs: null, quality: "unresolved", reason: "invalid-timestamp" };

  if (parts.zone) {
    const offsetMinutes = explicitOffsetMinutes(parts.zone);
    if (offsetMinutes === null) {
      return { instantMs: null, quality: "unresolved", reason: "invalid-offset" };
    }
    const wallAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond
    );
    return { instantMs: wallAsUtc - offsetMinutes * MINUTE_MS, quality: "exact", reason: "explicit-offset" };
  }

  const sourceTimeZone = String(options.sourceTimeZone || "").trim();
  if (!sourceTimeZone) {
    return { instantMs: null, quality: "unresolved", reason: "missing-source-time-zone" };
  }
  const instantMs = wallClockInZone(parts, sourceTimeZone);
  return Number.isFinite(instantMs)
    ? { instantMs, quality: "assumed", reason: "source-time-zone" }
    : { instantMs: null, quality: "unresolved", reason: "invalid-source-wall-time" };
}

export function parseDurationMs(rawValue) {
  const value = String(rawValue || "").trim();
  const match = value.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isSafeInteger(hours) || minutes > 59 || seconds > 59) return null;
  const milliseconds = Number((String(match[4] || "") + "000").slice(0, 3));
  const total = ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
  return Number.isSafeInteger(total) ? total : null;
}

function normalizeSessionWindows(input) {
  const windows = Array.isArray(input) && input.length ? input : SESSION_WINDOWS;
  return windows.map((window, index) => {
    const label = String(window?.label || "").trim();
    const timeZone = requireTimeZone(window?.timeZone);
    const startMinute = Number(window?.startMinute);
    const endMinute = Number(window?.endMinute);
    if (
      !label || !Number.isInteger(startMinute) || !Number.isInteger(endMinute) ||
      startMinute < 0 || startMinute >= DAY_MINUTES || endMinute < 0 || endMinute > DAY_MINUTES ||
      startMinute === endMinute
    ) {
      throw new RangeError(`Invalid session window at index ${index}`);
    }
    const weekdays = Array.isArray(window.weekdays) && window.weekdays.length
      ? [...new Set(window.weekdays.map(Number))]
      : [...DEFAULT_SESSION_DAYS];
    if (weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new RangeError(`Invalid session weekdays at index ${index}`);
    }
    return { id: String(window.id || label.toLowerCase().replace(/\s+/g, "-")), label, timeZone, startMinute, endMinute, weekdays };
  });
}

function activeWindowAt(local, window) {
  const minute = local.hour * 60 + local.minute;
  const crossesMidnight = window.startMinute > window.endMinute;
  const active = crossesMidnight
    ? minute >= window.startMinute || minute < window.endMinute
    : minute >= window.startMinute && minute < window.endMinute;
  if (!active) return null;

  const currentWeekday = WEEKDAY_INDEX[local.weekday];
  if (!Number.isInteger(currentWeekday)) return null;
  // After-midnight minutes belong to the session day on which the overnight
  // window opened. This keeps Friday 23:00-02:00 active through Saturday 02:00
  // without accidentally treating Saturday night's open as a weekday session.
  const sessionWeekday = crossesMidnight && minute < window.endMinute
    ? (currentWeekday + 6) % 7
    : currentWeekday;
  if (!window.weekdays.includes(sessionWeekday)) return null;

  const elapsedMinutes = minute >= window.startMinute
    ? minute - window.startMinute
    : DAY_MINUTES - window.startMinute + minute;
  return { label: window.label, elapsedMinutes };
}

// Venue windows use their own IANA zones. Changing the report/display zone
// therefore never relabels a session. When venues overlap, the venue that
// opened most recently is the primary session and all active labels are kept.
export function detectPrimarySession(instant, options = {}) {
  const instantMs = instant instanceof Date ? instant.getTime() : Number(instant);
  if (!Number.isFinite(instantMs)) return { primary: UNRESOLVED_SESSION, active: [] };
  const supplied = Array.isArray(options) ? options : options.sessionWindows;
  const windows = normalizeSessionWindows(supplied);
  const active = windows.map((window) => {
    const local = getZonedDateParts(instantMs, window.timeZone);
    return local ? activeWindowAt(local, window) : null;
  }).filter(Boolean);

  if (!active.length) return { primary: OFF_SESSION, active: [] };
  const primary = [...active]
    .sort((left, right) => left.elapsedMinutes - right.elapsedMinutes || left.label.localeCompare(right.label))[0]
    .label;
  return { primary, active: active.map((entry) => entry.label) };
}

export function isNormalizedTrade(trade) {
  if (!trade || typeof trade !== "object" || Array.isArray(trade)) return false;
  const hasRawOrderShape = (
    Object.hasOwn(trade, "FilledAt") ||
    Object.hasOwn(trade, "PositionDisposition") ||
    Object.hasOwn(trade, "CreationDisposition")
  ) && !Object.hasOwn(trade, "enteredAt");
  if (hasRawOrderShape) return false;
  return [
    "id", "status", "date", "enteredAt", "exitedAt", "netPnl", "brokerPnl",
    "calculatedGrossPnl", "importSource", "externalSource"
  ].some((field) => Object.hasOwn(trade, field));
}

// Source detection deliberately reads normalized metadata only. It does not
// infer Topstep from raw column names, order ids, contract names or filenames.
export function detectNormalizedTradeSource(trade) {
  if (!isNormalizedTrade(trade)) {
    return { key: "invalid", label: "Invalid row", imported: false, topstep: false, kind: null, normalized: false };
  }
  const importSource = String(trade.importSource || "").trim().toLowerCase();
  const externalSource = String(trade.externalSource || "").trim().toLowerCase();
  const source = importSource || externalSource;
  if (source === "topstepx-orders") {
    return { key: "topstepx-orders", label: "TopstepX Orders", imported: true, topstep: true, kind: "orders", normalized: true };
  }
  if (source === "topstepx") {
    return { key: "topstepx", label: "TopstepX Trades", imported: true, topstep: true, kind: "trades", normalized: true };
  }
  if (source) {
    return { key: source, label: String(trade.importSource || trade.externalSource).trim(), imported: true, topstep: false, kind: "import", normalized: true };
  }
  return { key: "manual", label: "Journal", imported: false, topstep: false, kind: "manual", normalized: true };
}

function trustedTimestamp(parsed) {
  return Number.isFinite(parsed?.instantMs) && (parsed.quality === "exact" || parsed.quality === "assumed");
}

function isSessionPlaceholder(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || ["not recorded", "unknown", "unresolved"].includes(normalized);
}

function sourceZoneForTrade(trade, options) {
  const metadataZone = String(trade?.sourceTimezone || "").trim();
  if (isValidTimeZone(metadataZone)) {
    return { id: metadataZone, provenance: "trade-metadata" };
  }
  const confirmedZone = String(options.sourceTimeZone || "").trim();
  if (confirmedZone) {
    return { id: requireTimeZone(confirmedZone), provenance: String(options.sourceTimeZoneProvenance || "confirmed-setting") };
  }
  return { id: "", provenance: "unresolved" };
}

export function resolveTradeTiming(trade, options = {}) {
  const source = detectNormalizedTradeSource(trade);
  const sourceZone = sourceZoneForTrade(trade, options);
  const entry = parseExecutionTimestamp(trade?.enteredAt, { sourceTimeZone: sourceZone.id });
  const exit = parseExecutionTimestamp(trade?.exitedAt, { sourceTimeZone: sourceZone.id });
  const detected = trustedTimestamp(entry)
    ? detectPrimarySession(entry.instantMs, { sessionWindows: options.sessionWindows })
    : { primary: UNRESOLVED_SESSION, active: [] };
  const manualSession = String(trade?.session || "").trim();
  // A resolved execution instant is the authoritative classifier. A manual
  // session is only a fallback for legacy/manual rows with no usable clock.
  const useManualSession = !trustedTimestamp(entry) && !isSessionPlaceholder(manualSession);
  const sessionSource = useManualSession
    ? "manual-fallback"
    : trustedTimestamp(entry) ? "detected-entry" : "unresolved";

  let durationMs = null;
  let durationSource = "unavailable";
  if (source.kind === "trades") {
    durationMs = parseDurationMs(trade?.tradeDuration);
    if (durationMs !== null) durationSource = "topstep-trades";
  } else if (source.kind === "orders") {
    durationMs = parseDurationMs(trade?.reconstructedDuration);
    // A topstepx-orders object is already a normalized flat-to-flat cycle.
    // Raw Orders rows cannot reach this branch because source detection never
    // recognizes raw column signatures.
    if (durationMs === null) {
      durationMs = parseDurationMs(trade?.tradeDuration);
    }
    if (durationMs !== null) durationSource = "reconstructed-fills";
  }
  if (
    durationMs === null && trustedTimestamp(entry) && trustedTimestamp(exit) &&
    exit.instantMs >= entry.instantMs
  ) {
    durationMs = exit.instantMs - entry.instantMs;
    durationSource = "timestamp-diff";
  }

  return {
    entryMs: trustedTimestamp(entry) ? entry.instantMs : null,
    exitMs: trustedTimestamp(exit) ? exit.instantMs : null,
    entryQuality: entry.quality,
    exitQuality: exit.quality,
    entryReason: entry.reason,
    exitReason: exit.reason,
    sourceTimeZone: sourceZone.id,
    sourceTimeZoneSource: sourceZone.provenance,
    session: useManualSession ? manualSession : detected.primary,
    sessionSource,
    detectedSession: detected.primary,
    activeSessions: detected.active.length ? detected.active : useManualSession ? [manualSession] : [],
    durationMs,
    durationSource,
    topstepKind: source.topstep ? source.kind : null,
    source
  };
}

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  const number = Number(value);
  const rounded = Math.round((number + Math.sign(number) * Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function resolvedTopstepCosts(trade) {
  const sourceFees = finiteNumber(trade?.sourceFees);
  const sourceCommissions = finiteNumber(trade?.sourceCommissions);
  const hasSourceFees = sourceFees !== null;
  const hasSourceCommissions = sourceCommissions !== null;
  if (hasSourceFees && hasSourceCommissions) {
    return {
      known: true,
      value: roundTo(Math.abs(sourceFees || 0) + Math.abs(sourceCommissions || 0)),
      source: "source-fees-and-commissions"
    };
  }

  const fees = finiteNumber(trade?.fees);
  const commissions = finiteNumber(trade?.commissions);
  const hasFees = fees !== null;
  const hasCommissions = commissions !== null;
  if (hasFees && hasCommissions) {
    return {
      known: true,
      value: roundTo(Math.abs(fees || 0) + Math.abs(commissions || 0)),
      source: "normalized-fees-and-commissions"
    };
  }

  const costs = finiteNumber(trade?.costs);
  return costs === null
    ? { known: false, value: null, source: "unavailable" }
    : { known: true, value: roundTo(Math.abs(costs)), source: "normalized-cost-total" };
}

// Resolve the amount the report may truthfully aggregate and the exact label
// that must accompany it. In particular, a gross value is never called net.
export function resolveTradePnl(trade) {
  const source = detectNormalizedTradeSource(trade);
  if (!source.normalized) {
    return { value: null, basis: "unavailable", label: "P&L unavailable", estimated: false, provenance: "invalid-row" };
  }

  const reportedNet = finiteNumber(trade?.reportedNetPnl);
  if (reportedNet !== null) {
    return { value: roundTo(reportedNet), basis: "net", label: "Net P&L", estimated: false, provenance: "reported-net-pnl" };
  }

  if (source.kind === "orders") {
    const estimatedNet = finiteNumber(trade?.estimatedNetPnl);
    if (estimatedNet !== null) {
      return {
        value: roundTo(estimatedNet), basis: "estimated-net", label: "Estimated net P&L", estimated: true,
        provenance: String(trade.pnlProvenance || "reconstructed-gross-minus-estimated-costs")
      };
    }
    const recorded = finiteNumber(trade?.netPnl);
    if (trade?.pnlIsEstimated && recorded !== null) {
      return {
        value: roundTo(recorded), basis: "estimated-net", label: "Estimated net P&L", estimated: true,
        provenance: String(trade.pnlProvenance || "persisted-estimated-net-pnl")
      };
    }
    const gross = finiteNumber(trade?.calculatedGrossPnl);
    if (gross !== null) {
      return {
        value: roundTo(gross), basis: "gross", label: "Gross P&L", estimated: false,
        provenance: String(trade.pnlProvenance || "calculated-from-filled-orders")
      };
    }
    return { value: null, basis: "unavailable", label: "P&L unavailable", estimated: false, provenance: "orders-pnl-unavailable" };
  }

  if (source.kind === "trades") {
    const brokerPnl = finiteNumber(trade?.brokerPnl) ?? finiteNumber(trade?.netPnl);
    if (brokerPnl === null) {
      return { value: null, basis: "unavailable", label: "P&L unavailable", estimated: false, provenance: "broker-pnl-unavailable" };
    }
    const costs = resolvedTopstepCosts(trade);
    if (!costs.known) {
      return { value: roundTo(brokerPnl), basis: "broker", label: "Broker P&L", estimated: false, provenance: "topstep-broker-pnl-costs-unavailable" };
    }
    return {
      value: roundTo(brokerPnl - costs.value),
      basis: "net",
      label: "Net P&L",
      estimated: false,
      provenance: `topstep-broker-pnl-minus-${costs.source}`,
      grossValue: roundTo(brokerPnl),
      costs: costs.value
    };
  }

  const basis = String(trade?.pnlBasis || "").toLowerCase();
  const gross = finiteNumber(trade?.calculatedGrossPnl);
  if (basis.includes("gross") && gross !== null) {
    return { value: roundTo(gross), basis: "gross", label: "Gross P&L", estimated: false, provenance: basis };
  }
  const net = finiteNumber(trade?.netPnl);
  return net === null
    ? { value: null, basis: "unavailable", label: "P&L unavailable", estimated: false, provenance: "recorded-pnl-unavailable" }
    : { value: roundTo(net), basis: "net", label: "Net P&L", estimated: false, provenance: String(trade.pnlProvenance || "journal-net-pnl") };
}

export function getConfidenceState(sampleCount, options = {}) {
  const count = Math.max(0, Math.floor(Number(sampleCount) || 0));
  const minimumReliableSamples = Math.max(
    CONFIDENCE_THRESHOLDS.reliable.min,
    Math.floor(Number(options.minimumReliableSamples) || CONFIDENCE_THRESHOLDS.reliable.min)
  );
  if (count === 0) {
    return { key: "none", label: "No data", count, minimumReliableSamples, neededForReliable: minimumReliableSamples };
  }
  if (count >= minimumReliableSamples) {
    return { key: "reliable", label: CONFIDENCE_THRESHOLDS.reliable.label, count, minimumReliableSamples, neededForReliable: 0 };
  }
  if (count >= CONFIDENCE_THRESHOLDS.developing.min) {
    return {
      key: "developing", label: CONFIDENCE_THRESHOLDS.developing.label, count, minimumReliableSamples,
      neededForReliable: minimumReliableSamples - count
    };
  }
  return {
    key: "early", label: CONFIDENCE_THRESHOLDS.early.label, count, minimumReliableSamples,
    neededForReliable: minimumReliableSamples - count
  };
}

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function summarizeDurations(values) {
  const sorted = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!sorted.length) {
    return { count: 0, avgMs: null, medianMs: null, q1Ms: null, q3Ms: null, minMs: null, maxMs: null };
  }
  return {
    count: sorted.length,
    avgMs: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    medianMs: Math.round(quantile(sorted, 0.5)),
    q1Ms: Math.round(quantile(sorted, 0.25)),
    q3Ms: Math.round(quantile(sorted, 0.75)),
    minMs: sorted[0],
    maxMs: sorted.at(-1)
  };
}

function createAccumulator(label) {
  return {
    label,
    pnl: 0,
    count: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    holdTotal: 0,
    holdCount: 0,
    basisCounts: new Map(),
    tradeIds: [],
    sourceIndexes: []
  };
}

function addToAccumulator(bucket, pnl, durationMs, tradeRef) {
  bucket.pnl += pnl.value;
  bucket.count += 1;
  if (pnl.value > 0) bucket.wins += 1;
  else if (pnl.value < 0) bucket.losses += 1;
  else bucket.breakeven += 1;
  if (durationMs !== null) {
    bucket.holdTotal += durationMs;
    bucket.holdCount += 1;
  }
  bucket.basisCounts.set(pnl.basis, (bucket.basisCounts.get(pnl.basis) || 0) + 1);
  if (tradeRef.id) bucket.tradeIds.push(tradeRef.id);
  bucket.sourceIndexes.push(tradeRef.sourceIndex);
}

function summarizePnlBasis(basisCounts) {
  const breakdown = [...basisCounts.entries()]
    .map(([basis, count]) => ({ basis, count }))
    .sort((left, right) => right.count - left.count || left.basis.localeCompare(right.basis));
  const basisSet = new Set(breakdown.map((entry) => entry.basis));
  let basis = "unavailable";
  let label = "P&L unavailable";
  let isNet = false;
  let isEstimated = false;

  if (basisSet.size === 1 && basisSet.has("net")) {
    basis = "net";
    label = "Net P&L";
    isNet = true;
  } else if (basisSet.size === 1 && basisSet.has("estimated-net")) {
    basis = "estimated-net";
    label = "Estimated net P&L";
    isNet = true;
    isEstimated = true;
  } else if ([...basisSet].every((value) => value === "net" || value === "estimated-net") && basisSet.size) {
    basis = "net-with-estimates";
    label = "Net P&L (includes estimates)";
    isNet = true;
    isEstimated = true;
  } else if (basisSet.size === 1 && basisSet.has("gross")) {
    basis = "gross";
    label = "Gross P&L";
  } else if (basisSet.size === 1 && basisSet.has("broker")) {
    basis = "broker";
    label = "Broker P&L";
  } else if (basisSet.size) {
    basis = "mixed";
    label = "Mixed-basis P&L";
    isEstimated = basisSet.has("estimated-net");
  }
  return { basis, label, isNet, isEstimated, breakdown };
}

function finalizeAccumulator(bucket, minimumReliableSamples, extras = {}) {
  const pnlBasis = summarizePnlBasis(bucket.basisCounts);
  return {
    ...extras,
    label: bucket.label,
    pnl: roundTo(bucket.pnl),
    count: bucket.count,
    wins: bucket.wins,
    losses: bucket.losses,
    breakeven: bucket.breakeven,
    winRate: bucket.count ? roundTo((bucket.wins / bucket.count) * 100) : 0,
    expectancy: bucket.count ? roundTo(bucket.pnl / bucket.count) : 0,
    avgHoldMs: bucket.holdCount ? Math.round(bucket.holdTotal / bucket.holdCount) : null,
    confidence: getConfidenceState(bucket.count, { minimumReliableSamples }),
    pnlBasis: pnlBasis.basis,
    pnlLabel: pnlBasis.label,
    pnlEstimated: pnlBasis.isEstimated,
    tradeIds: [...bucket.tradeIds],
    sourceIndexes: [...bucket.sourceIndexes]
  };
}

function strongestFirst(left, right) {
  return right.pnl - left.pnl || right.expectancy - left.expectancy || right.count - left.count ||
    (Number.isFinite(left.hour) && Number.isFinite(right.hour)
      ? left.hour - right.hour
      : left.label.localeCompare(right.label));
}

function weakestFirst(left, right) {
  return left.pnl - right.pnl || left.expectancy - right.expectancy || right.count - left.count ||
    (Number.isFinite(left.hour) && Number.isFinite(right.hour)
      ? left.hour - right.hour
      : left.label.localeCompare(right.label));
}

function rankedRow(rows, { reliable = false, positive = false, negative = false, weakest = false } = {}) {
  return [...rows]
    .filter((row) => row.count > 0)
    .filter((row) => !reliable || row.confidence.key === "reliable")
    .filter((row) => !positive || row.pnl > 0)
    .filter((row) => !negative || row.pnl < 0)
    .sort(weakest ? weakestFirst : strongestFirst)[0] || null;
}

function hourLabel(hour) {
  const next = (hour + 1) % 24;
  return `${String(hour).padStart(2, "0")}:00-${String(next).padStart(2, "0")}:00`;
}

function durationBandFor(durationMs) {
  return DURATION_BANDS.find((band) => durationMs >= band.minMs && durationMs < band.maxMs) || null;
}

function strictDate(value) {
  const date = String(value || "").trim().slice(0, 10);
  if (!DATE_PATTERN.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  return validDateParts(year, month, day) ? date : null;
}

function zonedDateKey(instantMs, timeZone) {
  const parts = getZonedDateParts(instantMs, timeZone);
  return parts
    ? `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
    : null;
}

function shiftIsoDate(dateString, dayDelta) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + dayDelta);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function latestEligibleDate(input, reportTimeZone, configuredSourceZone, sessionWindows) {
  let latest = null;
  const seen = new Set();
  for (const trade of input) {
    const source = detectNormalizedTradeSource(trade);
    if (!source.normalized || String(trade.status || "closed").trim().toLowerCase() === "open" || trade.analyticsExcluded) {
      continue;
    }
    const identity = normalizedTradeIdentity(trade, source);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    const timing = resolveTradeTiming(trade, { sourceTimeZone: configuredSourceZone, sessionWindows });
    const date = timing.entryMs !== null
      ? zonedDateKey(timing.entryMs, reportTimeZone)
      : strictDate(trade.sourceTradeDay) || strictDate(trade.date);
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest;
}

function normalizeDateRange(options, anchorDate = null) {
  const hasExplicitRange = options.dateRange !== undefined || options.dateFrom !== undefined || options.dateTo !== undefined;
  const requested = !hasExplicitRange
    ? "all"
    : typeof options.dateRange === "string"
    ? options.dateRange.trim().toLowerCase()
    : String(options.dateRange?.preset || "").trim().toLowerCase();
  if (requested && !["all", "30d", "90d", "ytd"].includes(requested)) {
    throw new RangeError(`Unsupported date range preset: ${requested}`);
  }
  if (requested) {
    if (requested === "all" || !anchorDate) {
      return {
        preset: requested,
        anchor: anchorDate,
        from: null,
        to: null,
        active: false,
        inclusive: true,
        basis: "entry date in report timezone; source trade date fallback when entry time is unresolved"
      };
    }
    const days = requested === "30d" ? 30 : requested === "90d" ? 90 : null;
    return {
      preset: requested,
      anchor: anchorDate,
      from: days ? shiftIsoDate(anchorDate, -(days - 1)) : `${anchorDate.slice(0, 4)}-01-01`,
      to: anchorDate,
      active: true,
      inclusive: true,
      basis: "entry date in report timezone; source trade date fallback when entry time is unresolved"
    };
  }

  const source = options.dateRange && typeof options.dateRange === "object" ? options.dateRange : {};
  const from = strictDate(source.from ?? options.dateFrom);
  const to = strictDate(source.to ?? options.dateTo);
  const suppliedFrom = String(source.from ?? options.dateFrom ?? "").trim();
  const suppliedTo = String(source.to ?? options.dateTo ?? "").trim();
  if ((suppliedFrom && !from) || (suppliedTo && !to)) throw new RangeError("Date range must use valid YYYY-MM-DD dates");
  if (from && to && from > to) throw new RangeError("Date range start must not be after its end");
  return {
    preset: "custom",
    anchor: anchorDate,
    from,
    to,
    active: Boolean(from || to),
    inclusive: true,
    basis: "entry date in report timezone; source trade date fallback when entry time is unresolved"
  };
}

function normalizedTradeIdentity(trade, source) {
  const account = String(trade?.accountId || "").trim().toLowerCase();
  const importKey = String(trade?.importKey || "").trim().toLowerCase();
  if (importKey) return `import:${importKey}`;
  const externalId = String(trade?.externalTradeId || "").trim().toLowerCase();
  if (source.imported && externalId) return `${source.key}:id:${externalId}:account:${account}`;
  const fingerprint = String(trade?.externalFingerprint || "").trim().toLowerCase();
  if (source.imported && fingerprint) return `${source.key}:fingerprint:${fingerprint}:account:${account}`;
  const id = String(trade?.id || "").trim().toLowerCase();
  return id ? `journal:${id}` : "";
}

function isTradeJournalled(trade) {
  return Boolean(trade?.journalledAt) || Boolean(String(trade?.notes || "").trim());
}

function sourceSummary(sourceCounts) {
  const breakdown = [...sourceCounts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const imported = breakdown.filter((entry) => entry.imported).reduce((sum, entry) => sum + entry.count, 0);
  const topstep = breakdown.filter((entry) => entry.topstep).reduce((sum, entry) => sum + entry.count, 0);
  if (!breakdown.length) {
    return { key: "none", label: "No imported source", imported, topstep, topstepDetected: false, breakdown };
  }
  const only = breakdown.length === 1 ? breakdown[0] : null;
  return {
    key: only?.key || "mixed",
    label: only?.label || "Mixed sources",
    imported,
    topstep,
    topstepDetected: topstep > 0,
    breakdown
  };
}

function addSourceCount(sourceCounts, source) {
  const current = sourceCounts.get(source.key) || {
    key: source.key,
    label: source.label,
    imported: source.imported,
    topstep: source.topstep,
    count: 0
  };
  current.count += 1;
  sourceCounts.set(source.key, current);
}

function insightFor(strongestObserved, reliablePositive, emptyConclusion) {
  if (reliablePositive) {
    return { state: "reliable", conclusion: "reliable edge", row: reliablePositive, confidence: reliablePositive.confidence };
  }
  if (strongestObserved?.pnl > 0) {
    return {
      state: strongestObserved.confidence.key,
      conclusion: strongestObserved.confidence.key === "early" ? "promising early signal" : "developing signal",
      row: strongestObserved,
      confidence: strongestObserved.confidence
    };
  }
  if (strongestObserved) {
    return { state: "no-positive", conclusion: "no profitable result yet", row: strongestObserved, confidence: strongestObserved.confidence };
  }
  return { state: "none", conclusion: emptyConclusion, row: null, confidence: getConfidenceState(0) };
}

function buildHeadline(sessionInsight, entryInsight, durationInsight, pnlLabel) {
  if (sessionInsight.state === "reliable" && entryInsight.state === "reliable" && durationInsight.state === "reliable") {
    return `Your strongest results come from the ${sessionInsight.row.label} session, between ${entryInsight.row.label}, with ${durationInsight.row.label.toLowerCase()} holds leading by ${pnlLabel.toLowerCase()}.`;
  }
  if (sessionInsight.row || entryInsight.row || durationInsight.row) {
    const pieces = [];
    if (sessionInsight.row) pieces.push(`${sessionInsight.row.label} leads sessions`);
    if (entryInsight.row) pieces.push(`${entryInsight.row.label} leads entry time`);
    if (durationInsight.row) pieces.push(`${durationInsight.row.label.toLowerCase()} leads hold time`);
    const prefix = [sessionInsight, entryInsight, durationInsight].some((item) => item.state === "reliable")
      ? "Current read"
      : "Early read";
    return `${prefix}: ${pieces.join(", ")}. Confidence labels show what is repeatable.`;
  }
  return "Import normalized closed trades with entry and exit times to reveal your session, entry-time and hold-time edge.";
}

function missingFieldsFor(timing, pnl, source) {
  return {
    entryTime: timing.entryMs === null,
    exitTime: timing.exitMs === null,
    duration: timing.durationMs === null,
    pnl: pnl.value === null,
    costs: source.topstep && (pnl.basis === "broker" || pnl.basis === "gross"),
    sourceTimeZone: timing.entryReason === "missing-source-time-zone" || timing.exitReason === "missing-source-time-zone"
  };
}

export function buildSessionTimingReport(trades, options = {}) {
  const reportTimeZone = requireTimeZone(options.reportTimeZone, DEFAULT_REPORT_TIME_ZONE);
  const configuredSourceZone = String(options.sourceTimeZone || "").trim();
  if (configuredSourceZone) requireTimeZone(configuredSourceZone);
  const minimumReliableSamples = Math.max(
    CONFIDENCE_THRESHOLDS.reliable.min,
    Math.floor(Number(options.minimumReliableSamples) || CONFIDENCE_THRESHOLDS.reliable.min)
  );
  const sessionWindows = normalizeSessionWindows(options.sessionWindows);
  const input = Array.isArray(trades) ? trades : [];
  // Relative presets anchor to the newest eligible trade, not wall-clock
  // today. A historical import therefore remains visible and deterministic.
  const dateRangeAnchor = latestEligibleDate(input, reportTimeZone, configuredSourceZone, sessionWindows);
  const dateRange = normalizeDateRange(options, dateRangeAnchor);

  const coverage = {
    input: input.length,
    total: 0,
    analyzed: 0,
    timed: 0,
    exact: 0,
    assumed: 0,
    unresolved: 0,
    durationKnown: 0,
    pnlKnown: 0,
    missingPnl: 0,
    topstep: 0,
    imported: 0,
    open: 0,
    analyticsExcluded: 0,
    duplicatesExcluded: 0,
    invalidNormalized: 0,
    outsideDateRange: 0,
    dateUnresolved: 0,
    dateFallback: 0,
    sessionUnresolved: 0,
    sourceTimeZoneUnconfirmed: 0
  };
  const sessions = new Map(SESSION_ROW_LABELS.map((label) => [label, createAccumulator(label)]));
  const hourAccumulators = Array.from({ length: 24 }, (_, hour) => ({ hour, ...createAccumulator(hourLabel(hour)) }));
  const bandAccumulators = new Map(DURATION_BANDS.map((band) => [band.key, createAccumulator(band.label)]));
  const winnerDurations = [];
  const loserDurations = [];
  const sourceCounts = new Map();
  const pnlBasisCounts = new Map();
  const sourceTimeZoneIds = new Set();
  const timezoneEvidence = { explicitOffset: 0, tradeMetadata: 0, confirmedSetting: 0, unresolved: 0, invalid: 0 };
  const seen = new Set();
  const records = [];

  for (let sourceIndex = 0; sourceIndex < input.length; sourceIndex += 1) {
    const trade = input[sourceIndex];
    const source = detectNormalizedTradeSource(trade);
    if (!source.normalized) {
      coverage.invalidNormalized += 1;
      continue;
    }
    if (String(trade.status || "closed").trim().toLowerCase() === "open") {
      coverage.open += 1;
      continue;
    }
    if (trade.analyticsExcluded) {
      coverage.analyticsExcluded += 1;
      continue;
    }
    const identity = normalizedTradeIdentity(trade, source);
    if (identity && seen.has(identity)) {
      coverage.duplicatesExcluded += 1;
      continue;
    }
    if (identity) seen.add(identity);

    const timing = resolveTradeTiming(trade, {
      sourceTimeZone: configuredSourceZone,
      sourceTimeZoneProvenance: options.sourceTimeZoneProvenance,
      sessionWindows
    });
    const pnl = resolveTradePnl(trade);
    let dateKey = null;
    let dateSource = "unresolved";
    if (timing.entryMs !== null) {
      dateKey = zonedDateKey(timing.entryMs, reportTimeZone);
      dateSource = "entry-report-time-zone";
    } else {
      dateKey = strictDate(trade.sourceTradeDay) || strictDate(trade.date);
      if (dateKey) dateSource = "trade-date-fallback";
    }
    if (dateRange.active && !dateKey) {
      coverage.dateUnresolved += 1;
      continue;
    }
    if (dateRange.active && ((dateRange.from && dateKey < dateRange.from) || (dateRange.to && dateKey > dateRange.to))) {
      coverage.outsideDateRange += 1;
      continue;
    }

    coverage.total += 1;
    if (dateSource === "trade-date-fallback") coverage.dateFallback += 1;
    if (source.topstep) coverage.topstep += 1;
    if (source.imported) coverage.imported += 1;
    addSourceCount(sourceCounts, source);

    const needsSourceTimeZone = timing.entryReason === "missing-source-time-zone" ||
      timing.exitReason === "missing-source-time-zone";
    if (timing.entryMs !== null) {
      coverage.timed += 1;
      if (timing.entryQuality === "exact") {
        coverage.exact += 1;
        timezoneEvidence.explicitOffset += 1;
      } else {
        coverage.assumed += 1;
        if (timing.sourceTimeZoneSource === "trade-metadata") timezoneEvidence.tradeMetadata += 1;
        else timezoneEvidence.confirmedSetting += 1;
      }
    } else {
      coverage.unresolved += 1;
      if (!needsSourceTimeZone) {
        timezoneEvidence.invalid += 1;
      }
    }
    if (needsSourceTimeZone) {
      coverage.sourceTimeZoneUnconfirmed += 1;
      timezoneEvidence.unresolved += 1;
    }
    if (timing.sourceTimeZone) sourceTimeZoneIds.add(timing.sourceTimeZone);
    if (timing.durationMs !== null) coverage.durationKnown += 1;
    if (pnl.value === null) coverage.missingPnl += 1;
    else {
      coverage.pnlKnown += 1;
      coverage.analyzed += 1;
      pnlBasisCounts.set(pnl.basis, (pnlBasisCounts.get(pnl.basis) || 0) + 1);
    }

    const id = String(trade.id || "").trim();
    const tradeRef = { id, sourceIndex };
    const missing = missingFieldsFor(timing, pnl, source);
    const record = { trade, sourceIndex, id, source, timing, pnl, dateKey, dateSource, missing, tradeRef };
    records.push(record);

    if (pnl.value === null) continue;
    const sessionLabel = SESSION_ROW_LABELS.includes(timing.session) ? timing.session : UNRESOLVED_SESSION;
    if (sessionLabel === UNRESOLVED_SESSION) coverage.sessionUnresolved += 1;
    else addToAccumulator(sessions.get(sessionLabel), pnl, timing.durationMs, tradeRef);

    if (timing.entryMs !== null) {
      const local = getZonedDateParts(timing.entryMs, reportTimeZone);
      if (local) addToAccumulator(hourAccumulators[local.hour], pnl, timing.durationMs, tradeRef);
    }
    if (timing.durationMs !== null) {
      if (pnl.value > 0) winnerDurations.push(timing.durationMs);
      if (pnl.value < 0) loserDurations.push(timing.durationMs);
      const band = durationBandFor(timing.durationMs);
      if (band) addToAccumulator(bandAccumulators.get(band.key), pnl, timing.durationMs, tradeRef);
    }
  }

  const sessionRows = SESSION_ROW_LABELS.map((label) => finalizeAccumulator(
    sessions.get(label),
    minimumReliableSamples,
    { key: label.toLowerCase().replace(/\s+/g, "-") }
  ));
  const hours = hourAccumulators.map((bucket) => finalizeAccumulator(
    bucket,
    minimumReliableSamples,
    { hour: bucket.hour }
  ));
  const bands = DURATION_BANDS.map((band) => finalizeAccumulator(
    bandAccumulators.get(band.key),
    minimumReliableSamples,
    { key: band.key, minMs: band.minMs, maxMs: Number.isFinite(band.maxMs) ? band.maxMs : null }
  ));

  const bestObservedSession = rankedRow(sessionRows);
  const bestSession = rankedRow(sessionRows, { reliable: true, positive: true });
  const bestObservedHour = rankedRow(hours);
  const reliableBestHour = rankedRow(hours, { reliable: true });
  const bestHour = rankedRow(hours, { reliable: true, positive: true });
  const weakestObservedHour = rankedRow(hours, { negative: true, weakest: true });
  const weakestHour = rankedRow(hours, { reliable: true, negative: true, weakest: true });
  const strongestObservedBand = rankedRow(bands);
  const bestBand = rankedRow(bands, { reliable: true, positive: true });
  const sessionInsight = insightFor(bestObservedSession, bestSession, "no session data");
  const entryInsight = insightFor(bestObservedHour, bestHour, "no entry-time data");
  const durationInsight = insightFor(strongestObservedBand, bestBand, "no hold-time data");
  const pnlBasis = summarizePnlBasis(pnlBasisCounts);
  const reportPnl = records.reduce((sum, record) => sum + (record.pnl.value ?? 0), 0);

  const winnerSummary = summarizeDurations(winnerDurations);
  const loserSummary = summarizeDurations(loserDurations);
  const durationComparisonCount = Math.min(winnerSummary.count, loserSummary.count);
  const durationDifference = winnerSummary.medianMs !== null && loserSummary.medianMs !== null
    ? winnerSummary.medianMs - loserSummary.medianMs
    : null;
  const durationComparison = {
    differenceMs: durationDifference,
    direction: durationDifference === null ? "unavailable" : durationDifference === 0 ? "same" : durationDifference > 0 ? "longer" : "shorter",
    meaningful: durationDifference !== null && Math.abs(durationDifference) >= MINUTE_MS,
    confidence: getConfidenceState(durationComparisonCount, { minimumReliableSamples })
  };

  const journalledRecords = records.filter((record) => isTradeJournalled(record.trade));
  const unjournalledRecords = records.filter((record) => !isTradeJournalled(record.trade));
  const importedRecords = records.filter((record) => record.source.imported);
  const importedIncomplete = importedRecords.filter((record) => Object.values(record.missing).some(Boolean));
  const missingFieldNames = ["entryTime", "exitTime", "duration", "pnl", "costs", "sourceTimeZone"];
  const missingFieldCounts = Object.fromEntries(missingFieldNames.map((field) => [
    field,
    importedRecords.filter((record) => record.missing[field]).length
  ]));
  const byOldest = [...unjournalledRecords].sort((left, right) =>
    (left.timing.entryMs ?? Number.MAX_SAFE_INTEGER) - (right.timing.entryMs ?? Number.MAX_SAFE_INTEGER) ||
    String(left.dateKey || "9999-99-99").localeCompare(String(right.dateKey || "9999-99-99")) ||
    left.sourceIndex - right.sourceIndex
  );
  const recordIds = (rows) => rows.map((record) => record.id).filter(Boolean);
  const recordIndexes = (rows) => rows.map((record) => record.sourceIndex);
  const journalCoverage = {
    total: records.length,
    journaled: journalledRecords.length,
    journalled: journalledRecords.length,
    unjournaled: unjournalledRecords.length,
    unjournalled: unjournalledRecords.length,
    completionPercent: records.length ? roundTo((journalledRecords.length / records.length) * 100, 1) : 0,
    journaledTradeIds: recordIds(journalledRecords),
    journalledTradeIds: recordIds(journalledRecords),
    unjournaledTradeIds: recordIds(unjournalledRecords),
    unjournalledTradeIds: recordIds(unjournalledRecords),
    journaledSourceIndexes: recordIndexes(journalledRecords),
    unjournaledSourceIndexes: recordIndexes(unjournalledRecords),
    imported: {
      total: importedRecords.length,
      missingOrIncomplete: importedIncomplete.length,
      missingOrIncompleteTradeIds: recordIds(importedIncomplete),
      missingOrIncompleteSourceIndexes: recordIndexes(importedIncomplete),
      missingFields: missingFieldCounts
    },
    importedMissingOrIncomplete: importedIncomplete.length,
    importedMissingOrIncompleteTradeIds: recordIds(importedIncomplete),
    nextTradeId: byOldest[0]?.id || null,
    nextSourceIndex: byOldest[0]?.sourceIndex ?? null
  };

  const timeZoneIds = [...sourceTimeZoneIds].sort();
  const timeZones = {
    report: {
      id: reportTimeZone,
      provenance: String(options.reportTimeZoneProvenance || (options.reportTimeZone ? "saved-setting" : "default")),
      daylightSavingAware: true
    },
    source: {
      id: timeZoneIds.length === 1 ? timeZoneIds[0] : null,
      ids: timeZoneIds,
      mode: timeZoneIds.length > 1
        ? "mixed"
        : timeZoneIds.length === 1
          ? "single"
          : timezoneEvidence.explicitOffset
            ? "explicit-offsets"
            : "unresolved",
      configuredId: configuredSourceZone || null,
      configuredProvenance: configuredSourceZone
        ? String(options.sourceTimeZoneProvenance || "confirmed-setting")
        : null,
      requiresConfirmation: coverage.sourceTimeZoneUnconfirmed > 0,
      evidence: timezoneEvidence
    }
  };

  const confidence = getConfidenceState(coverage.analyzed, { minimumReliableSamples });
  const headline = {
    sentence: buildHeadline(sessionInsight, entryInsight, durationInsight, pnlBasis.label),
    confidence,
    session: sessionInsight,
    entryHour: entryInsight,
    holdBand: durationInsight
  };

  return {
    reportTimeZone,
    sourceTimeZone: configuredSourceZone,
    minimumReliableSamples,
    confidenceThresholds: CONFIDENCE_THRESHOLDS,
    confidence,
    dateRange,
    timeZones,
    source: sourceSummary(sourceCounts),
    pnl: {
      value: roundTo(reportPnl),
      basis: pnlBasis.basis,
      label: pnlBasis.label,
      isNet: pnlBasis.isNet,
      isEstimated: pnlBasis.isEstimated,
      knownTrades: coverage.pnlKnown,
      missingTrades: coverage.missingPnl,
      breakdown: pnlBasis.breakdown
    },
    headline,
    sessions: sessionRows,
    hours,
    entryTime: {
      metric: "pnl",
      timeZone: reportTimeZone,
      bestHour,
      strongestObservedHour: bestObservedHour,
      weakestHour,
      weakestObservedHour
    },
    duration: {
      meaning: "Holding time of closed winners and losers, not time spent floating in profit.",
      winners: { ...winnerSummary, confidence: getConfidenceState(winnerSummary.count, { minimumReliableSamples }) },
      losers: { ...loserSummary, confidence: getConfidenceState(loserSummary.count, { minimumReliableSamples }) },
      comparison: durationComparison,
      bands,
      bestBand,
      strongestObservedBand
    },
    journalCoverage,
    coverage,
    // Compatibility aliases used by the existing chart/renderer while the
    // dedicated Session Intelligence page consumes the richer sections above.
    bestObservedHour,
    reliableBestHour,
    bestSession,
    bestObservedSession
  };
}
