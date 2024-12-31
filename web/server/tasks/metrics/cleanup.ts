export default defineTask({
  meta: {
    name: "metrics:cleanup",
    description: "Delete old metrics",
  },
  async run() {
    console.log("Cleaning up old metrics");

    const {
      public: { metricsToCleanUp },
    } = useRuntimeConfig();

    const metricsKeys = await useStorage("metrics").getKeys();

    if (metricsKeys.length === 0) {
      console.log("No metrics to clean up");
      return {};
    }

    const cleanupCount = Math.min(metricsKeys.length, metricsToCleanUp);

    const metricsKeysToDelete = metricsKeys.splice(0, cleanupCount);

    for (const metricKey of metricsKeysToDelete) {
      await useStorage("metrics").removeItem(metricKey);
    }

    console.log(`Deleted ${metricsKeysToDelete.length} metrics`);

    return {};
  },
});
