import { listSystems } from "../../utils/metricsStore";


export default defineTask({
  meta: {
    name: "metrics:cleanup",
    description: "Delete old metrics",
  },
  async run() {
    console.log("Cleaning up old metrics");

    const systems = await listSystems();

    systems.forEach((system) => {
      cleanupForSystem(system);
    });

    return {};
  },
});

async function cleanupForSystem(system: string) {
  const metricsKeys = await useStorage(`metrics/${system}`).getKeys();

  if (metricsKeys.length <= MIN_METRICS_TO_KEEP) {
    console.log("Not enough metrics to clean up");
    return;
  }

  const cleanupCount = metricsKeys.length - MIN_METRICS_TO_KEEP;

  const metricsKeysToDelete = metricsKeys.splice(0, cleanupCount);

  for (const metricKey of metricsKeysToDelete) {
    await useStorage(`metrics/${system}`).removeItem(metricKey);
  }

  console.log(`Deleted ${metricsKeysToDelete.length} metrics`);
}
