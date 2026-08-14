// TopstepX "Trades" CSV parser.
//
// The export already pairs entries and exits into completed trades. This
// module therefore does not try to reconstruct fills or orders, and it never
// invents a missing price. It is intentionally browser-safe and side-effect
// free so the import UI and headless tests can share the exact same parser.

const SOURCE = "topstepx";
const DELIMITERS = [",", "\t", ";"];

const FIELD_DEFINITIONS = [
  { key: "id", label: "Id", aliases: ["id", "trade id", "tradeid"] },
  {
    key: "contractName",
    label: "ContractName",
    aliases: ["contract name", "contractname", "contract", "symbol", "instrument"]
  },
  {
    key: "enteredAt",
    label: "EnteredAt",
    aliases: ["entered at", "enteredat", "entry time", "entrytime", "opened at", "openedat", "open time", "opentime"]
  },
  {
    key: "exitedAt",
    label: "ExitedAt",
    aliases: ["exited at", "exitedat", "exit time", "exittime", "closed at", "closedat", "close time", "closetime"]
  },
  {
    key: "entryPrice",
    label: "EntryPrice",
    aliases: ["entry price", "entryprice", "average entry price", "averageentryprice", "avg entry price", "avgentryprice", "open price", "openprice"]
  },
  {
    key: "exitPrice",
    label: "ExitPrice",
    aliases: ["exit price", "exitprice", "average exit price", "averageexitprice", "avg exit price", "avgexitprice", "close price", "closeprice"]
  },
  {
    key: "fees",
    label: "Fees",
    aliases: ["fees", "fee", "total fees", "totalfees"]
  },
  {
    key: "pnl",
    label: "PnL",
    aliases: ["pnl", "p&l", "profit loss", "profitloss", "profit and loss", "profitandloss"]
  },
  {
    key: "size",
    label: "Size",
    aliases: ["size", "qty", "quantity", "contracts", "contract quantity", "contractquantity"]
  },
  {
    key: "type",
    label: "Type",
    aliases: ["type", "trade type", "tradetype", "direction", "position type", "positiontype"]
  },
  {
    key: "tradeDay",
    label: "TradeDay",
    aliases: ["trade day", "tradeday", "trade date", "tradedate", "business date", "businessdate"]
  },
  {
    key: "commissions",
    label: "Commissions",
    optional: true,
    aliases: ["commissions", "commission", "total commissions", "totalcommissions"]
  },
  {
    key: "tradeDuration",
    label: "TradeDuration",
    aliases: ["trade duration", "tradeduration", "duration", "holding time", "holdingtime"]
  }
];

const FIELD_BY_ALIAS = new Map();
FIELD_DEFINITIONS.forEach((definition) => {
  definition.aliases.forEach((alias) => FIELD_BY_ALIAS.set(normalizeHeader(alias), definition.key));
});

const REQUIRED_KEYS = FIELD_DEFINITIONS.filter((definition) => !definition.optional).map((definition) => definition.key);
const ORDER_ONLY_HEADERS = new Set([
  "orderid",
  "accountname",
  "status",
  "side",
  "ordertype",
  "orderstatus",
  "createdat",
  "filledat",
  "cancelledat",
  "triggeredat",
  "limitprice",
  "stopprice",
  "executeprice",
  "triggeredprice",
  "positiondisposition",
  "creationdisposition",
  "rejectionreason",
  "exchangeorderid",
  "platformorderid"
]);
const CME_MONTH_CODES = "FGHJKMNQUVXZ";

/**
 * Parse a TopstepX Trades export.
 *
 * `headerRow` and row numbers in `errors` are 1-based physical file lines.
 * A quoted newline advances the physical line count but remains in one record.
 *
 * @param {string} text
 * @returns {{trades: object[], errors: string[], headerRow: number | null}}
 */
