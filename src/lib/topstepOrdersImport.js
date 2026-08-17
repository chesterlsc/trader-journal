// Strict TopstepX Orders CSV reconstruction.
//
// Orders exports contain individual order lifecycle rows rather than Topstep's
// completed Trades rows. This module only uses filled executions and only
// emits a journal trade when the signed position can be followed from flat
// back to flat without guessing. It intentionally does not manufacture broker
// P&L, fees, commissions, stops, targets, or a Topstep trade id.

const SOURCE = "topstepx-orders";
const DELIMITERS = [",", "\t", ";"];
const CME_MONTH_CODES = "FGHJKMNQUVXZ";

const ORDER_COLUMNS = [
  "Id",
  "AccountName",
  "ContractName",
  "Status",
  "Type",
  "Size",
  "Side",
  "CreatedAt",
  "TradeDay",
  "FilledAt",
  "CancelledAt",
  "TriggeredAt",
  "StopPrice",
  "LimitPrice",
  "ExecutePrice",
  "TriggeredPrice",
  "PositionDisposition",
  "CreationDisposition",
  "RejectionReason",
  "ExchangeOrderId",
  "PlatformOrderId"
];

const ORDER_KEYS = ORDER_COLUMNS.map(normalizeHeader);
const TRADE_HEADER_KEYS = [
  "id",
  "contractname",
  "enteredat",
  "exitedat",
  "entryprice",
  "exitprice",
  "fees",
  "pnl",
  "size",
  "type",
  "tradeday",
  "tradeduration"
];
const POINT_MULTIPLIERS = Object.freeze({ MGC: 10, GC: 100 });

/**
 * Identify the two supported TopstepX export shapes without relying on the UI
 * source selector. Orders detection requires the complete current 21-column
 * model, so a generic file containing common fields such as Status and Side
 * cannot be mislabelled as Topstep.
 *
 * @param {string} text
 * @returns {{kind: "orders" | "trades" | "unknown", headerRow: number | null}}
 */
export function detectTopstepExport(text) {
  const located = locateExportHeader(String(text ?? "").replace(/^\uFEFF/, ""));
  return {
    kind: located?.kind || "unknown",
    headerRow: located?.record?.rowNumber || null
  };
}

/**
 * Parse and reconstruct a TopstepX Orders export.
 *
 * Validation is deliberately atomic. If any Filled row is malformed or any
 * account/contract inventory cannot be reconciled, no partial reconstruction
 * is returned.
 *
 * @param {string} text
 * @returns {{trades: object[], errors: string[], headerRow: number | null}}
 */
