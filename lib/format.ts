export function money(n: number, currency = "USD", compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: compact || Math.abs(n) >= 1000 ? 0 : 2,
    notation: compact ? "compact" : "standard",
  }).format(n);
}

export function num(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

export function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
