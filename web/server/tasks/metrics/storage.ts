import { getMetricsForSystem, listSystems } from "../../utils/metricsStore";
import { sendAlert } from "../../utils/alerts";

const storageAlertThreshold = 80;

export default defineTask({
  meta: {
    name: "metrics:storage-check",
    description:
      "Checks used storage percent and sends alert if it exceeds the set threshold",
  },
  async run(_event) {
    const systems = await listSystems();

    await Promise.all(systems.map(async (system) => {
      try {
        await checkStorageForSystem(system);
      } catch (error) {
        console.error("storage check failed for " + system, error);
      }
    }));

    return {};
  },
});
async function checkStorageForSystem(system: string) {
  const { metrics } = await getMetricsForSystem(system);

  if (!metrics.length) {
    return;
  }

  const latestMetric = metrics[0];

  await Promise.all(latestMetric.disk.map(async (diskStats) => {
    if (diskStats.usedPercentage >= storageAlertThreshold) {
      try {
        await sendAlert(system, `Warning: Disk used % greater than ${storageAlertThreshold}% for ${diskStats.mountPoint}`);
      } catch (error) {
        console.error("storage alert failed for " + system + " " + diskStats.mountPoint, error);
      }
    }
  }));
}
