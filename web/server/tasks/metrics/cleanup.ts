const METRICS_TO_DELETE = 5;

export default defineTask({
  meta: {
    name: "metrics:cleanup",
    description: "Delete old metrics",
  },
  async run() {
    console.log("Cleaning up old metrics");

    const metricsKeys = await useStorage("metrics").getKeys();

    if (metricsKeys.length === 0) {
      console.log("No metrics to clean up");
      return {};
    }

    const cleanupCount = Math.min(metricsKeys.length, METRICS_TO_DELETE);

    const metricsKeysToDelete = metricsKeys.splice(0, cleanupCount);

    for (const metricKey of metricsKeysToDelete) {
      await useStorage("metrics").removeItem(metricKey);
    }

    console.log(`Deleted ${metricsKeysToDelete.length} metrics`);

    return {};
  },
});
