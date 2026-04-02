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
