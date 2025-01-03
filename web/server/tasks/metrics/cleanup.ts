const MIN_METRICS_TO_KEEP = 5;

export default defineTask({
  meta: {
    name: "metrics:cleanup",
    description: "Delete old metrics",
  },
  async run() {
    console.log("Cleaning up old metrics");

    const metricsKeys = await useStorage("metrics").getKeys();

    if (metricsKeys.length <= MIN_METRICS_TO_KEEP) {
      console.log("Not enough metrics to clean up");
      return {};
    }

    const cleanupCount = metricsKeys.length - MIN_METRICS_TO_KEEP;

    const metricsKeysToDelete = metricsKeys.splice(0, cleanupCount);

    for (const metricKey of metricsKeysToDelete) {
      await useStorage("metrics").removeItem(metricKey);
    }

    console.log(`Deleted ${metricsKeysToDelete.length} metrics`);

    return {};
  },
});
