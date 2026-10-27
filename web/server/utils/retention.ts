// S3: explicit retention policy for metrics samples. Single-machine,
// filesystem-backed implementation (no database migration).
//
// Policy: keep samples newer than RETENTION_WINDOW_MS, intersected with the
// newest MAX_SAMPLES. The intersection is the point: a chatty agent cannot
// blow past the count cap, and a quiet stretch cannot fill the window with
// ancient samples. MIN_SAMPLES_FLOOR guarantees a system never shows empty
// just because its agent went quiet — the newest samples always survive.
//
// Invariants:
// - Keys sort numerically by timestamp; out-of-order arrivals are ordered,
//   never used to delete newer data.
// - Deletion only ever removes the oldest samples; the newest floor always
//   survives, even if every sample is older than the window.
export const RETENTION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
export const MAX_SAMPLES = 500;
export const MIN_SAMPLES_FLOOR = 5;

// Pure partition: newest-first sorted keys -> { keep, remove }.
// Exported for unit tests; the task layer only does storage I/O.
export function partitionKeys(
  keys: string[],
  now: number = Date.now(),
  windowMs: number = RETENTION_WINDOW_MS,
  maxSamples: number = MAX_SAMPLES,
  floor: number = MIN_SAMPLES_FLOOR,
): { keep: string[]; remove: string[] } {
  const sorted = [...keys]
    .map((key) => ({ key, ts: Number(key) }))
    .filter((entry) => Number.isFinite(entry.ts))
    .sort((a, b) => b.ts - a.ts);
  const nonNumeric = keys.filter((key) => !Number.isFinite(Number(key)));

  // Candidates: within the window AND within the newest-maxSamples.
  const cutoff = now - windowMs;
  const withinWindow = new Set(sorted.filter((entry) => entry.ts >= cutoff).map((entry) => entry.key));
  const withinCount = new Set(sorted.slice(0, Math.max(0, maxSamples)).map((entry) => entry.key));
  const keep = new Set<string>();
  for (const key of withinWindow) {
    if (withinCount.has(key)) keep.add(key);
  }
  // Floor: the newest `floor` samples always survive.
  for (const entry of sorted.slice(0, Math.max(0, floor))) {
    keep.add(entry.key);
  }

  const remove = sorted.filter((entry) => !keep.has(entry.key)).map((entry) => entry.key);
  // Non-numeric keys are not samples; leave them alone, never delete blindly.
  void nonNumeric;
  return { keep: [...keep], remove };
}
