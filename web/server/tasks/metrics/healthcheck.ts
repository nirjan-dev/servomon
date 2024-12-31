export default defineTask({
  meta: {
    name: "metrics:healthcheck",
    description: "Healthcheck for metrics",
  },
  async run() {
    const metricsKeys = await useStorage("metrics").getKeys();

    if (metricsKeys.length === 0) {
      console.log("No metrics found, server might be down");
      runTask("metrics:send-alert");
      return {};
    }

    return {};
  },
});
