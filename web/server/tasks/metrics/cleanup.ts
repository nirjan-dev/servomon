import { listSystems } from "../../utils/metricsStore";
import { partitionKeys } from "../../utils/retention";

export default defineTask({
  meta: {
    name: "metrics:cleanup",
    description: "Delete metrics outside the retention policy",
  },
  async run() {
    console.log("Cleaning up old metrics");

    const systems = await listSystems();

    const results = await Promise.allSettled(systems.map((system) => cleanupForSystem(system)));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error(`Cleanup failed for ${failed.length} system(s)`);
    }

    return { cleaned: systems.length - failed.length, failed: failed.length };
  },
});

async function cleanupForSystem(system: string) {
  const storage = useStorage(`metrics/${system}`);
  const metricsKeys = await storage.getKeys();

  const { remove } = partitionKeys(metricsKeys);

  if (remove.length === 0) {
    console.log(`No metrics to clean up for ${system}`);
    return;
  }

  const deletions = await Promise.allSettled(remove.map((metricKey) => storage.removeItem(metricKey)));
  const deleted = deletions.filter((d) => d.status === "fulfilled").length;

  console.log(`Deleted ${deleted}/${remove.length} metrics for ${system}`);
}
