const storageAlertThreshold = 80;

export default defineTask({
  meta: {
    name: "metrics:storage-check",
    description:
      "Checks used storage percent and sends alert if it exceeds the set threshold",
  },
  async run(_event) {
    const systems = (await $fetch("/api/sytems")) ?? [];

    systems.forEach((system) => {
      checkStorageForSystem(system);
    });

    return {};
  },
});
async function checkStorageForSystem(system: string) {
  const metricsResponse = await $fetch("/api/metrics", {
    params: {
      system,
    },
  });

  if (!metricsResponse || !metricsResponse.metrics.length) {
    return;
  }

  const latestMetric = metricsResponse.metrics[0];

  latestMetric.disk.forEach((diskStats) => {
    if (diskStats.usedPercentage >= storageAlertThreshold) {
      runTask("server:send-alert", {
        payload: {
          message: `Warning: Disk used % greater than ${storageAlertThreshold}% for ${diskStats.mountPoint}`,
        },
      });
    }
  });
}
