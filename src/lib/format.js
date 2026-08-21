export function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value || 0);
}

export function formatCompactCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value || 0);
}

/* Money in a stat tile, written the way a trader writes it: whole dollars
   under $1,000, comma thousands to $9,999, compact above. Never one decimal
   place on a dollar figure, which reads as a typo rather than precision. */
export function formatStatMoney(value) {
  const abs = Math.abs(Number(value) || 0);
  const sign = Number(value) < 0 ? "-" : "";
  if (abs < 1000) return `${sign}$${Math.round(abs)}`;
  if (abs < 10000) return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1
  }).format(value || 0);
}

export function formatChartDateLabel(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}
