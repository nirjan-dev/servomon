import { computed, onMounted, onUnmounted, readonly, ref, type Ref } from "vue";

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

// One clock shared by every freshness label on the page.
const now = ref(Date.now());
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

export function useNow(): Readonly<Ref<number>> {
  onMounted(() => {
    if (subscribers++ === 0) {
      now.value = Date.now();
      timer = setInterval(() => {
        now.value = Date.now();
      }, TICK_MS);
    }
  });
  onUnmounted(() => {
    if (--subscribers === 0) clearInterval(timer);
  });
  return readonly(now);
}

export function ageLabel(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function freshnessOf(ts: number | null | undefined, at: number): FreshnessState {
  if (ts == null) return "unknown";
  const age = at - ts;
  // Future timestamps (clock skew) count as live, not offline.
  if (age < STALE_AFTER_MS) return "live";
  if (age < OFFLINE_AFTER_MS) return "stale";
  return "offline";
}

export function freshnessLabel(ts: number | null | undefined, at: number): string {
  if (ts == null) return "Waiting for data";
  const age = ageLabel(Math.max(0, at - ts));
  switch (freshnessOf(ts, at)) {
    case "live":
      return `Live · ${age}`;
    case "stale":
      return `Stale · ${age}`;
    default:
      return `Offline · last update ${age}`;
  }
}

export const FRESHNESS_COLOR = {
  live: "success",
  stale: "warning",
  offline: "error",
  unknown: "neutral",
} as const satisfies Record<FreshnessState, string>;

export function useFreshness(newestTimestamp: Ref<number | null | undefined>) {
  const clock = useNow();
  const state = computed(() => freshnessOf(newestTimestamp.value, clock.value));
  const label = computed(() => freshnessLabel(newestTimestamp.value, clock.value));
  const color = computed(() => FRESHNESS_COLOR[state.value]);
  return { state, label, color };
}
