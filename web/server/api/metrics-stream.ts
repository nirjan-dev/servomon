import type { Metrics } from "../../../shared/types";
import { MAX_SAMPLES } from "../utils/retention";

// S3: delta stream protocol. The old endpoint re-read every stored key and
// pushed the full array every 2s per open tab. Now:
// - First push (or every RESYNC_EVERY_N-th push): full sorted array, newest
//   MAX_SAMPLES, as { type: "sync", metrics }.
// - Otherwise: only samples newer than the last pushed timestamp, as
//   { type: "delta", metrics }. Empty deltas still push (heartbeat proving
//   liveness), but no sample is re-read or re-sent.
// Clients append deltas and trim to MAX_SAMPLES; a sync replaces wholesale.
// Payloads and reads are bounded in both directions.
const PUSH_INTERVAL_MS = 2000;
const RESYNC_EVERY_N = 15; // full sync every ~30s

export default defineEventHandler((event) => {
  const { name } = getQuery(event);
  if (!name || typeof name !== "string") {
    throw createError({ statusCode: 400, message: "No system name parameter sent" });
  }
  const system = name;
  const metricsStream = createEventStream(event);

  let lastPushedTs = -1;
  let pushCount = 0;
  let closed = false;

  const push = async () => {
    if (closed) return;
    try {
      const storage = useStorage(`metrics/${system}`);
      const keys = await storage.getKeys();
      const sorted = keys
        .map((key) => ({ key, ts: Number(key) }))
        .filter((entry) => Number.isFinite(entry.ts))
        .sort((a, b) => a.ts - b.ts);

      const forceSync = pushCount % RESYNC_EVERY_N === 0;
      pushCount += 1;

      if (forceSync) {
        const windowed = sorted.slice(-MAX_SAMPLES);
        const metrics = (
          await Promise.all(windowed.map((entry) => storage.getItem<Metrics>(entry.key)))
        ).filter((m): m is Metrics => m !== null);
        if (metrics.length > 0) {
          lastPushedTs = metrics[metrics.length - 1].timestamp;
        }
        metricsStream.push(JSON.stringify({ type: "sync", metrics }));
        return;
      }

      const fresh = sorted.filter((entry) => entry.ts > lastPushedTs);
      const metrics = (
        await Promise.all(fresh.map((entry) => storage.getItem<Metrics>(entry.key)))
      ).filter((m): m is Metrics => m !== null);
      if (metrics.length > 0) {
        lastPushedTs = metrics[metrics.length - 1].timestamp;
      }
      metricsStream.push(JSON.stringify({ type: "delta", metrics }));
    } catch (error) {
      console.error("metrics stream push failed", error);
    }
  };

  // Push immediately on connect so clients never wait a full interval.
  void push();
  const interval = setInterval(push, PUSH_INTERVAL_MS);

  metricsStream.onClosed(async () => {
    closed = true;
    clearInterval(interval);
    await metricsStream.close();
  });

  return metricsStream.send();
});