export function parseTopstepOrdersCsv(text) {
  const sourceText = String(text ?? "").replace(/^\uFEFF/, "");
  if (!sourceText.trim()) {
    return {
      trades: [],
      errors: ["TopstepX Orders CSV is empty. Choose the original Orders export."],
      headerRow: null
    };
  }

  const located = locateExportHeader(sourceText);
  if (!located) {
    return {
      trades: [],
      errors: ["Could not find the exact 21-column TopstepX Orders header."],
      headerRow: null
    };
  }
  if (located.kind === "trades") {
    return {
      trades: [],
      errors: ["This is a TopstepX Trades export. Use the TopstepX Trades importer."],
      headerRow: located.record.rowNumber
    };
  }
  if (located.parsed.error) {
    return {
      trades: [],
      errors: [located.parsed.error],
      headerRow: located.record.rowNumber
    };
  }

  const errors = [];
  const filled = [];
  const resting = [];
  const seenOrderIds = new Map();
  const records = located.parsed.records.slice(located.recordIndex + 1);

  records.forEach((record) => {
    if (record.cells.every((cell) => !String(cell).trim())) return;

    const mapped = mapFilledOrder(record, located.indexes);
    if (mapped.skip) {
      if (mapped.resting) resting.push(mapped.resting);
      return;
    }
    if (mapped.error) {
      errors.push(mapped.error);
      return;
    }

    const scopedOrderId = `${mapped.order.sourceAccountName}\u0000${mapped.order.orderId}`;
    if (seenOrderIds.has(scopedOrderId)) {
      errors.push(`Row ${record.rowNumber}: Id duplicates another Filled order in this account.`);
      return;
    }
    seenOrderIds.set(scopedOrderId, record.rowNumber);
    filled.push(mapped.order);
  });

  if (errors.length) {
    return { trades: [], errors, openPositions: [], headerRow: located.record.rowNumber };
  }
  if (!filled.length) {
    return {
      trades: [],
      errors: ["No Filled orders were found in this TopstepX Orders export."],
      openPositions: [],
      headerRow: located.record.rowNumber
    };
  }

  const sourceAccounts = new Set(filled.map((order) => order.sourceAccountName));
  if (sourceAccounts.size !== 1) {
    return {
      trades: [],
      errors: [
        "This Orders export contains more than one Topstep account. Export one account at a time, then choose its destination journal account."
      ],
      openPositions: [],
      headerRow: located.record.rowNumber
    };
  }

  const groups = new Map();
  filled.forEach((order) => {
    // Inventory must flatten inside each declared Topstep trading day. Grouping
    // the session explicitly prevents a cross-day close from making a truncated
    // export look complete.
    const key = `${order.sourceAccountName}\u0000${order.contractName.toUpperCase()}\u0000${order.sourceTradeDay}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  });

  const trades = [];
  const openPositions = [];
  groups.forEach((orders) => {
    const reconstructed = reconstructGroup(orders);
    errors.push(...reconstructed.errors);
    trades.push(...reconstructed.trades);
    openPositions.push(...reconstructed.openPositions);
  });

  if (errors.length) {
    return { trades: [], errors, openPositions: [], headerRow: located.record.rowNumber };
  }

  // Attach the resting bracket to its position: same account and contract,
  // newest order of each kind wins if the trader replaced one.
  openPositions.forEach((positionSummary) => {
    resting
      .filter((order) =>
        order.sourceAccountName === positionSummary.sourceAccountName &&
        order.contractName === positionSummary.contractName.toUpperCase())
      .sort((left, right) => left.createdMs - right.createdMs)
      .forEach((order) => {
        if (order.kind === "stoploss") positionSummary.stopPrice = order.price;
        if (order.kind === "takeprofit") positionSummary.takeProfitPrice = order.price;
      });
  });

  trades.sort((left, right) =>
    String(left.enteredAt).localeCompare(String(right.enteredAt)) ||
    String(left.exitedAt).localeCompare(String(right.exitedAt)) ||
    String(left.externalFingerprint).localeCompare(String(right.externalFingerprint))
  );
  return { trades, errors: [], openPositions, headerRow: located.record.rowNumber };
}

/**
 * Stable duplicate key for reconstructed Orders episodes. Raw order ids stay
 * in sourceOrderIds metadata and are never exposed as a journal trade id.
 *
 * @param {object} trade
 * @returns {string}
 */
export function topstepOrdersDuplicateKey(trade) {
  if (!trade || typeof trade !== "object") return "";
  const declaredSource = String(trade.externalSource || trade.importSource || "").trim().toLowerCase();
  if (declaredSource !== SOURCE) return "";

  const stored = String(trade.externalFingerprint || "").trim().toLowerCase();
  if (stored) return `${SOURCE}:fingerprint:${stored}`;

  const rawOrderIds = Array.isArray(trade.sourceOrderIds)
    ? trade.sourceOrderIds.map((value) => String(value).trim()).filter(Boolean).sort()
    : [];
  const hashedOrderIds = Array.isArray(trade.sourceOrderFingerprints)
    ? trade.sourceOrderFingerprints.map((value) => String(value).trim()).filter(Boolean).sort()
    : [];
  const orderIds = rawOrderIds.length ? rawOrderIds : hashedOrderIds;
  if (!orderIds.length) return "";
  const fallback = hashFingerprint(encodeFingerprintParts([
    SOURCE,
    String(trade.sourceAccountName || trade.sourceAccountFingerprint || "").trim(),
    String(trade.contractName || trade.asset || "").trim().toUpperCase(),
    ...orderIds
  ]));
  return `${SOURCE}:fingerprint:${fallback}`;
}

function locateExportHeader(text) {
  const candidates = [];

  DELIMITERS.forEach((delimiter) => {
    const parsed = parseDelimited(text, delimiter);
    parsed.records.forEach((record, recordIndex) => {
      const normalized = record.cells.map(normalizeHeader).filter(Boolean);
      if (isExactOrdersHeader(normalized)) {
        const indexes = {};
        record.cells.forEach((cell, index) => {
          indexes[normalizeHeader(cell)] = index;
        });
        candidates.push({ kind: "orders", delimiter, parsed, record, recordIndex, indexes });
        return;
      }

      const headerSet = new Set(normalized);
      if (TRADE_HEADER_KEYS.every((key) => headerSet.has(key))) {
        candidates.push({ kind: "trades", delimiter, parsed, record, recordIndex, indexes: {} });
      }
    });
  });

  return candidates.sort((left, right) =>
    left.record.rowNumber - right.record.rowNumber ||
    (left.kind === right.kind ? 0 : left.kind === "orders" ? -1 : 1) ||
    DELIMITERS.indexOf(left.delimiter) - DELIMITERS.indexOf(right.delimiter)
  )[0] || null;
}

function isExactOrdersHeader(normalized) {
  if (normalized.length !== ORDER_KEYS.length) return false;
  const unique = new Set(normalized);
  return unique.size === ORDER_KEYS.length && ORDER_KEYS.every((key) => unique.has(key));
}

function mapFilledOrder(record, indexes) {
  const value = (label) => String(record.cells[indexes[normalizeHeader(label)]] ?? "").trim();
  const status = value("Status");
  if (!status) return { error: `Row ${record.rowNumber}: Status is required.` };
  if (status.toLowerCase() !== "filled") {
    // OrderExportModel has no total-filled quantity. A cancelled/open/rejected
    // row carrying execution evidence may have been partially filled, which
    // cannot be reconstructed safely from this CSV alone.
    if (value("FilledAt") || value("ExecutePrice")) {
      return { error: `Row ${record.rowNumber}: non-Filled order contains execution data and may be partially filled.` };
    }
    // A RESTING BRACKET IS EVIDENCE, not noise. An export taken mid session
    // carries the live position's protection as Open StopLoss / TakeProfit
    // orders, and those prices are exactly the stop and target a journal
    // entry needs. Harvested here, attached to the open position later.
    if (status.toLowerCase() === "open") {
      const creation = normalizeHeader(value("CreationDisposition"));
      if (creation === "stoploss" || creation === "takeprofit") {
        const price = parseNumeric(creation === "stoploss" ? value("StopPrice") : value("LimitPrice"));
        const created = parseExplicitTimestamp(value("CreatedAt"));
        if (price > 0) {
          return {
            skip: true,
            resting: {
              kind: creation,
              price,
              sourceAccountName: value("AccountName"),
              contractName: value("ContractName").toUpperCase(),
              createdMs: created ? created.ms : 0
            }
          };
        }
      }
    }
    return { skip: true };
  }

  const issues = [];
  const orderId = value("Id");
  const sourceAccountName = value("AccountName");
  const contractName = value("ContractName");
  const orderType = value("Type");
  const size = parseNumeric(value("Size"));
  const side = normalizeSide(value("Side"));
  const created = parseExplicitTimestamp(value("CreatedAt"));
  const filledAt = parseExplicitTimestamp(value("FilledAt"));
  const tradeDay = parseTradeDay(value("TradeDay"));
  const executePrice = parseNumeric(value("ExecutePrice"));
  const disposition = normalizeDisposition(value("PositionDisposition"));
  const creationDisposition = normalizeHeader(value("CreationDisposition"));

  if (!orderId) issues.push("Id is required");
  if (!sourceAccountName) issues.push("AccountName is required");
  if (!contractName) issues.push("ContractName is required");
  if (!orderType) issues.push("Type is required");
  if (!Number.isInteger(size) || size <= 0) issues.push("Size must be a positive whole number");
  if (!side) issues.push("Side must be Bid or Ask");
  if (!created) issues.push("CreatedAt must be an explicit timestamp with Z or UTC offset");
  if (!filledAt) issues.push("FilledAt must be an explicit timestamp with Z or UTC offset");
  if (!tradeDay) issues.push("TradeDay must be a valid date with an explicit UTC offset");
  if (!(executePrice > 0)) issues.push("ExecutePrice must be a positive number");
  if (!disposition) issues.push("PositionDisposition must be Opening or Closing");
  if (creationDisposition === "reverseposition" || creationDisposition === "reverse") {
    issues.push("ReversePosition orders are not supported without a verified split contract");
  }
  if (created && filledAt && filledAt.ms < created.ms) issues.push("FilledAt cannot be earlier than CreatedAt");

  if (issues.length) {
    return { error: `Row ${record.rowNumber}: ${issues.join("; ")}.` };
  }

  return {
    order: {
      rowNumber: record.rowNumber,
      orderId,
      exchangeOrderId: value("ExchangeOrderId"),
      platformOrderId: value("PlatformOrderId"),
      sourceAccountName,
      contractName,
      orderType,
      size,
      side,
      signedSize: side === "Bid" ? size : -size,
      createdAt: created.iso,
      filledAt: filledAt.iso,
      filledMs: filledAt.ms,
      sourceTimezone: filledAt.timezone,
      executePrice,
      disposition,
      sourceTradeDay: tradeDay.date,
      sourceTradeDayTimezone: tradeDay.timezone
    }
  };
}

function reconstructGroup(input) {
  const orders = [...input].sort((left, right) => left.filledMs - right.filledMs || left.rowNumber - right.rowNumber);
  const errors = [];
  const trades = [];
  let position = 0;
  let episode = null;

  for (let index = 0; index < orders.length;) {
    let end = index + 1;
    while (end < orders.length && orders[end].filledMs === orders[index].filledMs) end += 1;
    const tied = orders.slice(index, end);
    const signs = new Set(tied.map((order) => Math.sign(order.signedSize)));
    const dispositions = new Set(tied.map((order) => order.disposition));
    if (signs.size > 1 || dispositions.size > 1) {
      errors.push(`Row ${orders[index].rowNumber}: fills with different sides or position dispositions share a timestamp, so execution order is ambiguous.`);
      return { trades: [], errors, openPositions: [] };
    }
    index = end;
  }

  for (const order of orders) {
    if (order.disposition === "Opening") {
      // A REVERSAL. Topstep marks the flip as Opening because from its side
      // that is what it is: one fill that takes a long straight to a short
      // without passing through flat. The arithmetic is not ambiguous, so it
      // is split rather than refused. The open lots close at this fill's
      // price, and the remainder opens the new position at the same price.
      // The fill contributes to BOTH episodes and appears in both source
      // order id lists, which is the truth: it did two things.
      if (position !== 0 && Math.sign(order.signedSize) !== Math.sign(position)) {
        const closeQuantity = Math.min(Math.abs(order.signedSize), Math.abs(position));
        const openQuantity = Math.abs(order.signedSize) - closeQuantity;

        const closingLeg = {
          ...order,
          size: closeQuantity,
          signedSize: Math.sign(order.signedSize) * closeQuantity,
          disposition: "Closing"
        };
        episode.orders.push(closingLeg);
        episode.closings.push(closingLeg);
        position += closingLeg.signedSize;

        if (position === 0) {
          trades.push(buildEpisodeTrade(episode));
          episode = null;
        }

        if (openQuantity > 0) {
          const openingLeg = {
            ...order,
            size: openQuantity,
            signedSize: Math.sign(order.signedSize) * openQuantity
          };
          episode = { orders: [], openings: [], closings: [], peakPositionSize: 0 };
          episode.orders.push(openingLeg);
          episode.openings.push(openingLeg);
          position += openingLeg.signedSize;
          episode.peakPositionSize = Math.abs(position);
        }
        continue;
      }

      if (position === 0) {
        episode = { orders: [], openings: [], closings: [], peakPositionSize: 0 };
      }

      episode.orders.push(order);
      episode.openings.push(order);
      position += order.signedSize;
      episode.peakPositionSize = Math.max(episode.peakPositionSize, Math.abs(position));
      continue;
    }

    if (position === 0 || !episode) {
      errors.push(`Row ${order.rowNumber}: Closing fill cannot be applied because the position is flat.`);
      break;
    }
    if (Math.sign(order.signedSize) === Math.sign(position)) {
      errors.push(`Row ${order.rowNumber}: Closing fill is on the wrong side of the open position.`);
      break;
    }
    if (Math.abs(order.signedSize) > Math.abs(position)) {
      errors.push(`Row ${order.rowNumber}: Closing fill would over-close and reverse the open position.`);
      break;
    }

    episode.orders.push(order);
    episode.closings.push(order);
    position += order.signedSize;

    if (position === 0) {
      trades.push(buildEpisodeTrade(episode));
      episode = null;
    }
  }

  // A position still open at the end of the export is the NORMAL state of a
  // live account exported mid session, not an anomaly. It becomes an open
  // position summary rather than a file killing error. Every mid file
  // inconsistency above still fails the whole group closed.
  let openPosition = null;
  if (!errors.length && position !== 0 && episode) {
    openPosition = buildOpenPosition(episode, position);
  }

  return errors.length
    ? { trades: [], errors, openPositions: [] }
    : { trades, errors: [], openPositions: openPosition ? [openPosition] : [] };
}

/* The trailing episode as a journal ready OPEN position: the cost basis is the
   VWAP of every opening fill (standard average cost), the size is what is
   still on, and the protection prices are attached later from the resting
   Open StopLoss / TakeProfit orders in the same export. */
function buildOpenPosition(episode, position) {
  const first = episode.openings[0];
  const openedQuantity = episode.openings.reduce((sum, order) => sum + order.size, 0);
  const entryValue = episode.openings.reduce((sum, order) => sum + order.executePrice * order.size, 0);
  const direction = position > 0 ? "Buy" : "Sell";
  const asset = contractRoot(first.contractName);
  const sourceOrderIds = episode.orders.map((order) => order.orderId);
  const sourceOrderFingerprints = episode.orders.map((order) =>
    hashFingerprint(`${SOURCE}|${first.sourceAccountName}|order|${order.orderId}`, "tsi")
  );
  return {
    kind: "open-position",
    asset,
    contractName: first.contractName,
    direction,
    size: Math.abs(position),
    avgEntryPrice: roundPrice(entryValue / openedQuantity),
    enteredAt: first.filledAt,
    sourceTradeDay: first.sourceTradeDay,
    sourceTimezone: first.sourceTimezone,
    entryFillCount: episode.openings.length,
    exitFillCount: episode.closings.length,
    sourceAccountName: first.sourceAccountName,
    sourceAccountFingerprint: hashFingerprint(`${SOURCE}|account|${first.sourceAccountName}`, "tsa"),
    sourceOrderIds,
    sourceOrderFingerprints,
    externalFingerprint: createEpisodeFingerprint({
      sourceAccountName: first.sourceAccountName,
      contractName: first.contractName,
      sourceOrderIds
    }),
    contractMultiplier: POINT_MULTIPLIERS[asset] || null,
    stopPrice: 0,
    takeProfitPrice: 0
  };
}

function buildEpisodeTrade(episode) {
  const first = episode.openings[0];
  const last = episode.closings.at(-1);
  const roundTurnQuantity = episode.openings.reduce((sum, order) => sum + order.size, 0);
  const closingSize = episode.closings.reduce((sum, order) => sum + order.size, 0);
  const entryValue = episode.openings.reduce((sum, order) => sum + order.executePrice * order.size, 0);
  const exitValue = episode.closings.reduce((sum, order) => sum + order.executePrice * order.size, 0);
  const entryPrice = roundPrice(entryValue / roundTurnQuantity);
  const exitPrice = roundPrice(exitValue / closingSize);
  const direction = first.signedSize > 0 ? "Buy" : "Sell";
  const asset = contractRoot(first.contractName);
  const contractMultiplier = POINT_MULTIPLIERS[asset] || null;
  const directionFactor = direction === "Buy" ? 1 : -1;
  const calculatedGrossPnl = contractMultiplier === null
    ? null
    : roundMoney((exitValue - entryValue) * directionFactor * contractMultiplier);
  const sourceOrderIds = episode.orders.map((order) => order.orderId);
  const sourceAccountFingerprint = hashFingerprint(`${SOURCE}|account|${first.sourceAccountName}`, "tsa");
  const sourceOrderFingerprints = episode.orders.map((order) =>
    hashFingerprint(`${SOURCE}|${first.sourceAccountName}|order|${order.orderId}`, "tsi")
  );
  const sourceExchangeOrderIds = uniqueNonEmpty(episode.orders.map((order) => order.exchangeOrderId));
  const sourcePlatformOrderIds = uniqueNonEmpty(episode.orders.map((order) => order.platformOrderId));
  const sourceTradeDays = uniqueNonEmpty(episode.orders.map((order) => order.sourceTradeDay));
  const sourceTimezones = uniqueNonEmpty(episode.orders.map((order) => order.sourceTimezone));
  const sourceTradeDayTimezones = uniqueNonEmpty(episode.orders.map((order) => order.sourceTradeDayTimezone));
  const externalFingerprint = createEpisodeFingerprint({
    sourceAccountName: first.sourceAccountName,
    contractName: first.contractName,
    sourceOrderIds
  });

  return {
    status: "closed",
    market: "Futures",
    asset,
    contractName: first.contractName,
    direction,
    entryPrice,
    exitPrice,
    positionSize: episode.peakPositionSize,
    roundTurnQuantity,
    peakPositionSize: episode.peakPositionSize,
    date: last.sourceTradeDay,
    enteredAt: first.filledAt,
    exitedAt: last.filledAt,
    tradeDuration: formatDuration(last.filledMs - first.filledMs),
    sourceTradeDay: last.sourceTradeDay,
    sourceTradeDays,
    sourceTimezone: collapseZones(sourceTimezones),
    sourceTimezones,
    sourceTradeDayTimezone: collapseZones(sourceTradeDayTimezones),
    sourceTradeDayTimezones,
    sourceAccountName: first.sourceAccountName,
    sourceAccountFingerprint,
    sourceOrderIds,
    sourceOrderFingerprints,
    sourceExchangeOrderIds,
    sourcePlatformOrderIds,
    entryFillCount: episode.openings.length,
    exitFillCount: episode.closings.length,
    externalFingerprint,
    externalSource: SOURCE,
    importSource: SOURCE,
    contractMultiplier,
    calculatedGrossPnl,
    pnlBasis: contractMultiplier === null ? "not-calculated" : "calculated-gross",
    session: "Not recorded",
    setupType: "Not recorded",
    timeframe: "Not recorded",
    psychology: "Not recorded",
    executionQuality: "Not recorded",
    stopLoss: 0,
    takeProfit: 0,
    riskPercent: 0,
    tradeResult: "Auto",
    riskAmount: 0,
    rMultiple: null,
    rrRatio: null,
    pips: null,
    pipSize: null,
    pipValuePerLot: null,
    dollarPerPip: null,
    screenshotName: "",
    screenshotData: "",
    notes: "",
    preTradeRules: [],
    preTradeRulesAsked: [],
    eventContext: []
  };
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
      } else if (character === "\r" || character === "\n") {
        if (character === "\r" && next === "\n") index += 1;
        cell += "\n";
        physicalLine += 1;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && !cell.trim()) {
      cell = "";
      inQuotes = true;
    } else if (character === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && next === "\n") index += 1;
      finishRecord();
      physicalLine += 1;
      recordStart = physicalLine;
    } else {
      cell += character;
    }
  }

  if (inQuotes) {
    return { records, error: `Row ${recordStart}: CSV contains an unclosed quoted field.` };
  }
  if (cell.length || cells.length || !/[\r\n]$/.test(text)) finishRecord();
  return { records, error: "" };
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseNumeric(rawValue) {
  let value = String(rawValue ?? "").trim().replace(/\u2212/g, "-");
  if (!value) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(/^\$/, "").replace(/^\+/, "");
  if (!/^-?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/.test(value)) return NaN;
  value = value.replaceAll(",", "");
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return negative ? -Math.abs(number) : number;
}

function normalizeSide(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bid") return "Bid";
  if (normalized === "ask") return "Ask";
  return "";
}

function normalizeDisposition(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "opening") return "Opening";
  if (normalized === "closing") return "Closing";
  return "";
}

function parseExplicitTimestamp(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return null;

  const iso = value.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+\-]\d{2}:?\d{2})$/i
  );
  if (iso) {
    return buildTimestamp({
      year: iso[1], month: iso[2], day: iso[3], hour: iso[4], minute: iso[5], second: iso[6] || "0",
      fraction: iso[7] || "", zone: iso[8]
    });
  }

  const us = value.match(
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(AM|PM)?\s*(Z|[+\-]\d{2}:?\d{2})$/i
  );
  if (!us) return null;
  let hour = Number(us[4]);
  const meridiem = String(us[8] || "").toUpperCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = meridiem === "AM" ? hour % 12 : (hour % 12) + 12;
  }
  return buildTimestamp({
    year: us[3], month: us[1], day: us[2], hour, minute: us[5], second: us[6] || "0",
    fraction: us[7] || "", zone: us[9]
  });
}

function buildTimestamp(parts) {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const fraction = String(parts.fraction || "");
  if (fraction.length > 3) return null;
  const milliseconds = Number((fraction + "000").slice(0, 3));
  const zone = normalizeZone(parts.zone);

  if (!zone || !validDateParts(year, month, day) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }

  const ms = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds) - zone.offsetMinutes * 60_000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return { iso: date.toISOString(), ms, timezone: zone.label };
}

function normalizeZone(rawZone) {
  let value = String(rawZone || "").trim().toUpperCase();
  if (value === "Z") return { offsetMinutes: 0, label: "UTC" };
  if (/^[+\-]\d{4}$/.test(value)) value = `${value.slice(0, 3)}:${value.slice(3)}`;
  const match = value.match(/^([+\-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  const sign = match[1] === "+" ? 1 : -1;
  return {
    offsetMinutes: sign * (hours * 60 + minutes),
    label: `UTC${match[1]}${match[2]}:${match[3]}`
  };
}

function parseTradeDay(rawValue) {
  const value = String(rawValue || "").trim();
  const timestamp = parseExplicitTimestamp(value);
  if (!timestamp) return null;
  const dateMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (!dateMatch) return null;
  const isIso = dateMatch[1].length === 4;
  const year = isIso ? dateMatch[1] : dateMatch[3];
  const month = isIso ? dateMatch[2] : dateMatch[1];
  const day = isIso ? dateMatch[3] : dateMatch[2];
  return {
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    timezone: timestamp.timezone
  };
}

function validDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function contractRoot(contractName) {
  const compact = String(contractName || "").trim().toUpperCase();
  const dotted = compact.split(".").filter(Boolean);
  if (dotted.length >= 2 && new RegExp(`^[${CME_MONTH_CODES}]\\d{1,4}$`).test(dotted.at(-1))) {
    return dotted.at(-2);
  }
  const match = compact.match(new RegExp(`^([A-Z0-9]+?)[${CME_MONTH_CODES}]\\d{1,4}$`));
  return match ? match[1] : compact;
}

function createEpisodeFingerprint({ sourceAccountName, contractName, sourceOrderIds }) {
  return hashFingerprint(encodeFingerprintParts([
    SOURCE,
    String(sourceAccountName || "").trim(),
    String(contractName || "").trim().toUpperCase(),
    ...sourceOrderIds.map((value) => String(value).trim()).sort()
  ]));
}

function encodeFingerprintParts(parts) {
  return parts.map((value) => {
    const text = String(value || "");
    return `${text.length}:${text}`;
  }).join("|");
}

function hashFingerprint(canonical, prefix = "tso") {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
    right ^= right >>> 13;
  }
  return `${prefix}_${toHex(left)}${toHex(right)}`;
}

function toHex(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function collapseZones(zones) {
  if (!zones.length) return "";
  return zones.length === 1 ? zones[0] : `Mixed (${zones.join(", ")})`;
}

function roundPrice(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}

function roundMoney(value) {
  const number = Number(value);
  const rounded = Math.round((number + Math.sign(number) * Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
