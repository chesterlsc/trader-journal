export function normalizeMarketSymbol(symbol) {
  const raw = String(symbol || "").trim().toUpperCase();
  if (!raw) {
    return "";
  }

  let normalized = raw
    .replace(/[:/\s_-]+/g, "")
    .replace(/[^A-Z0-9.]/g, "");

  normalized = normalized.replace(/\.(P|M|PRO|RAW|CASH)$/i, "");
  normalized = normalized.replace(/(USDT|USDC|USD|BTC|ETH)(PERP|FUT|SWAP|SPOT)$/i, "$1");
  normalized = normalized.replace(/(USDT|USDC|USD|BTC|ETH)(M|PRO)$/i, "$1");

  return normalized;
}

export async function fetchLivePricesFromBackend(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return {};
  }

  try {
    const query = encodeURIComponent(symbols.join(","));
    const response = await fetch(`trade_handler.php?action=live_prices&symbols=${query}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store"
    });
    const body = await response.json();
    if (!response.ok || !body?.ok || !body.prices || typeof body.prices !== "object") {
      return {};
    }

    const updates = {};
    Object.entries(body.prices).forEach(([symbol, price]) => {
      const normalized = normalizeMarketSymbol(symbol);
      const nextPrice = Number(price);
      if (normalized && Number.isFinite(nextPrice) && nextPrice > 0) {
        updates[normalized] = nextPrice;
      }
    });

    return updates;
  } catch (error) {
    return {};
  }
}

export async function fetchLivePricesDirect(requests) {
  const updates = {};

  await Promise.all(
    requests.map(async (request) => {
      try {
        const response = await fetch(request.url, {
          method: "GET",
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`${request.key} price request failed`);
        }

        const body = await response.json();
        const nextPrice = request.readPrice(body);
        if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
          return;
        }

        request.aliases.forEach((alias) => {
          updates[alias] = nextPrice;
        });
      } catch (error) {
        // Keep the last known price if a source fails temporarily.
      }
    })
  );

  return updates;
}

export function buildLivePriceRequests(symbols) {
  const requests = new Map();

  symbols.forEach((symbol) => {
    const source = resolveLivePriceSource(symbol);
    if (!source) {
      return;
    }

    if (!requests.has(source.key)) {
      requests.set(source.key, { ...source, aliases: new Set() });
    }

    requests.get(source.key).aliases.add(symbol);
  });

  return Array.from(requests.values()).map((request) => ({
    ...request,
    aliases: Array.from(request.aliases)
  }));
}

export function resolveLivePriceSource(symbol) {
  const normalized = normalizeMarketSymbol(symbol);
  if (!normalized) {
    return null;
  }

  const cryptoMap = {
    BTCUSD: "BTCUSDT",
    BTCUSDT: "BTCUSDT",
    ETHUSD: "ETHUSDT",
    ETHUSDT: "ETHUSDT",
    ETCUSD: "ETCUSDT",
    ETCUSDT: "ETCUSDT",
    SOLUSD: "SOLUSDT",
    SOLUSDT: "SOLUSDT",
    XRPUSD: "XRPUSDT",
    XRPUSDT: "XRPUSDT",
    ADAUSD: "ADAUSDT",
    ADAUSDT: "ADAUSDT",
    DOGEUSD: "DOGEUSDT",
    DOGEUSDT: "DOGEUSDT",
    BNBUSD: "BNBUSDT",
    BNBUSDT: "BNBUSDT",
    LTCUSD: "LTCUSDT",
    LTCUSDT: "LTCUSDT",
    BCHUSD: "BCHUSDT",
    BCHUSDT: "BCHUSDT",
    AVAXUSD: "AVAXUSDT",
    AVAXUSDT: "AVAXUSDT",
    LINKUSD: "LINKUSDT",
    LINKUSDT: "LINKUSDT",
    DOTUSD: "DOTUSDT",
    DOTUSDT: "DOTUSDT",
    TRXUSD: "TRXUSDT",
    TRXUSDT: "TRXUSDT",
    MATICUSD: "MATICUSDT",
    MATICUSDT: "MATICUSDT",
    SUIUSD: "SUIUSDT",
    SUIUSDT: "SUIUSDT",
    TONUSD: "TONUSDT",
    TONUSDT: "TONUSDT",
    SHIBUSD: "SHIBUSDT",
    SHIBUSDT: "SHIBUSDT"
  };

  if (cryptoMap[normalized]) {
    const marketSymbol = cryptoMap[normalized];
    return {
      key: `binance:${marketSymbol}`,
      url: `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(marketSymbol)}`,
      readPrice: (body) => {
        const price = Number(body?.price);
        return Number.isFinite(price) && price > 0 ? price : NaN;
      }
    };
  }

  if (normalized === "XAUUSD" || normalized === "XAGUSD") {
    const metal = normalized.startsWith("XAG") ? "XAG" : "XAU";
    return {
      key: `metal:${metal}`,
      url: `https://api.gold-api.com/price/${metal}`,
      readPrice: (body) => {
        const price = Number(body?.price);
        return Number.isFinite(price) && price > 0 ? price : NaN;
      }
    };
  }

  return null;
}

export async function persistLivePrices(priceMap, csrfToken = "") {
  const prices = Object.entries(priceMap).map(([symbol, price]) => ({
    symbol,
    price
  }));

  if (!prices.length) {
    return;
  }

  try {
    await fetch("trade_handler.php?action=update_prices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      credentials: "same-origin",
      body: JSON.stringify({ prices })
    });
  } catch (error) {
    // Best-effort cache only.
  }
}