export function parseTopstepCsv(text) {
  const sourceText = String(text ?? "").replace(/^\uFEFF/, "");
  if (!sourceText.trim()) {
    return {
      trades: [],
      errors: ["Topstep Trades CSV is empty. Choose a TopstepX Trades export."],
      headerRow: null
    };
  }

  const candidates = DELIMITERS.map((delimiter) => {
    const parsed = parseDelimited(sourceText, delimiter);
    let bestHeader = null;

    parsed.records.forEach((record, recordIndex) => {
      const inspected = inspectHeader(record.cells);
      if (!bestHeader || inspected.count > bestHeader.count) {
        bestHeader = { ...inspected, record, recordIndex };
      }
    });

    return { delimiter, parsed, bestHeader };
  });

  const complete = candidates
    .filter((candidate) => hasRequiredHeader(candidate.bestHeader?.indexes) && !candidate.parsed.error)
    .sort((a, b) => {
      const rowDelta = a.bestHeader.record.rowNumber - b.bestHeader.record.rowNumber;
      return rowDelta || DELIMITERS.indexOf(a.delimiter) - DELIMITERS.indexOf(b.delimiter);
    })[0];

  if (!complete) {
    const best = candidates
      .filter((candidate) => candidate.bestHeader)
      .sort((a, b) => b.bestHeader.count - a.bestHeader.count)[0];
    const parseError = candidates.find((candidate) => candidate.parsed.error)?.parsed.error;

    if (parseError && (!best || best.bestHeader.count === 0 || hasRequiredHeader(best.bestHeader.indexes))) {
      return { trades: [], errors: [parseError], headerRow: null };
    }

    const missingKeys = REQUIRED_KEYS.filter((key) => best?.bestHeader?.indexes?.[key] === undefined);
    const missingLabels = missingKeys.map(fieldLabel);
    const ordersExport = candidates.some((candidate) => looksLikeOrdersExport(candidate.parsed.records));
    const lead = ordersExport
      ? "This appears to be a Topstep Orders export. Orders are order records, not completed paired trades; export Trades instead."
      : "Could not find a complete Topstep Trades header. Export Trades from TopstepX (not Orders).";
    const detail = missingLabels.length ? ` Missing required columns: ${missingLabels.join(", ")}.` : "";

    return {
      trades: [],
      errors: [`${lead}${detail}`],
      headerRow: null
    };
  }

  const { records } = complete.parsed;
  const { indexes, record, recordIndex } = complete.bestHeader;
  const trades = [];
  const errors = [];

  records.slice(recordIndex + 1).forEach((dataRecord) => {
    if (dataRecord.cells.every((cell) => !String(cell).trim())) {
      return;
    }

    const mapped = mapTopstepRow(dataRecord, indexes);
    if (mapped.error) {
      errors.push(mapped.error);
      return;
    }
    trades.push(mapped.trade);
  });

  return { trades, errors, headerRow: record.rowNumber };
}

/**
 * Return a stable Set/Map key for duplicate detection during app integration.
 * Topstep's own trade id is authoritative; the fingerprint is the fallback for
 * legacy rows that were imported before external ids were stored.
 *
 * @param {object} trade
 * @returns {string}
 */
export function topstepDuplicateKey(trade) {
  if (!trade || typeof trade !== "object") {
    return "";
  }

  const declaredSource = String(trade.externalSource || trade.importSource || "").trim().toLowerCase();
  const id = String(trade.externalTradeId || "").trim().toLowerCase();
  const storedFingerprint = String(trade.externalFingerprint || "").trim().toLowerCase();
  // Mapping every hand-entered journal row through this helper must not label
  // it Topstep merely because it has similar price fields.
  if ((declaredSource && declaredSource !== SOURCE) || (!declaredSource && !id && !storedFingerprint)) {
    return "";
  }

  const source = declaredSource || SOURCE;
  if (id) {
    return `${source}:id:${id}`;
  }

  const fingerprint = storedFingerprint || createFingerprint(trade).toLowerCase();
  return fingerprint ? `${source}:fingerprint:${fingerprint}` : "";
}

