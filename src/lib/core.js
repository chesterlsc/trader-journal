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
