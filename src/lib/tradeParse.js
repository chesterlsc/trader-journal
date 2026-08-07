// Quick-capture command-bar parser (design-source 1b, route 1).
// Pure: no DOM, no app state. Takes the line a trader would say out loud —
// "btc long 118400 sl 117900 1%" — and returns the structured trade, or an
// honest error. It never guesses a missing field into existence: if the stop
// is absent the parse FAILS rather than saving a position with no risk.

// Aliases only for things a trader genuinely shortens. Anything not listed
// passes through upper-cased, so BTCUSDT / EURUSD / AAPL / MNQ all work.
export const SYMBOL_ALIASES = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  BNB: "BNBUSDT",
  ADA: "ADAUSDT",
  LTC: "LTCUSDT",
  LINK: "LINKUSDT",
  AVAX: "AVAXUSDT",
  GOLD: "XAUUSD",
  XAU: "XAUUSD",
  SILVER: "XAGUSD",
  XAG: "XAGUSD",
  EUR: "EURUSD",
  GBP: "GBPUSD",
  AUD: "AUDUSD",
  NZD: "NZDUSD",
  CABLE: "GBPUSD",
  FIBER: "EURUSD",
  NAS: "NAS100",
  NASDAQ: "NAS100",
  US30: "US30",
  DOW: "US30",
  SPX: "SPX500",
  SP500: "SPX500"
};

const LONG_WORDS = new Set(["LONG", "BUY", "L", "B"]);
const SHORT_WORDS = new Set(["SHORT", "SELL", "S"]);
const STOP_WORDS = new Set(["SL", "STOP", "STOPLOSS", "X"]);
const TARGET_WORDS = new Set(["TP", "TARGET", "TAKEPROFIT", "T"]);
const SIZE_WORDS = new Set(["SIZE", "QTY", "LOTS", "LOT", "UNITS"]);
const RISK_WORDS = new Set(["RISK", "R"]);
const PIP_WORDS = new Set(["PIPS", "PIP", "P"]);
const ENTRY_WORDS = new Set(["ENTRY", "E", "AT", "@"]);
const NOISE_WORDS = new Set(["A", "AN", "THE", "FOR", "WITH", "OF", "GO", "GOING", "TAKE"]);

// "118,400" / "1.0855" / "$140" / "2%" → number. Returns NaN for anything else,
// so a stray word never becomes a price.
function toNumber(raw) {
  const cleaned = String(raw).replace(/[$,]/g, "").replace(/%$/, "");
  if (!/^\d*\.?\d+$/.test(cleaned)) {
    return NaN;
  }
  return Number(cleaned);
}

function isNumeric(raw) {
  return Number.isFinite(toNumber(raw));
}

// Split "sl117900", "sl=117900", "risk:1%" into ["sl", "117900"] so glued
// input parses the same as spaced input.
function explode(token) {
  const parts = [];
  String(token)
    .split(/[=:]+/)
    .filter(Boolean)
    .forEach((piece) => {
      const glued = piece.match(/^([a-zA-Z]+)([\d.,$%]+)$/);
      if (glued && !isNumeric(piece)) {
        parts.push(glued[1], glued[2]);
        return;
      }
      parts.push(piece);
    });
  return parts;
}

export function resolveSymbol(raw) {
  const upper = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!upper) {
    return "";
  }
  return SYMBOL_ALIASES[upper] || upper;
}

// Market guess for the trade record. Only structural inference — it decides
// which pip model calculateTradeMetrics uses, and stays editable afterwards.
export function inferMarket(symbol) {
  const upper = String(symbol || "").toUpperCase();
  if (/^XAU/.test(upper)) return "Metals";
  if (/^XAG/.test(upper)) return "Metals";
  if (/(USDT|USDC)$/.test(upper)) return "Crypto";
  if (/^(BTC|ETH|SOL|XRP|DOGE|BNB|ADA|LTC|BCH|AVAX|LINK|DOT|TRX|SUI|TON)USD$/.test(upper)) return "Crypto";
  if (/^(NAS100|SPX500|US30|US500|GER40|UK100|JP225)$/.test(upper)) return "Indices";
  if (/^[A-Z]{6}$/.test(upper)) return "Forex";
  return "Other";
}

/**
 * @param {string} input raw command-bar line
 * @returns {{ok: true, value: object} | {ok: false, error: string, value: object}}
 *   `value` is always returned so the live readout can show a partial parse
 *   while the trader is still typing.
 */