function mapTopstepRow(record, indexes) {
  const value = (key) => String(record.cells[indexes[key]] ?? "").trim();
  const issues = [];
  const externalTradeId = value("id");
  const contractName = value("contractName");
  const enteredRaw = value("enteredAt");
  const exitedRaw = value("exitedAt");
  const enteredAt = normalizeTimestamp(enteredRaw);
  const exitedAt = normalizeTimestamp(exitedRaw);
  const entryPrice = parseNumeric(value("entryPrice"));
  const exitPrice = parseNumeric(value("exitPrice"));
  const size = parseNumeric(value("size"));
  const rawFees = parseNumeric(value("fees"));
  const rawPnl = parseNumeric(value("pnl"));
  const commissionsValue = indexes.commissions === undefined ? "" : value("commissions");
  const rawCommissions = commissionsValue ? parseNumeric(commissionsValue) : 0;
  const direction = normalizeDirection(value("type"));
  const sourceTradeDay = parseDateOnly(value("tradeDay"));
  const date = sourceTradeDay;
  const tradeDuration = value("tradeDuration");
  const sourceTimezone = timestampZoneLabel(enteredRaw, exitedRaw);

  if (!externalTradeId) issues.push("Id is required");
  if (!contractName) issues.push("ContractName is required");
  if (!enteredAt) issues.push("EnteredAt is not a valid timestamp");
  if (!exitedAt) issues.push("ExitedAt is not a valid timestamp");
  if (!(entryPrice > 0)) issues.push("EntryPrice must be a positive number");
  if (!(exitPrice > 0)) issues.push("ExitPrice must be a positive number");
  if (!Number.isInteger(size) || size === 0) issues.push("Size must be a non-zero whole number");
  if (!Number.isFinite(rawFees)) issues.push("Fees must be a number");
  if (!Number.isFinite(rawCommissions)) issues.push("Commissions must be a number when provided");
  if (!Number.isFinite(rawPnl)) issues.push("PnL must be a number");
  if (!direction) issues.push("Type must be 0/1 or Long/Short");
  if (!sourceTradeDay) issues.push("TradeDay must be a valid date");
  if (!tradeDuration) issues.push("TradeDuration is required");

  if (issues.length) {
    return { error: `Row ${record.rowNumber}: ${issues.join("; ")}.` };
  }

  // Topstep's model names this field pnL but does not document whether it is
  // before or after costs. Preserve it as the broker's authoritative P&L; do
  // not silently subtract fees a second time.
  const brokerPnl = roundMoney(rawPnl);
  const sourceFees = roundMoney(rawFees);
  const sourceCommissions = roundMoney(rawCommissions);
  const fees = roundMoney(Math.abs(sourceFees));
  const commissions = roundMoney(Math.abs(sourceCommissions));
  const trade = {
    status: "closed",
    market: "Futures",
    asset: displayAsset(contractName),
    contractName,
    direction,
    entryPrice,
    exitPrice,
    positionSize: Math.abs(size),
    brokerPnl,
    sourceFees,
    sourceCommissions,
    fees,
    commissions,
    costs: roundMoney(fees + commissions),
    enteredAt,
    exitedAt,
    date,
    sourceTradeDay,
    sourceTimezone,
    tradeDuration,
    externalSource: SOURCE,
    importSource: SOURCE,
    externalTradeId
  };

  trade.externalFingerprint = createFingerprint(trade);
  return { trade };
}

function parseDelimited(text, delimiter) {
  const records = [];
  let cells = [];
  let cell = "";
  let inQuotes = false;
  let physicalLine = 1;
  let recordStart = 1;

  const finishRecord = () => {
    cells.push(cell);
    records.push({ cells, rowNumber: recordStart });
    cells = [];
    cell = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (character === '"') {
        if (next === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }

      if (character === "\r" || character === "\n") {
        if (character === "\r" && next === "\n") index += 1;
        cell += "\n";
        physicalLine += 1;
        continue;
      }

      cell += character;
      continue;
    }

    if (character === '"' && !cell.trim()) {
      cell = "";
      inQuotes = true;
      continue;
    }
    if (character === delimiter) {
      cells.push(cell);
      cell = "";
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && next === "\n") index += 1;
      finishRecord();
      physicalLine += 1;
      recordStart = physicalLine;
      continue;
    }

    cell += character;
  }

  if (inQuotes) {
    return {
      records,
      error: `Row ${recordStart}: CSV contains an unclosed quoted field.`
    };
  }

  if (cell.length || cells.length || !/[\r\n]$/.test(text)) {
    finishRecord();
  }

  return { records, error: "" };
}

function inspectHeader(cells) {
  const indexes = {};
  cells.forEach((cell, index) => {
    const field = FIELD_BY_ALIAS.get(normalizeHeader(cell));
    if (field && indexes[field] === undefined) {
      indexes[field] = index;
    }
  });
  return { indexes, count: Object.keys(indexes).length };
}

