// Structured agent logging: one JSON object per line, so journald keeps each
// event on one line and `journalctl -o cat | jq` can filter by field.
// error/warn go to stderr, info/debug to stdout.

export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogFields = Record<string, unknown>;

const SEVERITY: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

let threshold = SEVERITY.info;

export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(SEVERITY, value);
}

/** Applies LOG_LEVEL; returns false when the value was invalid and `info` was kept. */
export function configureLogging(level: string | undefined): boolean {
  const normalized = level?.trim().toLowerCase();
  if (!normalized) return true;
  if (!isLogLevel(normalized)) return false;
  threshold = SEVERITY[normalized];
  return true;
}

export function isLogEnabled(level: LogLevel): boolean {
  return SEVERITY[level] <= threshold;
}

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    const error: Record<string, unknown> = { name: value.name, message: value.message };
    if (value.cause !== undefined) error.cause = serialize(value.cause);
    return error;
  }
  // Deno reports WebSocket failures as ErrorEvent, which stringifies to "[object ErrorEvent]".
  if (typeof ErrorEvent !== "undefined" && value instanceof ErrorEvent) {
    return { name: "ErrorEvent", message: value.message };
  }
  return value;
}

function write(level: LogLevel, msg: string, fields?: LogFields): void {
  if (!isLogEnabled(level)) return;
  const entry: Record<string, unknown> = { time: new Date().toISOString(), level, msg };
  if (fields) {
    for (const [key, value] of Object.entries(fields)) entry[key] = serialize(value);
  }
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
};
