// Payload sanitizers ported 1:1 from trade_handler.php.
//
// The PHP was loose-typed on purpose: rows written years ago carry snake_case
// keys, numeric strings and missing fields, and the front-end still expects the
// camelCase shape back. Every coercion below mirrors a PHP cast exactly, so a
// row that round-tripped through the PHP handler round-trips through this one
// byte-for-byte. Nothing here touches the database — it is all pure, which is
// what makes the port testable without a connection.

// PHP `(string) $value`.
export function str(value) {
  if (value === null || value === undefined) return '';
  if (value === true) return '1';
  if (value === false) return '';
  if (typeof value === 'object') return '';
  return String(value);
}

// PHP `is_numeric()`: integers, floats and numeric strings. Not hex, not
// booleans, not null, not "" — matching the grammar PHP actually accepts.
const NUMERIC_STRING = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export function isNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  return NUMERIC_STRING.test(value.trim());
}

// PHP `(float) $value` guarded by is_numeric, defaulting to 0.0.
function toFloat(value) {
  return isNumeric(value) ? Number(String(value).trim()) : 0;
}

// First non-null of a list — PHP's `$a['x'] ?? $a['y'] ?? null` chain.
function coalesce(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

export function positiveNumber(value, fallback) {
  if (!isNumeric(value)) return fallback;
  const num = Number(String(value).trim());
  return num > 0 ? num : fallback;
}

export function nonNegativeNumber(value, fallback) {
  if (!isNumeric(value)) return fallback;
  const num = Number(String(value).trim());
  return num >= 0 ? num : fallback;
}

export function sanitizeJournalName(value) {
  const name = str(value).trim().replace(/\s+/g, ' ');
  if (name === '') return 'Your';
  // mb_substr() counts codepoints, not bytes — Array.from does the same.
  return Array.from(name).slice(0, 24).join('');
}

// Settings the FRONT-END owns end to end: the server stores and returns them
// verbatim and never reads them. They are listed rather than passed through
// wholesale so the column cannot become a dumping ground, and each is copied
// only when the client actually sent it — an absent key stays absent, which is
// what keeps the legacy-row fixture byte-identical to the PHP handler's output.
//
// This list is not decoration. The whitelist below used to be the whole
// function, which silently deleted every one of these on the first server
// round-trip: a trader's pre-trade checklist, cooldown setting and (now) their
// whole prop-firm account configuration were written to localStorage, synced
// up, and came back stripped. Anything the client persists into settings has
// to be named here or it does not survive login on a second device.
const CLIENT_OWNED_SETTINGS = [
  'preTradeRules',
  'cooldownEnabled',
  'cooldownLossStreak',
  'accounts',
  'activeAccountId',
];

// Ceiling on the client-owned block so a runaway client cannot grow the
// settings JSONB without bound. Roughly 200 accounts' worth of prop config.
const CLIENT_SETTINGS_MAX_BYTES = 128 * 1024;

export function sanitizeSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const result = {
    journalName: sanitizeJournalName(source.journalName ?? 'Your'),
    startingBalance: positiveNumber(source.startingBalance ?? 10000, 10000),
    balanceOverride: nonNegativeNumber(source.balanceOverride ?? 0, 0),
    dailyMaxLoss: nonNegativeNumber(source.dailyMaxLoss ?? 300, 300),
    weeklyMaxLoss: nonNegativeNumber(source.weeklyMaxLoss ?? 1000, 1000),
    riskPerTrade: nonNegativeNumber(source.riskPerTrade ?? 1, 1),
    equityGoal: positiveNumber(source.equityGoal ?? 15000, 15000),
  };

  const carried = {};
  for (const key of CLIENT_OWNED_SETTINGS) {
    if (source[key] !== undefined) carried[key] = source[key];
  }
  // Oversized blocks are dropped whole rather than truncated: half a settings
  // object is worse than none, because the client would treat it as complete.
  if (Object.keys(carried).length > 0) {
    let size = Infinity;
    try {
      size = JSON.stringify(carried).length;
    } catch {
      size = Infinity;
    }
    if (size <= CLIENT_SETTINGS_MAX_BYTES) Object.assign(result, carried);
  }

  return result;
}

