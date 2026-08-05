// Live price lookups for the `live_prices` action, ported from
// trade_handler.php. Broker symbols arrive in every shape imaginable
// (BTC/USD, BTCUSDT.p, XAU_USD), so they are normalised to one key, fetched
// from Binance or gold-api, and fall back to CoinGecko before finally falling
// back to whatever is cached in symbol_prices.

const CRYPTO_BASES = [
  'BTC', 'ETH', 'ETC', 'SOL', 'XRP', 'ADA', 'DOGE', 'BNB', 'LTC',
  'BCH', 'AVAX', 'LINK', 'DOT', 'TRX', 'MATIC', 'SUI', 'TON', 'SHIB',
];

const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  ETC: 'ethereum-classic',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  BNB: 'binancecoin',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  DOT: 'polkadot',
  TRX: 'tron',
  MATIC: 'matic-network',
  SUI: 'sui',
  TON: 'the-open-network',
  SHIB: 'shiba-inu',
};

// The PHP kept two parallel 36-entry maps (BASEUSD and BASEUSDT for each coin).
// Same coverage, derived once.
function cryptoBase(normalized) {
  for (const base of CRYPTO_BASES) {
    if (normalized === `${base}USD` || normalized === `${base}USDT`) return base;
  }
  return null;
}

export function normalizeLivePriceSymbol(symbol) {
  const raw = String(symbol ?? '').trim().toUpperCase();
  if (raw === '') return '';

  return raw
    .replace(/[:/\s_-]+/g, '')
    .replace(/[^A-Z0-9.]/g, '')
    .replace(/\.(P|M|PRO|RAW|CASH)$/, '')
    .replace(/(USDT|USDC|USD|BTC|ETH)(PERP|FUT|SWAP|SPOT)$/, '$1')
    .replace(/(USDT|USDC|USD|BTC|ETH)(M|PRO)$/, '$1');
}

export function resolveLivePriceSource(symbol) {
  const normalized = normalizeLivePriceSymbol(symbol);
  if (normalized === '') return null;

  const base = cryptoBase(normalized);
  if (base) {
    const marketSymbol = `${base}USDT`;
    return {
      key: `binance:${marketSymbol}`,
      url: `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(marketSymbol)}`,
      readPrice: (body) => positivePrice(body?.price),
    };
  }

  if (normalized === 'XAUUSD' || normalized === 'XAGUSD') {
    const metal = normalized.startsWith('XAG') ? 'XAG' : 'XAU';
    return {
      key: `metal:${metal}`,
      url: `https://api.gold-api.com/price/${encodeURIComponent(metal)}`,
      readPrice: (body) => positivePrice(body?.price),
    };
  }

  return null;
}

function positivePrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function buildLivePriceRequests(symbols) {
  const requests = new Map();
  for (const symbol of symbols) {
    const source = resolveLivePriceSource(symbol);
    if (source === null) continue;

    if (!requests.has(source.key)) requests.set(source.key, { ...source, aliases: new Set() });
    requests.get(source.key).aliases.add(symbol);
  }
  return [...requests.values()].map((request) => ({ ...request, aliases: [...request.aliases] }));
}

async function fetchRemoteJson(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'TraderJournal/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    // A dead upstream must never fail the request — the cached price is used.
    return null;
  }
}

async function fetchCoinGeckoFallbackPrices(symbols, fetchImpl) {
  const symbolToCoin = new Map();
  for (const symbol of symbols) {
    const normalized = normalizeLivePriceSymbol(symbol);
    const base = cryptoBase(normalized);
    const coinId = base ? COINGECKO_IDS[base] : null;
    if (normalized === '' || !coinId) continue;
    symbolToCoin.set(normalized, coinId);
  }
  if (symbolToCoin.size === 0) return {};

  const ids = [...new Set(symbolToCoin.values())].join(',');
  const body = await fetchRemoteJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`,
    fetchImpl,
  );
  if (body === null) return {};

  const result = {};
  for (const [symbol, coinId] of symbolToCoin) {
    const price = positivePrice(body[coinId]?.usd);
    if (price !== null) result[symbol] = price;
  }
  return result;
}

export async function fetchLivePrices(db, symbols, fetchImpl = fetch) {
  const normalizedSymbols = [...new Set(
    symbols.map((symbol) => normalizeLivePriceSymbol(symbol)).filter((symbol) => symbol !== ''),
  )];
  if (normalizedSymbols.length === 0) return {};

  const updates = {};
  // PHP fetched these one after another; in a function with a wall-clock budget
  // the same set of requests runs concurrently instead.
  const requests = buildLivePriceRequests(normalizedSymbols);
  const bodies = await Promise.all(requests.map((request) => fetchRemoteJson(request.url, fetchImpl)));

  requests.forEach((request, index) => {
    const body = bodies[index];
    if (body === null) return;
    const price = request.readPrice(body);
    if (price === null) return;
    for (const alias of request.aliases) updates[alias] = price;
  });

  const missing = normalizedSymbols.filter((symbol) => !(symbol in updates));
  if (missing.length > 0) {
    for (const [symbol, price] of Object.entries(await fetchCoinGeckoFallbackPrices(missing, fetchImpl))) {
      if (!(symbol in updates) && price > 0) updates[symbol] = price;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.upsertSymbolPrices(Object.entries(updates).map(([symbol, price]) => ({ symbol, price })));
  }

  for (const [symbol, price] of Object.entries(await db.loadCachedSymbolPrices(normalizedSymbols))) {
    if (!(symbol in updates)) updates[symbol] = price;
  }

  return updates;
}
