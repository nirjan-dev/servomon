import type { Metrics } from "../../../shared/types";

// S1: shared metrics reads for HTTP handlers and scheduled tasks. Tasks call
// these directly instead of self-HTTP $fetch("/api/..."), which would now hit
// the authentication gate without credentials.
export async function listSystems(): Promise<string[]> {
  const allMetricKeys = await useStorage("metrics").getKeys();
  return [...new Set(allMetricKeys.map((k) => k.split(":")[0]))].filter(Boolean);
}

export async function getMetricsForSystem(system: string): Promise<{ count: number; metrics: Metrics[] }> {
  const metricsKeys = await useStorage(`metrics/${system}`)
    .getKeys()
    .then((keys) => keys.sort((a, b) => Number(b) - Number(a)));
  const withValues = await Promise.all(
    metricsKeys.map((metricKey) => useStorage(`metrics/${system}`).getItem<Metrics>(metricKey))
  );
  return { count: metricsKeys.length, metrics: withValues.filter((m): m is Metrics => m !== null) };
}

export async function getSystemConfig(system: string): Promise<{ enableAlerts: boolean } | null> {
  return useStorage("systemConfigs").getItem<{ enableAlerts: boolean }>(system);
}

// Deletes every stored artifact for a system: metrics samples, alert config,
// liveness state. Idempotent — deleting a system with no data is a no-op.
// Agent enrollment is revoked separately via removeAgentBySystem.
export async function deleteSystemData(system: string): Promise<void> {
  const metricsStorage = useStorage(`metrics/${system}`);
  const keys = await metricsStorage.getKeys();
  await Promise.all(keys.map((key) => metricsStorage.removeItem(key)));
  const configs = useStorage("systemConfigs");
  if (await configs.hasItem(system)) await configs.removeItem(system);
  const state = useStorage("serverState");
  if (await state.hasItem(system)) await state.removeItem(system);
}