// PHP `is_array($value) ? $value : []`. A JSON object decodes to a PHP array
// too, so objects pass through rather than being flattened.
export function sanitizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  return [];
}

export function sanitizeReplayNotes(value) {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const scalar = item === null || ['string', 'number', 'boolean'].includes(typeof item);
    result[String(key)] = scalar ? str(item ?? '') : '';
  }
  return result;
}

export function normalizeTradeStatus(value) {
  return str(value).trim() === 'open' ? 'open' : 'closed';
}

export function extractIsoDatePrefix(value) {
  const text = str(value).trim();
  if (text === '') return '';
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1] : '';
}

export function resolveTradeDateValue(item) {
  const directDate = str(coalesce(item.date, item.trade_date)).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(directDate)) return directDate;

  const fallbacks = [
    item.closedAt, item.closed_at,
    item.createdAt, item.created_at,
    item.updatedAt, item.updated_at,
  ];
  for (const candidate of fallbacks) {
    const date = extractIsoDatePrefix(candidate);
    if (date !== '') return date;
  }

  return directDate;
}

// Normalises a stored trade list into the camelCase shape the front-end reads,
// preserving any extra keys the client sent (playbook tags, checklist state).
export function sanitizeTradesPayload(value) {
  if (!Array.isArray(value)) return [];

  const result = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const item = { ...entry };

    const statusSource = coalesce(item.status, item.in_progress ? 'open' : 'closed');
    const status = normalizeTradeStatus(statusSource);
    const createdAt = str(coalesce(item.createdAt, item.created_at)).trim();
    const updatedAt = str(coalesce(item.updatedAt, item.updated_at, createdAt)).trim();
    const closedAt = status === 'open'
      ? ''
      : str(coalesce(item.closedAt, item.closed_at, updatedAt)).trim();

    item.id = str(item.id ?? '');
    item.date = resolveTradeDateValue(entry);
    item.asset = str(coalesce(item.asset, item.symbol) ?? '');
    item.direction = str(item.direction ?? 'Buy');
    item.entryPrice = toFloat(coalesce(item.entryPrice, item.entry_price));
    item.stopLoss = toFloat(coalesce(item.stopLoss, item.stop_loss));
    item.takeProfit = toFloat(coalesce(item.takeProfit, item.take_profit));
    item.exitPrice = toFloat(coalesce(item.exitPrice, item.exit_price));
    item.riskPercent = toFloat(coalesce(item.riskPercent, item.risk_percent));
    item.positionSize = toFloat(coalesce(item.positionSize, item.position_size));
    item.netPnl = toFloat(coalesce(item.netPnl, item.profit_loss));
    item.session = str(item.session ?? 'Custom');
    item.market = str(item.market ?? 'Forex');
    item.tradeResult = str(coalesce(item.tradeResult, item.trade_result) ?? 'Auto');
    item.setupType = str(coalesce(item.setupType, item.setup_type) ?? 'Custom');
    item.timeframe = str(item.timeframe ?? 'M15');
    item.psychology = str(item.psychology ?? 'Focused');
    item.executionQuality = str(coalesce(item.executionQuality, item.execution_quality) ?? 'B');
    item.screenshotName = str(coalesce(item.screenshotName, item.screenshot_name) ?? '').trim();
    item.screenshotData = str(coalesce(item.screenshotData, item.screenshot_data) ?? '').trim();
    item.notes = str(item.notes ?? '');
    item.status = status;
    item.createdAt = createdAt;
    item.updatedAt = updatedAt;
    item.closedAt = closedAt;

    result.push(item);
  }

  return result;
}

