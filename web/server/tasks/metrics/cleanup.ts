const MAX_METRICS = 5;

export default defineTask({
  meta: {
    name: "metrics:cleanup",
    description: "Delete old metrics",
  },
  async run() {
    console.log("Cleaning up old metrics");

    const metricsKeys = await useStorage("metrics").getKeys();

    if (metricsKeys.length < MAX_METRICS) {
      console.log("Not enough metrics to clean up");
      return;
    }

    const metricsKeysToDelete = metricsKeys.splice(
      0,
      metricsKeys.length - MAX_METRICS
    );

    for (const metricKey of metricsKeysToDelete) {
      await useStorage("metrics").removeItem(metricKey);
    }

    console.log(`Deleted ${metricsKeysToDelete.length} metrics`);
  },
});
