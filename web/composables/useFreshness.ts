import { computed, onMounted, onUnmounted, ref, type Ref } from "vue";

// S2: client-side data freshness derived from the newest metric timestamp in
// each SSE push. No new endpoint: the stream already delivers timestamps every
// 2s, so states recover the instant fresh data arrives.
//
// Thresholds:
// - live: newest sample < 60s old (default agent posts every ~6s; 60s = ~10
//   missed posts, tolerant of one slow interval without flapping).
// - stale: 60s–3min. Data is shown but flagged old.
// - offline: > 3min, matching the server healthcheck's MIN_TO_CHECK_UPTIME.
// - unknown: no samples yet.
export type FreshnessState = "live" | "stale" | "offline" | "unknown";

export const STALE_AFTER_MS = 60_000;
export const OFFLINE_AFTER_MS = 180_000;

const TICK_MS = 10_000;

function ageLabel(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function useFreshness(newestTimestamp: Ref<number | undefined>) {
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    timer = setInterval(() => {
      now.value = Date.now();
    }, TICK_MS);
  });

  onUnmounted(() => {
    clearInterval(timer);
  });

  const state = computed<FreshnessState>(() => {
    const ts = newestTimestamp.value;
    if (ts === undefined) return "unknown";
    const age = now.value - ts;
    // Future timestamps (clock skew) count as live, not offline.
    if (age < STALE_AFTER_MS) return "live";
    if (age < OFFLINE_AFTER_MS) return "stale";
    return "offline";
  });

  const label = computed(() => {
    const ts = newestTimestamp.value;
    if (ts === undefined) return "Waiting for data";
    const age = Math.max(0, now.value - ts);
    switch (state.value) {
      case "live":
        return `Live · ${ageLabel(age)}`;
      case "stale":
        return `Stale · ${ageLabel(age)}`;
      case "offline":
        return `Offline · last update ${ageLabel(age)}`;
      default:
        return "Waiting for data";
    }
  });

  const dotClass = computed(() => {
    switch (state.value) {
      case "live":
        return "bg-green-500";
      case "stale":
        return "bg-yellow-500";
      case "offline":
        return "bg-red-500";
      default:
        return "bg-neutral-500";
    }
  });

  return { state, label, dotClass };
}
