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

// The client-side direct-exchange fallback and cache write-back were deleted
// in the renovation: the PHP proxy is the single price source, so every tab
// stops hitting Binance/gold-api directly and nothing writes the shared cache
// from the browser.
