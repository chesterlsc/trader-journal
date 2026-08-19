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

  // EURUSD comes from Coinbase's keyless live spot endpoint — reachable from
  // US serverless regions, unlike Binance (HTTP 451 geo-block), and updated
  // continuously. Other majors have no live keyless source (ECB feeds are
  // daily), so they are deliberately NOT offered: a daily rate under a
  // "live" label would be a lie.
  if (normalized === 'EURUSD') {
    return {
      key: 'coinbase:EUR-USD',
      url: 'https://api.coinbase.com/v2/prices/EUR-USD/spot',
      readPrice: (body) => positivePrice(body?.data?.amount),
    };
  }

  // GOLD FUTURES, not spot. A trader on Topstep is in MGC (Micro Gold, 10 oz)
  // or GC (100 oz), and futures carry a basis over spot: measured 4466 against
  // a spot 4410, a 56 point gap. Pricing a futures position off spot is not a
  // rounding error, it is the wrong instrument, and it is what made a stop that
  // the market never traded through look breached.
  // THE TOPSTEP BOARD. Every root a funded trader actually works is a CME
  // future, and Yahoo serves them all off the same chart endpoint MGC already
  // used, so this is one allowlist rather than seven integrations. An explicit
  // Set, never a pattern: the root is interpolated into a URL, so the only
  // safe input is one we named ourselves.
  //   micros  MES MNQ MYM M2K MGC MCL M6E MBT   full  ES NQ YM RTY CL GC
  if (CME_FUTURES_ROOTS.has(normalized)) {
    return {
      key: `yahoo:${normalized}=F`,
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${normalized}%3DF?interval=1m&range=1d`,
      readPrice: (body) => positivePrice(body?.chart?.result?.[0]?.meta?.regularMarketPrice),
      // Yahoo stamps the quote, so the freshness rule reads the market's clock
      // rather than ours, exactly as the metals feed now does.
      readAsOf: (body) => {
        const seconds = body?.chart?.result?.[0]?.meta?.regularMarketTime;
        return Number.isFinite(seconds) ? seconds * 1000 : null;
      },
    };
  }

  if (normalized === 'XAUUSD' || normalized === 'XAGUSD') {
    const metal = normalized.startsWith('XAG') ? 'XAG' : 'XAU';
    return {
      key: `metal:${metal}`,
      url: `https://api.gold-api.com/price/${encodeURIComponent(metal)}`,
      readPrice: (body) => positivePrice(body?.price),
      // THE UPSTREAM'S OWN CLOCK. This feed refreshes roughly every 30s and
      // stamps each quote, and we used to throw that away: polling it every 5s
      // made the same 30s-old quote look like six fresh ticks, and a frozen
      // upstream looked live forever. A quote's age is the upstream's to
      // report, never ours to assume from when we happened to ask.
      readAsOf: (body) => Date.parse(body?.updatedAt ?? '') || null,
    };
  }

  return null;
}

// Roots quoted as continuous front-month futures on Yahoo (`<root>=F`).
// Confirmed returning a live regularMarketPrice before shipping.
const CME_FUTURES_ROOTS = new Set([
  'MES', 'MNQ', 'MYM', 'M2K', 'MGC', 'MCL', 'M6E', 'MBT',
  'ES', 'NQ', 'YM', 'RTY', 'CL', 'GC',
]);

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

/* UPSTREAM LOAD IS PER-INSTANCE, NOT PER-TAB. Every open tab polls this
   endpoint on a 5s timer, and the Topstep board is one upstream request per
   ROOT — so without this, ten tabs on a warm instance meant sixty Yahoo
   requests every five seconds and a rate limit within the hour.

   A short memo on the raw response bounds that: the upstream is asked at most
   once per URL per window however many tabs are watching. It is deliberately
   the RESPONSE that is memoised, not a derived price, so each quote keeps the
   upstream's own timestamp — the freshness rule that decides whether a quote
   may close a trade reads that stamp, and must never see a fresh-looking one
   we minted ourselves. A memo hit is therefore indistinguishable from asking
   again and getting the same 30s-old quote, which is exactly what it is. */
const REMOTE_MEMO_MS = 10000;
const remoteMemo = new Map();

async function fetchRemoteJson(url, fetchImpl) {
  const now = Date.now();
  const memo = remoteMemo.get(url);
  if (memo && now - memo.at < REMOTE_MEMO_MS) return memo.body;
  // Bound the map so a long-lived instance cannot grow one entry per URL for
  // every symbol ever requested.
  if (remoteMemo.size > 64) remoteMemo.clear();
  const body = await fetchRemoteJsonUncached(url, fetchImpl);
  remoteMemo.set(url, { at: now, body });
  return body;
}

async function fetchRemoteJsonUncached(url, fetchImpl) {
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

  // Per symbol: when the UPSTREAM says the quote was taken. Null where a source
  // does not stamp its quotes, which the client then treats as unknown rather
  // than as now.
  const asOf = {};
  requests.forEach((request, index) => {
    const body = bodies[index];
    if (body === null) return;
    const price = request.readPrice(body);
    if (price === null) return;
    const stamp = typeof request.readAsOf === 'function' ? request.readAsOf(body) : null;
    for (const alias of request.aliases) {
      updates[alias] = price;
      if (stamp !== null) asOf[alias] = new Date(stamp).toISOString();
    }
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
    // Deliberately no asOf for a cache hit: the row's age is bounded but its
    // quote time is unknown, and unknown must never read as now.
  }

  return { prices: updates, asOf };
}