function hasRequiredHeader(indexes) {
  return Boolean(indexes) && REQUIRED_KEYS.every((key) => indexes[key] !== undefined);
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function fieldLabel(key) {
  return FIELD_DEFINITIONS.find((definition) => definition.key === key)?.label || key;
}

function looksLikeOrdersExport(records) {
  return records.some((record) => {
    const normalized = record.cells.map(normalizeHeader);
    const orderOnlyCount = normalized.filter((header) => ORDER_ONLY_HEADERS.has(header)).length;
    return orderOnlyCount >= 2 || normalized.some((header) => header === "orders" || header === "ordersexport");
  });
}

function parseNumeric(rawValue) {
  let value = String(rawValue ?? "").trim().replace(/\u2212/g, "-");
  if (!value) return NaN;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (/-$/.test(value)) {
    negative = true;
    value = value.slice(0, -1);
  }

  value = value.replace(/[,$%\s]/g, "").replace(/^\+/, "");
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return NaN;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  return negative ? -Math.abs(parsed) : parsed;
}

function normalizeDirection(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  // TradeExportModel serializes the enum as 0=Long, 1=Short in some exports.
  if (["0", "long"].includes(value)) return "Buy";
  if (["1", "short"].includes(value)) return "Sell";
  return "";
}

function displayAsset(contractName) {
  const compact = String(contractName || "").trim().toUpperCase();
  const segments = compact.split(".").filter(Boolean);
  if (segments.length >= 2 && new RegExp(`^[${CME_MONTH_CODES}]\\d{1,4}$`).test(segments.at(-1))) {
    const root = segments.at(-2);
    if (/^[A-Z0-9]+$/.test(root)) return root;
  }
  const match = compact.match(new RegExp(`^([A-Z0-9]+?)[\\s-]*[${CME_MONTH_CODES}]\\d{1,4}$`));
  return match ? match[1] : compact;
}

function parseDateOnly(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso && validDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]))) {
    return `${iso[1].padStart(4, "0")}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  const us = value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
  if (us && validDateParts(Number(us[3]), Number(us[1]), Number(us[2]))) {
    return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }

  return "";
}

function normalizeTimestamp(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  const iso = value.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+\-]\d{2}:?\d{2})?$/i
  );
  if (iso) {
    return buildTimestamp({
      year: iso[1], month: iso[2], day: iso[3], hour: iso[4] || "0", minute: iso[5] || "0",
      second: iso[6] || "0", fraction: iso[7] || "", meridiem: "", zone: iso[8] || ""
    });
  }

  const us = value.match(
    /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(AM|PM)?\s*(Z|[+\-]\d{2}:?\d{2})?$/i
  );
  if (us) {
    return buildTimestamp({
      year: us[3], month: us[1], day: us[2], hour: us[4] || "0", minute: us[5] || "0",
      second: us[6] || "0", fraction: us[7] || "", meridiem: us[8] || "", zone: us[9] || ""
    });
  }

  return "";
}

function buildTimestamp(parts) {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  let hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const meridiem = String(parts.meridiem || "").toUpperCase();

  if (meridiem) {
    if (hour < 1 || hour > 12) return "";
    if (meridiem === "AM") hour %= 12;
    else if (meridiem === "PM") hour = (hour % 12) + 12;
    else return "";
  }

  if (!validDateParts(year, month, day) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return "";
  }

  const fraction = String(parts.fraction || "").replace(/0+$/, "");
  const base =
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` +
    `T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}` +
    (fraction ? `.${fraction}` : "");
  let zone = String(parts.zone || "").toUpperCase();
  if (!zone) return base;
  if (/^[+\-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;

  const parsed = new Date(`${base}${zone}`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function timestampZoneLabel(...values) {
  const zones = values.map((rawValue) => {
    const match = String(rawValue || "").trim().match(/(Z|[+\-]\d{2}:?\d{2})$/i);
    if (!match) return "";
    const zone = match[1].toUpperCase();
    return zone === "Z" ? "UTC" : `UTC${/^[+\-]\d{4}$/.test(zone) ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`;
  });
  return zones[0] && zones.every((zone) => zone === zones[0]) ? zones[0] : "";
}

function validDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function roundMoney(value) {
  const rounded = Math.round((Number(value) + Math.sign(Number(value)) * Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function createFingerprint(trade) {
  const canonical = [
    SOURCE,
    String(trade.contractName || trade.asset || "").trim().toUpperCase(),
    String(trade.direction || "").trim().toLowerCase(),
    canonicalNumber(trade.positionSize),
    canonicalNumber(trade.entryPrice),
    canonicalNumber(trade.exitPrice),
    String(trade.enteredAt || "").trim(),
    String(trade.exitedAt || "").trim(),
    canonicalNumber(trade.brokerPnl),
    canonicalNumber(Number.isFinite(trade.sourceFees) ? trade.sourceFees : trade.fees),
    canonicalNumber(Number.isFinite(trade.sourceCommissions) ? trade.sourceCommissions : trade.commissions),
    String(trade.date || "").trim()
  ].join("|");

  // Two independent 32-bit FNV-style lanes produce a compact browser-safe
  // fingerprint without relying on async Web Crypto or Node-only modules.
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
    right ^= right >>> 13;
  }
  return `ts_${toHex(left)}${toHex(right)}`;
}

function canonicalNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Object.is(number, -0) ? "0" : String(number);
}

function toHex(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}