// Screenshots are base64 blobs; they live in their own table so the trades
// JSONB column stays small enough to read on every load.
export function stripTradeScreenshotsFromTrades(trades) {
  return trades.map((trade) => {
    const row = { ...trade };
    if (str(row.id ?? '').trim() !== '') {
      delete row.screenshotName;
      delete row.screenshotData;
      delete row.screenshot_name;
      delete row.screenshot_data;
    }
    return row;
  });
}

export function collectTradeScreenshots(trades) {
  const byTradeId = new Map();
  for (const trade of trades) {
    if (!trade || typeof trade !== 'object') continue;

    const tradeId = str(trade.id ?? '').trim();
    if (tradeId === '') continue;

    const screenshotName = str(coalesce(trade.screenshotName, trade.screenshot_name) ?? '').trim();
    const screenshotData = str(coalesce(trade.screenshotData, trade.screenshot_data) ?? '').trim();
    if (screenshotName === '' && screenshotData === '') continue;

    byTradeId.set(tradeId, {
      tradeId: tradeId.slice(0, 64),
      screenshotName,
      screenshotData,
    });
  }
  return [...byTradeId.values()];
}

export function mergeTradeScreenshots(trades, screenshots) {
  return trades.map((trade) => {
    if (!trade || typeof trade !== 'object') return trade;
    const row = { ...trade };
    const tradeId = str(row.id ?? '').trim();

    const stored = tradeId !== '' ? screenshots[tradeId] : undefined;
    if (stored) {
      row.screenshotName = str(stored.screenshotName ?? '');
      row.screenshotData = str(stored.screenshotData ?? '');
      return row;
    }

    row.screenshotName = str(coalesce(row.screenshotName, row.screenshot_name) ?? '').trim();
    row.screenshotData = str(coalesce(row.screenshotData, row.screenshot_data) ?? '').trim();
    return row;
  });
}

// Shape returned by `recent_trades` — the private feed, so prices and P&L are
// included. `public_recent_trades` narrows this further in the router.
export function toRecentTradeRow(trade) {
  return {
    id: str(trade.id ?? ''),
    symbol: str(trade.asset ?? ''),
    date: str(trade.date ?? ''),
    direction: str(trade.direction ?? ''),
    entry_price: toFloat(trade.entryPrice),
    stop_loss: toFloat(trade.stopLoss),
    take_profit: toFloat(trade.takeProfit),
    exit_price: toFloat(trade.exitPrice),
    profit_loss: toFloat(trade.netPnl),
    pips: toFloat(trade.pips),
    status: normalizeTradeStatus(trade.status ?? 'closed'),
    created_at: str(trade.createdAt ?? ''),
    closed_at: str(trade.closedAt ?? ''),
  };
}

// PHP `$right <=> $left` on strings: newest date first, then newest createdAt.
export function compareRecentTrades(a, b) {
  const leftDate = str(a.date ?? '');
  const rightDate = str(b.date ?? '');
  if (rightDate !== leftDate) return rightDate > leftDate ? 1 : -1;

  const left = str(coalesce(a.createdAt, a.updatedAt) ?? '');
  const right = str(coalesce(b.createdAt, b.updatedAt) ?? '');
  if (right === left) return 0;
  return right > left ? 1 : -1;
}

export const JOURNAL_DEFAULTS = Object.freeze({
  settings: Object.freeze({
    journalName: 'Your',
    startingBalance: 10000,
    balanceOverride: 0,
    dailyMaxLoss: 300,
    weeklyMaxLoss: 1000,
    riskPerTrade: 1,
    equityGoal: 15000,
  }),
  trades: Object.freeze([]),
  reflections: Object.freeze([]),
  replayNotes: Object.freeze({}),
});

export function journalDefaults() {
  return {
    settings: { ...JOURNAL_DEFAULTS.settings },
    trades: [],
    reflections: [],
    replayNotes: {},
  };
}
