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

// These gates are deliberately stricter than a simple trade count. A clock
// pattern seen five times on one day is repeatable within that day, but it is
// not yet repeatable across days. Lifecycle comparisons require both sides to
// clear the normal reliable-sample floor.
export const INSIGHT_THRESHOLDS = Object.freeze({
  reliableDistinctDays: 3,
  consistentPositiveDayRate: 60,
  concentrationWarningShare: 50,
  lifecycleComparisonEachSide: CONFIDENCE_THRESHOLDS.reliable.min
});

// Field-level provenance contract for normalized Topstep records. This list is
// intentionally about persisted trade-cycle metadata; transient raw order ids,
// account names and source arrays are stripped upstream and are never expected
// here. `kind` defines what counts as evidence for the completeness audit.
const field = (name, label, category, appliesTo = "all", kind = "string") =>
  Object.freeze({ field: name, label, category, appliesTo, kind });

export const TOPSTEP_FIELD_DEFINITIONS = Object.freeze([
  field("accountId", "Journal account", "identity"),
  field("importBatchId", "Import batch", "identity"),
  field("importSource", "Import source", "identity"),
  field("externalSource", "External source", "identity"),
  field("importKey", "Import dedupe key", "identity"),
  field("externalTradeId", "Broker trade id", "identity", "trades"),
  field("externalFingerprint", "Stable trade fingerprint", "identity"),
  field("sourceAccountFingerprint", "Account fingerprint", "identity", "orders"),
  field("sourceOrderFingerprints", "Order fingerprints", "identity", "orders", "array"),
  field("status", "Trade status", "trade"),
  field("market", "Market", "trade"),
  field("asset", "Asset", "trade"),
  field("contractName", "Contract name", "trade"),
  field("direction", "Direction", "trade"),
  field("entryPrice", "Entry price", "trade", "all", "number"),
  field("exitPrice", "Exit price", "trade", "all", "number"),
  field("positionSize", "Position size", "trade", "all", "positive-number"),
  field("date", "Journal date", "execution"),
  field("enteredAt", "Entry timestamp", "execution"),
  field("exitedAt", "Exit timestamp", "execution"),
  field("sourceTradeDay", "Broker trade day", "execution"),
  field("sourceTimezone", "Execution timezone", "execution"),
  field("sourceTimezoneProvenance", "Timezone provenance", "execution"),
  field("tradeDuration", "Broker duration", "execution", "trades"),
  field("sourceOrderCount", "Source order count", "lifecycle", "orders", "positive-number"),
  field("roundTurnQuantity", "Round-turn quantity", "lifecycle", "orders", "positive-number"),
  field("entryFillCount", "Entry fill count", "lifecycle", "orders", "positive-number"),
  field("exitFillCount", "Exit fill count", "lifecycle", "orders", "positive-number"),
  field("peakPositionSize", "Peak position size", "lifecycle", "orders", "positive-number"),
  field("reconstructionMethod", "Reconstruction method", "lifecycle", "orders"),
  field("reconstructedDuration", "Reconstructed duration", "lifecycle", "orders"),
  field("sourceTradeDayTimezone", "Trade-day timezone", "lifecycle", "orders"),
  field("sourceFullDayConfirmed", "Full-day export confirmation", "lifecycle", "orders", "boolean"),
  field("sourceFullDayConfirmedAt", "Full-day confirmation time", "lifecycle", "orders"),
  field("contractMultiplier", "Contract multiplier", "pnl", "orders", "positive-number"),
  field("pnlProvenance", "P&L provenance", "pnl"),
  field("pnlBasis", "P&L basis", "pnl"),
  field("pnlIsEstimated", "Estimated P&L flag", "pnl", "all", "boolean"),
  field("analyticsExcluded", "Analytics exclusion flag", "pnl", "all", "boolean"),
  field("netPnl", "Persisted journal P&L", "pnl", "all", "number"),
  field("calculatedGrossPnl", "Calculated gross P&L", "pnl", "orders", "number"),
  field("estimatedNetPnl", "Estimated net P&L", "pnl", "orders", "number"),
  field("brokerPnl", "Broker P&L", "pnl", "trades", "number"),
  field("reportedNetPnl", "Reported net P&L", "pnl", "all", "number"),
  field("costProvenance", "Cost provenance", "costs", "orders"),
  field("costScheduleUrl", "Cost schedule URL", "costs", "orders"),
  field("costScheduleAsOf", "Cost schedule as-of", "costs", "orders"),
  field("costScheduleEffectiveFrom", "Cost schedule effective date", "costs", "orders"),
  field("costScheduleVerifiedThrough", "Cost schedule verification horizon", "costs", "orders"),
  field("estimatedFeeRate", "Estimated fee rate", "costs", "orders", "number"),
  field("estimatedCommissionRate", "Estimated commission rate", "costs", "orders", "number"),
  field("costAccountClass", "Cost account class", "costs", "orders"),
  field("costEstimateUnavailableReason", "Cost estimate unavailable reason", "costs", "orders"),
  field("estimatedFees", "Estimated fees", "costs", "orders", "number"),
  field("estimatedCommissions", "Estimated commissions", "costs", "orders", "number"),
  field("estimatedCosts", "Estimated total costs", "costs", "orders", "number"),
  field("sourceFees", "Broker fees", "costs", "trades", "number"),
  field("sourceCommissions", "Broker commissions", "costs", "trades", "number"),
  field("fees", "Normalized fees", "costs", "trades", "number"),
  field("commissions", "Normalized commissions", "costs", "trades", "number"),
  field("costs", "Normalized total costs", "costs", "trades", "number")
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

function hasRawOrderRowShape(trade) {
  return Boolean(trade && typeof trade === "object" && !Array.isArray(trade) && (
    Object.hasOwn(trade, "FilledAt") ||
    Object.hasOwn(trade, "PositionDisposition") ||
    Object.hasOwn(trade, "CreationDisposition")
  ) && !Object.hasOwn(trade, "enteredAt"));
}

export function isNormalizedTrade(trade) {
  if (!trade || typeof trade !== "object" || Array.isArray(trade)) return false;
  if (hasRawOrderRowShape(trade)) return false;
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

  // A partially preserved source pair cannot be completed with normalized
  // zero defaults: zero may mean "not captured" after persistence. Likewise,
  // buildTradeRecord stamps `pnlBasis: broker` when original cost evidence was
  // absent. In both cases the honest result is broker P&L, not derived net.
  const declaredBasis = String(trade?.pnlBasis || "").trim().toLowerCase();
  if (hasSourceFees !== hasSourceCommissions || declaredBasis === "broker") {
    return { known: false, value: null, source: "unavailable" };
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

export function getConsistencyConfidenceState(sampleCount, distinctDays, options = {}) {
  const base = getConfidenceState(sampleCount, options);
  const dayCount = Math.max(0, Math.floor(Number(distinctDays) || 0));
  const minimumReliableDays = Math.max(
    INSIGHT_THRESHOLDS.reliableDistinctDays,
    Math.floor(Number(options.minimumReliableDays) || INSIGHT_THRESHOLDS.reliableDistinctDays)
  );
  if (base.key === "none" || dayCount === 0) {
    return {
      ...base,
      key: "none",
      label: "No cross-day evidence",
      distinctDays: dayCount,
      minimumReliableDays,
      neededDaysForReliable: minimumReliableDays
    };
  }
  if (base.key === "reliable" && dayCount >= minimumReliableDays) {
    return {
      ...base,
      distinctDays: dayCount,
      minimumReliableDays,
      neededDaysForReliable: 0
    };
  }
  return {
    ...base,
    key: base.key === "early" ? "early" : "developing",
    label: base.key === "early" ? CONFIDENCE_THRESHOLDS.early.label : CONFIDENCE_THRESHOLDS.developing.label,
    distinctDays: dayCount,
    minimumReliableDays,
    neededDaysForReliable: Math.max(0, minimumReliableDays - dayCount)
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
    pnlValues: [],
    dailyPnl: new Map(),
    datedTrades: 0,
    tradeIds: [],
    sourceIndexes: []
  };
}

function addToAccumulator(bucket, pnl, durationMs, tradeRef, dateKey = null) {
  bucket.pnl += pnl.value;
  bucket.count += 1;
  bucket.pnlValues.push(pnl.value);
  if (pnl.value > 0) bucket.wins += 1;
  else if (pnl.value < 0) bucket.losses += 1;
  else bucket.breakeven += 1;
  if (durationMs !== null) {
    bucket.holdTotal += durationMs;
    bucket.holdCount += 1;
  }
  bucket.basisCounts.set(pnl.basis, (bucket.basisCounts.get(pnl.basis) || 0) + 1);
  if (dateKey) {
    bucket.dailyPnl.set(dateKey, (bucket.dailyPnl.get(dateKey) || 0) + pnl.value);
    bucket.datedTrades += 1;
  }
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
  const sortedPnl = [...bucket.pnlValues].sort((left, right) => left - right);
  const dailyValues = [...bucket.dailyPnl.values()];
  const profitableDays = dailyValues.filter((value) => value > 0).length;
  const losingDays = dailyValues.filter((value) => value < 0).length;
  const flatDays = dailyValues.filter((value) => value === 0).length;
  const distinctDays = dailyValues.length;
  const positivePnl = bucket.pnlValues.filter((value) => value > 0);
  const grossProfit = positivePnl.reduce((sum, value) => sum + value, 0);
  const largestWinner = positivePnl.length ? Math.max(...positivePnl) : null;
  const consistencyConfidence = getConsistencyConfidenceState(bucket.count, distinctDays, {
    minimumReliableSamples
  });
  const medianPnl = sortedPnl.length ? roundTo(quantile(sortedPnl, 0.5)) : null;
  const profitableDayRate = distinctDays ? roundTo((profitableDays / distinctDays) * 100, 1) : null;
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
    medianPnl,
    avgHoldMs: bucket.holdCount ? Math.round(bucket.holdTotal / bucket.holdCount) : null,
    confidence: getConfidenceState(bucket.count, { minimumReliableSamples }),
    consistencyConfidence,
    distinctDays,
    profitableDays,
    losingDays,
    flatDays,
    datedTrades: bucket.datedTrades,
    undatedTrades: bucket.count - bucket.datedTrades,
    profitableDayRate,
    largestWinner: largestWinner === null ? null : roundTo(largestWinner),
    largestWinnerSharePct: grossProfit > 0 ? roundTo((largestWinner / grossProfit) * 100, 1) : null,
    consistentPositive: consistencyConfidence.key === "reliable" && bucket.pnl > 0 &&
      medianPnl > 0 && profitableDayRate >= INSIGHT_THRESHOLDS.consistentPositiveDayRate,
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

function consistentFirst(left, right) {
  return (right.profitableDayRate ?? -1) - (left.profitableDayRate ?? -1) ||
    (right.medianPnl ?? -Infinity) - (left.medianPnl ?? -Infinity) ||
    right.pnl - left.pnl || right.count - left.count ||
    (Number.isFinite(left.hour) && Number.isFinite(right.hour)
      ? left.hour - right.hour
      : left.label.localeCompare(right.label));
}

function buildEntryConsistency(hours) {
  const observedPositive = hours
    .filter((row) => row.count > 0 && row.pnl > 0)
    .sort(consistentFirst);
  const reliablePositive = observedPositive.filter((row) => row.consistentPositive);
  const concentrationRiskHours = hours
    .filter((row) => row.count > 1 && row.largestWinnerSharePct !== null &&
      row.largestWinnerSharePct >= INSIGHT_THRESHOLDS.concentrationWarningShare)
    .sort((left, right) => right.largestWinnerSharePct - left.largestWinnerSharePct || consistentFirst(left, right));
  return {
    meaning: "Cross-day entry-hour consistency. A reliable result needs both the trade-count floor and activity on at least three distinct report-timezone dates.",
    minimumDistinctDays: INSIGHT_THRESHOLDS.reliableDistinctDays,
    positiveDayRateThreshold: INSIGHT_THRESHOLDS.consistentPositiveDayRate,
    concentrationWarningShare: INSIGHT_THRESHOLDS.concentrationWarningShare,
    mostConsistentHour: reliablePositive[0] || null,
    strongestObservedHour: observedPositive[0] || null,
    reliableHours: hours.filter((row) => row.consistencyConfidence.key === "reliable").length,
    concentrationRiskHours
  };
}

function numericAboveZero(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function lifecycleEntryKey(trade) {
  const entryFillCount = numericAboveZero(trade?.entryFillCount);
  const roundTurnQuantity = numericAboveZero(trade?.roundTurnQuantity);
  const peakPositionSize = numericAboveZero(trade?.peakPositionSize);
  if (roundTurnQuantity !== null && peakPositionSize !== null && roundTurnQuantity > peakPositionSize) {
    return "re-entry-after-partial-exit";
  }
  if (entryFillCount === 1) return "single-fill-entry";
  if (entryFillCount !== null && entryFillCount > 1) return "multi-fill-entry";
  return "unknown-entry-structure";
}

function lifecycleExitKey(trade) {
  const exitFillCount = numericAboveZero(trade?.exitFillCount);
  if (exitFillCount === 1) return "single-fill-exit";
  if (exitFillCount !== null && exitFillCount > 1) return "multi-fill-exit";
  return "unknown-exit-structure";
}

function peakSizeKey(trade) {
  const peak = numericAboveZero(trade?.peakPositionSize);
  if (peak === null) return "unknown-peak-size";
  if (peak === 1) return "peak-1";
  if (peak < 4) return "peak-2-3";
  return "peak-4-plus";
}

function createSegmentMap(definitions) {
  return new Map(definitions.map((definition) => [definition.key, createAccumulator(definition.label)]));
}

function finalizedSegments(definitions, accumulators, minimumReliableSamples) {
  return definitions.map((definition) => finalizeAccumulator(
    accumulators.get(definition.key),
    minimumReliableSamples,
    { key: definition.key, meaning: definition.meaning }
  ));
}

function compareSegments(left, right, minimumReliableSamples) {
  const sampleFloor = Math.max(INSIGHT_THRESHOLDS.lifecycleComparisonEachSide, minimumReliableSamples);
  const available = Boolean(left?.count && right?.count);
  const confidence = getConfidenceState(available ? Math.min(left.count, right.count) : 0, {
    minimumReliableSamples: sampleFloor
  });
  const basisComparable = available && left.pnlBasis === right.pnlBasis && left.pnlBasis !== "unavailable";
  const sampleReliable = confidence.key === "reliable";
  const reliable = sampleReliable && basisComparable;
  const expectancyDelta = available ? roundTo(left.expectancy - right.expectancy) : null;
  const winRateDelta = available ? roundTo(left.winRate - right.winRate, 1) : null;
  const pnlDelta = available ? roundTo(left.pnl - right.pnl) : null;
  const favoredKey = reliable && expectancyDelta !== 0
    ? expectancyDelta > 0 ? left.key : right.key
    : null;
  const conclusion = !available
    ? "Both segments need measured trades before they can be compared."
    : !sampleReliable
      ? `Developing only: each segment needs at least ${sampleFloor} measured trades.`
      : !basisComparable
        ? "Samples are sufficient, but their P&L bases differ; no winner is declared."
        : expectancyDelta === 0
          ? "Reliable sample sizes; expectancy is tied."
          : `${favoredKey === left.key ? left.label : right.label} has higher expectancy at reliable sample sizes.`;
  return {
    available,
    reliable,
    leftKey: left?.key || null,
    rightKey: right?.key || null,
    sampleFloor,
    basisComparable,
    leftPnlBasis: left?.pnlBasis || "unavailable",
    rightPnlBasis: right?.pnlBasis || "unavailable",
    expectancyDelta,
    winRateDelta,
    pnlDelta,
    favoredKey,
    confidence,
    conclusion
  };
}

function normalizedFingerprints(trade) {
  return Array.isArray(trade?.sourceOrderFingerprints)
    ? [...new Set(trade.sourceOrderFingerprints.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))]
    : [];
}

function buildLifecycleAnalysis(records, minimumReliableSamples) {
  const ordersRecords = records.filter((record) => record.source.kind === "orders");
  const analyzedOrders = ordersRecords.filter((record) => record.pnl.value !== null);
  const entryDefinitions = [
    { key: "single-fill-entry", label: "Single-fill entry", meaning: "One recorded opening fill." },
    { key: "multi-fill-entry", label: "Multi-fill entry", meaning: "More than one recorded opening fill; this does not prove scale-in intent." },
    { key: "re-entry-after-partial-exit", label: "Re-entry after partial exit", meaning: "Round-turn quantity exceeded peak size, proving quantity was reopened after an earlier reduction." },
    { key: "unknown-entry-structure", label: "Entry structure unavailable", meaning: "Opening fill or size evidence is incomplete." }
  ];
  const exitDefinitions = [
    { key: "single-fill-exit", label: "Single-fill exit", meaning: "One recorded closing fill." },
    { key: "multi-fill-exit", label: "Multi-fill exit", meaning: "More than one recorded closing fill; this does not identify discretionary scaling intent." },
    { key: "unknown-exit-structure", label: "Exit structure unavailable", meaning: "Closing fill evidence is incomplete." }
  ];
  const peakDefinitions = [
    { key: "peak-1", label: "Peak size: 1", meaning: "Maximum reconstructed open quantity was one contract." },
    { key: "peak-2-3", label: "Peak size: 2-3", meaning: "Maximum reconstructed open quantity was two or three contracts." },
    { key: "peak-4-plus", label: "Peak size: 4+", meaning: "Maximum reconstructed open quantity was four or more contracts." },
    { key: "unknown-peak-size", label: "Peak size unavailable", meaning: "Peak reconstructed quantity is missing." }
  ];
  const entryAccumulators = createSegmentMap(entryDefinitions);
  const exitAccumulators = createSegmentMap(exitDefinitions);
  const peakAccumulators = createSegmentMap(peakDefinitions);
  const reentryDefinitions = [
    { key: "re-entry", label: "Re-entry observed", meaning: "Round-turn quantity exceeded peak size." },
    { key: "no-re-entry", label: "No re-entry observed", meaning: "Round-turn quantity did not exceed peak size." }
  ];
  const peakComparisonDefinitions = [
    { key: "peak-one", label: "Peak size: 1", meaning: "Peak reconstructed quantity was one contract." },
    { key: "peak-multiple", label: "Peak size: 2+", meaning: "Peak reconstructed quantity was at least two contracts." }
  ];
  const reentryAccumulators = createSegmentMap(reentryDefinitions);
  const peakComparisonAccumulators = createSegmentMap(peakComparisonDefinitions);

  for (const record of analyzedOrders) {
    const entryKey = lifecycleEntryKey(record.trade);
    const peakKey = peakSizeKey(record.trade);
    addToAccumulator(entryAccumulators.get(entryKey), record.pnl, record.timing.durationMs, record.tradeRef, record.dateKey);
    addToAccumulator(exitAccumulators.get(lifecycleExitKey(record.trade)), record.pnl, record.timing.durationMs, record.tradeRef, record.dateKey);
    addToAccumulator(peakAccumulators.get(peakKey), record.pnl, record.timing.durationMs, record.tradeRef, record.dateKey);
    if (entryKey !== "unknown-entry-structure") {
      addToAccumulator(
        reentryAccumulators.get(entryKey === "re-entry-after-partial-exit" ? "re-entry" : "no-re-entry"),
        record.pnl,
        record.timing.durationMs,
        record.tradeRef,
        record.dateKey
      );
    }
    if (peakKey !== "unknown-peak-size") {
      addToAccumulator(
        peakComparisonAccumulators.get(peakKey === "peak-1" ? "peak-one" : "peak-multiple"),
        record.pnl,
        record.timing.durationMs,
        record.tradeRef,
        record.dateKey
      );
    }
  }

  const entrySegments = finalizedSegments(entryDefinitions, entryAccumulators, minimumReliableSamples);
  const exitSegments = finalizedSegments(exitDefinitions, exitAccumulators, minimumReliableSamples);
  const peakSegments = finalizedSegments(peakDefinitions, peakAccumulators, minimumReliableSamples);
  const entryByKey = new Map(entrySegments.map((row) => [row.key, row]));
  const exitByKey = new Map(exitSegments.map((row) => [row.key, row]));
  const reentrySegments = finalizedSegments(reentryDefinitions, reentryAccumulators, minimumReliableSamples);
  const reentryByKey = new Map(reentrySegments.map((row) => [row.key, row]));
  const peakComparisonSegments = finalizedSegments(
    peakComparisonDefinitions,
    peakComparisonAccumulators,
    minimumReliableSamples
  );
  const peakComparisonByKey = new Map(peakComparisonSegments.map((row) => [row.key, row]));

  const fingerprintOwners = new Map();
  for (const record of ordersRecords) {
    for (const fingerprint of normalizedFingerprints(record.trade)) {
      const owners = fingerprintOwners.get(fingerprint) || new Set();
      owners.add(record.sourceIndex);
      fingerprintOwners.set(fingerprint, owners);
    }
  }
  const linkedIndexes = new Set();
  for (const owners of fingerprintOwners.values()) {
    if (owners.size > 1) for (const sourceIndex of owners) linkedIndexes.add(sourceIndex);
  }
  const reversalDefinitions = [
    { key: "reversal-linked", label: "Shared-fill / reversal-linked", meaning: "This cycle shares a stable source-order fingerprint with another reconstructed cycle." },
    { key: "standalone-orders", label: "Standalone reconstructed cycle", meaning: "No source-order fingerprint is shared with another included cycle." }
  ];
  const reversalAccumulators = createSegmentMap(reversalDefinitions);
  const evaluableRecords = analyzedOrders.filter((record) => normalizedFingerprints(record.trade).length > 0);
  for (const record of evaluableRecords) {
    const key = linkedIndexes.has(record.sourceIndex) ? "reversal-linked" : "standalone-orders";
    addToAccumulator(reversalAccumulators.get(key), record.pnl, record.timing.durationMs, record.tradeRef, record.dateKey);
  }
  const reversalSegments = finalizedSegments(reversalDefinitions, reversalAccumulators, minimumReliableSamples);
  const reversalByKey = new Map(reversalSegments.map((row) => [row.key, row]));
  const linkedRecords = ordersRecords.filter((record) => linkedIndexes.has(record.sourceIndex));

  const peakMeasured = peakSegments.filter((row) => row.key !== "unknown-peak-size");
  return {
    meaning: "Lifecycle evidence comes only from normalized Topstep Orders trade cycles. Fill counts describe executions, not trader intent.",
    source: "topstepx-orders-normalized-cycles",
    scaleInIntentSupported: false,
    coverage: {
      ordersTrades: ordersRecords.length,
      analyzed: analyzedOrders.length,
      entryStructureKnown: ordersRecords.filter((record) => lifecycleEntryKey(record.trade) !== "unknown-entry-structure").length,
      exitStructureKnown: ordersRecords.filter((record) => lifecycleExitKey(record.trade) !== "unknown-exit-structure").length,
      peakSizeKnown: ordersRecords.filter((record) => peakSizeKey(record.trade) !== "unknown-peak-size").length,
      reversalLinkEvaluable: ordersRecords.filter((record) => normalizedFingerprints(record.trade).length > 0).length,
      reversalLinked: linkedRecords.length
    },
    entryStructure: {
      segments: entrySegments,
      singleVsMultiFill: compareSegments(
        entryByKey.get("single-fill-entry"),
        entryByKey.get("multi-fill-entry"),
        minimumReliableSamples
      ),
      reentrySegments,
      reentryVsNoReentry: compareSegments(
        reentryByKey.get("re-entry"),
        reentryByKey.get("no-re-entry"),
        minimumReliableSamples
      )
    },
    exitStructure: {
      segments: exitSegments,
      singleVsMultiFill: compareSegments(
        exitByKey.get("single-fill-exit"),
        exitByKey.get("multi-fill-exit"),
        minimumReliableSamples
      )
    },
    peakSize: {
      segments: peakSegments,
      bestReliableBand: rankedRow(peakMeasured, { reliable: true, positive: true }),
      strongestObservedBand: rankedRow(peakMeasured),
      comparisonSegments: peakComparisonSegments,
      oneVsMultiple: compareSegments(
        peakComparisonByKey.get("peak-one"),
        peakComparisonByKey.get("peak-multiple"),
        minimumReliableSamples
      )
    },
    reversal: {
      method: "Two normalized cycles are linked only when they share a persisted sourceOrderFingerprint from upstream reconstruction.",
      segments: reversalSegments,
      comparison: compareSegments(
        reversalByKey.get("reversal-linked"),
        reversalByKey.get("standalone-orders"),
        minimumReliableSamples
      ),
      linkedTradeIds: linkedRecords.map((record) => record.id).filter(Boolean),
      linkedSourceIndexes: linkedRecords.map((record) => record.sourceIndex),
      confidence: getConfidenceState(linkedRecords.length, { minimumReliableSamples })
    }
  };
}

function fieldApplies(definition, source) {
  return definition.appliesTo === "all" || definition.appliesTo === source.kind;
}

function fieldValueAvailable(trade, definition) {
  const value = trade?.[definition.field];
  if (definition.kind === "boolean") return Object.hasOwn(trade || {}, definition.field) && typeof value === "boolean";
  if (definition.kind === "array") return Array.isArray(value) && value.length > 0;
  if (definition.kind === "number") return finiteNumber(value) !== null;
  if (definition.kind === "positive-number") return numericAboveZero(value) !== null;
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (definition.field === "sourceTimezone") return isValidTimeZone(text);
  if (definition.field === "sourceTimezoneProvenance") return !["unknown", "unresolved"].includes(text.toLowerCase());
  return true;
}

function buildDataQuality(records, rawOrderRowsExcluded, invalidNormalizedRowsExcluded) {
  const topstepRecords = records.filter((record) => record.source.topstep);
  const tradesRecords = topstepRecords.filter((record) => record.source.kind === "trades");
  const ordersRecords = topstepRecords.filter((record) => record.source.kind === "orders");
  const recordIds = (rows) => rows.map((record) => record.id).filter(Boolean);
  const recordIndexes = (rows) => rows.map((record) => record.sourceIndex);
  const percent = (value, total) => total ? roundTo((value / total) * 100, 1) : 0;
  const fieldCoverage = {};

  for (const definition of TOPSTEP_FIELD_DEFINITIONS) {
    const applicableRecords = topstepRecords.filter((record) => fieldApplies(definition, record.source));
    const availableRecords = applicableRecords.filter((record) => fieldValueAvailable(record.trade, definition));
    const missingRecords = applicableRecords.filter((record) => !fieldValueAvailable(record.trade, definition));
    fieldCoverage[definition.field] = {
      label: definition.label,
      category: definition.category,
      appliesTo: definition.appliesTo,
      kind: definition.kind,
      available: availableRecords.length,
      applicable: applicableRecords.length,
      missing: missingRecords.length,
      percent: percent(availableRecords.length, applicableRecords.length),
      availableTradeIds: recordIds(availableRecords),
      availableSourceIndexes: recordIndexes(availableRecords),
      missingTradeIds: recordIds(missingRecords),
      missingSourceIndexes: recordIndexes(missingRecords)
    };
  }

  const exactEntries = topstepRecords.filter((record) => record.timing.entryQuality === "exact");
  const assumedEntries = topstepRecords.filter((record) => record.timing.entryQuality === "assumed");
  const unresolvedEntries = topstepRecords.filter((record) => record.timing.entryMs === null);
  const exactExits = topstepRecords.filter((record) => record.timing.exitQuality === "exact");
  const assumedExits = topstepRecords.filter((record) => record.timing.exitQuality === "assumed");
  const unresolvedExits = topstepRecords.filter((record) => record.timing.exitMs === null);
  const durationKnown = topstepRecords.filter((record) => record.timing.durationMs !== null);
  const executionComplete = topstepRecords.filter((record) =>
    record.timing.entryMs !== null && record.timing.exitMs !== null && record.timing.durationMs !== null
  );
  const basisCount = (basis) => topstepRecords.filter((record) => record.pnl.basis === basis).length;
  const pnlKnown = topstepRecords.filter((record) => record.pnl.value !== null);
  const lifecycleComplete = ordersRecords.filter((record) =>
    numericAboveZero(record.trade.sourceOrderCount) !== null &&
    numericAboveZero(record.trade.roundTurnQuantity) !== null &&
    numericAboveZero(record.trade.entryFillCount) !== null &&
    numericAboveZero(record.trade.exitFillCount) !== null &&
    numericAboveZero(record.trade.peakPositionSize) !== null &&
    Boolean(String(record.trade.reconstructionMethod || "").trim())
  );
  const stableIdentity = topstepRecords.filter((record) =>
    Boolean(String(record.trade.importKey || record.trade.externalTradeId || record.trade.externalFingerprint || "").trim())
  );

  return {
    grain: "one normalized closed trade cycle after report date filtering and exact-identity deduplication",
    topstepTrades: tradesRecords.length,
    topstepOrders: ordersRecords.length,
    rawOrderRowsExcluded,
    invalidNormalizedRowsExcluded,
    identity: {
      stable: stableIdentity.length,
      missing: topstepRecords.length - stableIdentity.length,
      percent: percent(stableIdentity.length, topstepRecords.length)
    },
    execution: {
      total: topstepRecords.length,
      entry: { exact: exactEntries.length, assumed: assumedEntries.length, unresolved: unresolvedEntries.length },
      exit: { exact: exactExits.length, assumed: assumedExits.length, unresolved: unresolvedExits.length },
      durationKnown: durationKnown.length,
      complete: executionComplete.length,
      completePercent: percent(executionComplete.length, topstepRecords.length),
      incompleteTradeIds: recordIds(topstepRecords.filter((record) => !executionComplete.includes(record))),
      incompleteSourceIndexes: recordIndexes(topstepRecords.filter((record) => !executionComplete.includes(record)))
    },
    pnlAndCosts: {
      total: topstepRecords.length,
      known: pnlKnown.length,
      knownPercent: percent(pnlKnown.length, topstepRecords.length),
      exactNet: basisCount("net"),
      estimatedNet: basisCount("estimated-net"),
      grossOnly: basisCount("gross"),
      brokerOnly: basisCount("broker"),
      missing: basisCount("unavailable"),
      netBasisPercent: percent(basisCount("net") + basisCount("estimated-net"), topstepRecords.length),
      meaning: "Exact net subtracts evidenced costs from broker P&L; estimated net uses provenance-stamped Orders cost estimates. Gross-only and broker-only results are never relabeled net."
    },
    lifecycle: {
      applicableOrders: ordersRecords.length,
      complete: lifecycleComplete.length,
      completePercent: percent(lifecycleComplete.length, ordersRecords.length),
      fingerprintKnown: ordersRecords.filter((record) => normalizedFingerprints(record.trade).length > 0).length,
      fullDayConfirmed: ordersRecords.filter((record) => record.trade.sourceFullDayConfirmed === true).length,
      fullDayConfirmationMeaning: "A user attestation that the imported Orders file covered the complete trade day; it is not independent broker verification."
    },
    fieldCoverage,
    limitations: [
      "Presence coverage is reported field by field; optional provenance fields are not combined into a synthetic quality score.",
      "Raw Orders rows are excluded. Lifecycle analytics use only upstream normalized flat-to-flat cycles.",
      "Endpoint entry and exit values do not reveal the intratrade price or unrealized-P&L path."
    ]
  };
}

function buildSessionHoldInteraction(records, minimumReliableSamples) {
  const cellMap = new Map();
  for (const sessionLabel of SESSION_ROW_LABELS) {
    for (const band of DURATION_BANDS) {
      cellMap.set(`${sessionLabel}:${band.key}`, createAccumulator(`${sessionLabel} · ${band.label}`));
    }
  }
  let eligibleTrades = 0;
  for (const record of records) {
    if (record.pnl.value === null || record.timing.durationMs === null || !SESSION_ROW_LABELS.includes(record.timing.session)) continue;
    const band = durationBandFor(record.timing.durationMs);
    if (!band) continue;
    eligibleTrades += 1;
    addToAccumulator(
      cellMap.get(`${record.timing.session}:${band.key}`),
      record.pnl,
      record.timing.durationMs,
      record.tradeRef,
      record.dateKey
    );
  }
  const cells = SESSION_ROW_LABELS.flatMap((sessionLabel) => DURATION_BANDS.map((band) => finalizeAccumulator(
    cellMap.get(`${sessionLabel}:${band.key}`),
    minimumReliableSamples,
    {
      key: `${sessionLabel.toLowerCase().replace(/\s+/g, "-")}:${band.key}`,
      sessionKey: sessionLabel.toLowerCase().replace(/\s+/g, "-"),
      sessionLabel,
      durationKey: band.key,
      durationLabel: band.label,
      minMs: band.minMs,
      maxMs: Number.isFinite(band.maxMs) ? band.maxMs : null
    }
  )));
  return {
    meaning: "P&L by detected venue session and completed-trade holding-time band. The best cell is shown only after the reliable sample floor.",
    cells,
    bestCell: rankedRow(cells, { reliable: true, positive: true }),
    strongestObservedCell: rankedRow(cells),
    coverage: {
      eligibleTrades,
      populatedCells: cells.filter((cell) => cell.count > 0).length,
      reliableCells: cells.filter((cell) => cell.confidence.key === "reliable").length,
      totalCells: cells.length
    }
  };
}

function pathDependentCapabilities(records) {
  const winnerRecords = records.filter((record) => record.pnl.value !== null && record.pnl.value > 0);
  const tradeIds = winnerRecords.map((record) => record.id).filter(Boolean);
  const sourceIndexes = winnerRecords.map((record) => record.sourceIndex);
  return {
    winnerGiveback: {
      supported: false,
      value: null,
      measuredTrades: 0,
      eligibleWinnerTrades: winnerRecords.length,
      tradeIds,
      sourceIndexes,
      endpointOnly: true,
      reason: "Entry, exit and final P&L do not reveal peak unrealized profit or the intratrade price path.",
      requires: ["broker MFE or peak-unrealized-P&L data", "intratrade price path"]
    },
    timeAboveBreakeven: {
      supported: false,
      value: null,
      measuredTrades: 0,
      eligibleTrades: records.filter((record) => record.timing.entryMs !== null && record.timing.exitMs !== null).length,
      endpointOnly: true,
      reason: "Two execution endpoints cannot measure how long a position's unrealized P&L stayed above zero.",
      requires: ["timestamped intratrade position P&L or price path"]
    },
    maximumFavorableExcursion: {
      supported: false,
      value: null,
      measuredTrades: 0,
      endpointOnly: true,
      reason: "No preserved normalized Topstep field contains MFE."
    },
    maximumAdverseExcursion: {
      supported: false,
      value: null,
      measuredTrades: 0,
      endpointOnly: true,
      reason: "No preserved normalized Topstep field contains MAE."
    }
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
    rawOrderRowsExcluded: 0,
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
      if (hasRawOrderRowShape(trade)) coverage.rawOrderRowsExcluded += 1;
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
    else addToAccumulator(sessions.get(sessionLabel), pnl, timing.durationMs, tradeRef, dateKey);

    if (timing.entryMs !== null) {
      const local = getZonedDateParts(timing.entryMs, reportTimeZone);
      if (local) addToAccumulator(hourAccumulators[local.hour], pnl, timing.durationMs, tradeRef, dateKey);
    }
    if (timing.durationMs !== null) {
      if (pnl.value > 0) winnerDurations.push(timing.durationMs);
      if (pnl.value < 0) loserDurations.push(timing.durationMs);
      const band = durationBandFor(timing.durationMs);
      if (band) addToAccumulator(bandAccumulators.get(band.key), pnl, timing.durationMs, tradeRef, dateKey);
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
  const entryConsistency = buildEntryConsistency(hours);
  const lifecycle = buildLifecycleAnalysis(records, minimumReliableSamples);
  const dataQuality = buildDataQuality(
    records,
    coverage.rawOrderRowsExcluded,
    coverage.invalidNormalized
  );
  const sessionHold = buildSessionHoldInteraction(records, minimumReliableSamples);
  const pathDependent = pathDependentCapabilities(records);

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
    insightThresholds: INSIGHT_THRESHOLDS,
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
      weakestObservedHour,
      consistency: entryConsistency
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
    lifecycle,
    dataQuality,
    interactions: { sessionHold },
    pathDependent,
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
