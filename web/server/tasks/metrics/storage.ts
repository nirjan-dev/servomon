import { getMetricsForSystem, listSystems } from "../../utils/metricsStore";

const storageAlertThreshold = 80;

export default defineTask({
  meta: {
    name: "metrics:storage-check",
    description:
      "Checks used storage percent and sends alert if it exceeds the set threshold",
  },
  async run(_event) {
    const systems = await listSystems();

    systems.forEach((system) => {
      checkStorageForSystem(system);
    });

    return {};
  },
});
async function checkStorageForSystem(system: string) {
  const { metrics } = await getMetricsForSystem(system);

  if (!metrics.length) {
    return;
  }

  const latestMetric = metrics[0];

  latestMetric.disk.forEach((diskStats) => {
    if (diskStats.usedPercentage >= storageAlertThreshold) {
      runTask("server:send-alert", {
        payload: {
          message: `Warning: Disk used % greater than ${storageAlertThreshold}% for ${diskStats.mountPoint}`,
          system,
        },
      });
    }
  });
}
