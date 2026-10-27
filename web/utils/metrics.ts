// Formatting and threshold helpers for agent metrics. Wire formats come from
// agent/main.ts: memory and disk sizes are numbers in GiB (bytes / 1024^3),
// CPU is an integer percent, and some fields arrive pre-formatted as strings:
// process/container percentages ("12.40%"), container memory ("148.00 MBs",
// computed as bytes / 1024^2) and network rates ("2.40 MiB/s").

export type Level = "ok" | "warning" | "critical";

// The disk warning matches the server's storage alert (tasks/metrics/storage.ts).
const LIMITS = {
  cpu: { warning: 80, critical: 95 },
  memory: { warning: 80, critical: 90 },
  disk: { warning: 80, critical: 90 },
} as const;

export type MetricKind = keyof typeof LIMITS;

export function levelOf(kind: MetricKind, percent: number | null | undefined): Level {
  if (percent == null || !Number.isFinite(percent)) return "ok";
  const limit = LIMITS[kind];
  if (percent >= limit.critical) return "critical";
  if (percent >= limit.warning) return "warning";
  return "ok";
}

// Nuxt UI color per level: values stay neutral until they cross a threshold.
export const LEVEL_COLOR = { ok: "neutral", warning: "warning", critical: "error" } as const;
export const LEVEL_TEXT = { ok: "text-highlighted", warning: "text-warning", critical: "text-error" } as const;

export function parsePercent(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

const RATE_UNITS: Record<string, number> = {
  "bytes/s": 1,
  "KiB/s": 1024,
  "MiB/s": 1024 ** 2,
  "GiB/s": 1024 ** 3,
};

// "2.40 MiB/s" -> bytes per second; null when the format is unknown.
export function parseRate(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(bytes\/s|KiB\/s|MiB\/s|GiB\/s)\s*$/.exec(value);
  if (!match) return null;
  return Number.parseFloat(match[1]!) * RATE_UNITS[match[2]!]!;
}

// Three significant digits at most: 812 KiB/s, 2.4 MiB/s, 18.6 KiB/s.
function compact(n: number): string {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return trimZero(n.toFixed(1));
  return trimZero(n.toFixed(2));
}

function trimZero(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function formatNumber(n: number): string {
  return compact(n);
}

// Y-axis for byte rates: steps on binary boundaries (256 KiB/s, 1 MiB/s, ...)
// instead of decimal ticks that print as 977 KiB/s.
export function rateScale(max: number, count = 3): { ticks: number[]; top: number } {
  if (!(max > 0)) return { ticks: [0, 1024], top: 1024 };
  let unit = 1;
  while (max / unit >= 1024 && unit < 1024 ** 3) unit *= 1024;
  const raw = max / unit / count;
  const steps = unit > 1 ? [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500] : [1, 2, 5, 10, 20, 50, 100, 200, 500];
  const step = (steps.find((s) => s >= raw) ?? 1000) * unit;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(t);
  return { ticks, top };
}

export function formatRate(bytesPerSecond: number): string {
  const units = ["B/s", "KiB/s", "MiB/s", "GiB/s"];
  let value = bytesPerSecond;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${compact(value)} ${units[unit]}`;
}

// Agent rate string reformatted consistently; unknown formats pass through.
export function displayRate(value: string | null | undefined): string {
  const bytes = parseRate(value);
  if (bytes == null) return value || "—";
  return formatRate(bytes);
}

export function formatGiB(gib: number): string {
  if (gib >= 1024) return `${compact(gib / 1024)} TiB`;
  return `${compact(gib)} GiB`;
}

// Container memory: "148.00 MBs" (MiB) -> "148 MiB" / "7.9 GiB".
export function displayMiB(value: string | null | undefined): string {
  const mib = value ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(mib)) return value || "—";
  return mib >= 1024 ? `${compact(mib / 1024)} GiB` : `${compact(mib)} MiB`;
}

export function formatPercent(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}
