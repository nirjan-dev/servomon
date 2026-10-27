import { onUnmounted, ref, type Ref } from "vue";
import type { Metrics } from "../../shared/types";

// S3: client side of the delta stream protocol (see
// web/server/api/metrics-stream.ts). Keeps a single bounded array per system:
// - "sync" replaces wholesale (connect + periodic resync).
// - "delta" appends new samples, trims to MAX_CLIENT_SAMPLES.
// Out-of-order or duplicate arrivals are merged by timestamp, never duplicated.
export const MAX_CLIENT_SAMPLES = 500;

type StreamMessage = { type: "sync"; metrics: Metrics[] } | { type: "delta"; metrics: Metrics[] };

export function useMetricsStream(system: Ref<string> | string) {
  const metrics: Ref<Metrics[]> = ref([]);
  // True once the first sync arrived: lets callers tell "no data" from "loading".
  const synced = ref(false);
  let stream: EventSource | null = null;

  function apply(message: StreamMessage) {
    if (message.type === "sync") {
      metrics.value = [...message.metrics]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-MAX_CLIENT_SAMPLES);
      synced.value = true;
      return;
    }
    if (!message.metrics.length) return; // heartbeat, nothing new
    const seen = new Set(metrics.value.map((m) => m.timestamp));
    const merged = [...metrics.value];
    for (const sample of message.metrics) {
      if (!seen.has(sample.timestamp)) {
        seen.add(sample.timestamp);
        merged.push(sample);
      }
    }
    merged.sort((a, b) => a.timestamp - b.timestamp);
    metrics.value = merged.slice(-MAX_CLIENT_SAMPLES);
  }

  function connect() {
    disconnect();
    const name = typeof system === "string" ? system : system.value;
    stream = new EventSource(`/api/metrics-stream?name=${encodeURIComponent(name)}`);
    stream.onmessage = (event) => {
      try {
        apply(JSON.parse(event.data) as StreamMessage);
      } catch (error) {
        console.error("failed to parse metrics stream message", error);
      }
    };
    stream.onerror = () => {
      // EventSource auto-reconnects; the server re-syncs on reconnect.
      console.log("metrics stream error, waiting for reconnect");
    };
  }

  function disconnect() {
    stream?.close();
    stream = null;
  }

  onUnmounted(() => {
    disconnect();
  });

  return { metrics, synced, connect, disconnect };
}
