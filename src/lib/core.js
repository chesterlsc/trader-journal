// `store` is the storage-target indirection guest/demo mode routes through:
// a real session writes localStorage, a demo session writes sessionStorage so
// the journal dies with the tab. Everything else about the read/write path is
// identical, which is the point — no duplicated persistence logic.
export function readStorageJson(key, fallback, store = localStorage) {
  try {
    const raw = store.getItem(key);
    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

export function writeStorageJson(key, value, store = localStorage) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error("Storage write failed:", error);
  }
}

export function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function ensureNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ensurePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function ensureNonNegative(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function sortTradesAsc(a, b) {
  const dateSort = String(a.date).localeCompare(String(b.date));
  if (dateSort !== 0) {
    return dateSort;
  }

  return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

export function sortTradesDesc(a, b) {
  return sortTradesAsc(b, a);
}

export function escapeCsvValue(value) {
  const stringValue = String(value).replace(/"/g, '""');
  return `"${stringValue}"`;
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function setMessage(node, text, kind) {
  if (!node) {
    return;
  }

  node.textContent = text;
  node.classList.remove("success", "error", "notice");
  if (kind) {
    node.classList.add(kind);
  }
}

export function round(value) {
  return Math.round(value * 100) / 100;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getWeekKey(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return "unknown-week";
  }

  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// A stop or target is an ORDER in the journal's model: when the live price
// crosses the level, the trade is done and the fill is the LEVEL itself —
// the price a resting order would fill at, not whatever the 5s poll happened
// to see on the far side of it. If one poll gaps past both levels at once,
// the stop wins: the honest assumption is the pessimistic one.
/**
 * The ONE reading of a trade's side. "Buy" | "Sell" | "" when it cannot be told.
 *
 * This exists because `direction === "Sell"` was compared literally in the
 * auto-close path while NOTHING enforced the value: app.js normalizeTrades did
 * `String(item.direction || "Buy")` and the server sanitizer did
 * `str(item.direction ?? 'Buy')`, both straight passthroughs. So "SELL",
 * "short", " Sell" or "" all read as a LONG, and a short's stop sits ABOVE its
 * entry, which means `price <= stop` was true on the very first poll and the
 * position stopped out instantly at a price that had never moved.
 */
export function normalizeDirection(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "") return "";
  if (raw.includes("sell") || raw.includes("short") || raw === "s") return "Sell";
  if (raw.includes("buy") || raw.includes("long") || raw === "b" || raw === "l") return "Buy";
  return "";
}

/**
 * May a price be used to CLOSE a trade?
 *
 * Only if a poll confirmed it within maxAgeMs. The server backfills any symbol
 * its upstreams could not answer out of a database cache, and the live_prices
 * response carries no timestamp, so a frozen price is indistinguishable from a
 * live one on the wire. Displaying the last known number is honest; closing a
 * real position against it is not.
 */
export function priceCanCloseTrade(confirmedAt, now, maxAgeMs) {
  if (!Number.isFinite(confirmedAt) || !Number.isFinite(now) || !Number.isFinite(maxAgeMs)) {
    return false;
  }
  const age = now - confirmedAt;
  // A negative age means a clock moved under us. Refuse rather than trust it.
  return age >= 0 && age <= maxAgeMs;
}

/**
 * Was this trade's level ALREADY beyond the market when it was logged?
 *
 * A stop or a target is an order: it fills on a price that CROSSES it while the
 * order is live. A level the market had already passed was never crossed, so
 * firing it invents a fill at a price the market left long ago. This reports
 * that state so the UI can say so plainly instead of the trade going quiet.
 */
export function levelAlreadyPassed(trade, price) {
  const hit = openTradeTriggerLevel(trade, price);
  return hit === null ? null : hit.level;
}

export function openTradeTriggerLevel(trade, price) {
  if (!trade || trade.status !== "open" || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  // FAIL CLOSED. A side we cannot read is not assumed to be long: guessing here
  // closes a real position at a price that never traded, and a journal that
  // invents a fill is worse than one that misses one. An unreadable direction
  // rides until the trader closes it themselves.
  const side = normalizeDirection(trade.direction);
  if (side === "") {
    return null;
  }
  const isSell = side === "Sell";
  const stop = Number(trade.stopLoss);
  const target = Number(trade.takeProfit);
  if (stop > 0 && (isSell ? price >= stop : price <= stop)) {
    return { level: "stop", fill: stop };
  }
  if (target > 0 && (isSell ? price <= target : price >= target)) {
    return { level: "target", fill: target };
  }
  return null;
}