export function parseQuickTrade(input) {
  const value = {
    symbol: "",
    market: "",
    direction: "",
    entryPrice: 0,
    stopLoss: 0,
    takeProfit: 0,
    riskPercent: 0,
    riskCash: 0,
    positionSize: 0,
    // Pip-DISTANCE forms ("sl 10p", "tp 20 pips") land here; the app resolves
    // them into prices against entry, because only it knows the pip spec.
    stopPips: 0,
    targetPips: 0
  };

  const tokens = String(input || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(explode);

  if (!tokens.length) {
    return { ok: false, error: "Type a trade, e.g. btc long 118400 sl 117900 1%", value };
  }

  const bareNumbers = [];
  let pending = "";
  let unknown = "";
  let prevWasBareNumber = false;
  let lastConsumed = "";

  for (const token of tokens) {
    const word = token.toUpperCase();
    const followsBareNumber = prevWasBareNumber;
    prevWasBareNumber = false;
    const prevConsumed = lastConsumed;
    lastConsumed = "";

    // Glued pip distance: "sl 10p" / "tp 2.5p".
    if ((pending === "stop" || pending === "target") && /^\d*\.?\d+p$/i.test(token)) {
      const amount = Number(token.replace(/p$/i, ""));
      if (pending === "stop") value.stopPips = amount;
      else value.targetPips = amount;
      pending = "";
      continue;
    }

    if (pending && isNumeric(token)) {
      const amount = toNumber(token);
      if (pending === "stop") value.stopLoss = amount;
      else if (pending === "target") value.takeProfit = amount;
      else if (pending === "size") value.positionSize = amount;
      else if (pending === "entry") value.entryPrice = amount;
      else if (pending === "risk") {
        // A bare number after "risk" is a percent; "$140" is cash.
        if (/\$/.test(token)) value.riskCash = amount;
        else value.riskPercent = amount;
      }
      lastConsumed = pending;
      pending = "";
      continue;
    }
    pending = "";

    // "sl 10 pips": the 10 was just consumed as a stop PRICE — the unit word
    // retro-tags it as a distance. Only the immediately preceding assignment
    // qualifies, so "tp 4214 0.02 pips" can never re-tag the 4214.
    if (PIP_WORDS.has(word)) {
      if (prevConsumed === "stop" && value.stopLoss > 0) {
        value.stopPips = value.stopLoss;
        value.stopLoss = 0;
      } else if (prevConsumed === "target" && value.takeProfit > 0) {
        value.targetPips = value.takeProfit;
        value.takeProfit = 0;
      }
      continue;
    }

    if (STOP_WORDS.has(word)) { pending = "stop"; continue; }
    if (TARGET_WORDS.has(word)) { pending = "target"; continue; }
    if (SIZE_WORDS.has(word)) {
      // Both orders are natural speech: "size 0.02" (unit first) sets pending;
      // "0.02 lots" (number first) claims ONLY the immediately preceding
      // number — a greedy pop would steal positional entry/stop/target.
      if (!value.positionSize && followsBareNumber && bareNumbers.length) {
        value.positionSize = bareNumbers.pop();
      } else {
        pending = "size";
      }
      continue;
    }
    if (ENTRY_WORDS.has(word)) { pending = "entry"; continue; }
    if (RISK_WORDS.has(word)) { pending = "risk"; continue; }
    if (LONG_WORDS.has(word)) { value.direction = "Buy"; continue; }
    if (SHORT_WORDS.has(word)) { value.direction = "Sell"; continue; }
    if (NOISE_WORDS.has(word)) { continue; }

    if (/%$/.test(token) && isNumeric(token)) {
      value.riskPercent = toNumber(token);
      continue;
    }
    if (/^\$/.test(token) && isNumeric(token)) {
      value.riskCash = toNumber(token);
      continue;
    }
    if (isNumeric(token)) {
      bareNumbers.push(toNumber(token));
      prevWasBareNumber = true;
      continue;
    }
    if (/^[A-Z0-9]{2,12}$/.test(word) && !value.symbol) {
      value.symbol = resolveSymbol(word);
      continue;
    }
    if (!unknown) {
      unknown = token;
    }
  }

  // Positional fallback: bare numbers fill entry, then stop, then target —
  // the order the sentence says them.
  if (!value.entryPrice && bareNumbers.length) value.entryPrice = bareNumbers.shift();
  if (!value.stopLoss && !value.stopPips && bareNumbers.length) value.stopLoss = bareNumbers.shift();
  if (!value.takeProfit && !value.targetPips && bareNumbers.length) value.takeProfit = bareNumbers.shift();

  value.market = value.symbol ? inferMarket(value.symbol) : "";

  if (unknown) {
    return { ok: false, error: `Could not read “${unknown}”.`, value };
  }
  if (!value.symbol) {
    return { ok: false, error: "No symbol yet. Start with one, e.g. btc or eurusd.", value };
  }
  if (!value.direction) {
    return { ok: false, error: "Say long or short.", value };
  }
  if (!(value.entryPrice > 0)) {
    return { ok: false, error: "No entry price yet.", value };
  }
  if (!(value.stopLoss > 0) && !(value.stopPips > 0)) {
    return { ok: false, error: "No stop yet. A trade with no stop has no size.", value };
  }
  if (value.stopLoss > 0 && value.direction === "Buy" && value.stopLoss >= value.entryPrice) {
    return { ok: false, error: "Long: the stop must sit below entry.", value };
  }
  if (value.stopLoss > 0 && value.direction === "Sell" && value.stopLoss <= value.entryPrice) {
    return { ok: false, error: "Short: the stop must sit above entry.", value };
  }
  if (value.takeProfit > 0) {
    const above = value.takeProfit > value.entryPrice;
    if ((value.direction === "Buy") !== above) {
      return { ok: false, error: "The target is on the wrong side of entry.", value };
    }
  }

  return { ok: true, value };
}
