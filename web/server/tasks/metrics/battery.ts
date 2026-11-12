import { getMetricsForSystem, listSystems } from "../../utils/metricsStore";
import { isLowBattery } from "../../utils/battery";
import { sendAlert } from "../../utils/alerts";

const batteryAlertThreshold = 50;

export default defineTask({
  meta: {
    name: "metrics:battery-check",
    description:
      "Checks battery percent and sends alert if it is lower than the set threshold",
  },
  async run(_event) {
    const systems = await listSystems();

    await Promise.all(systems.map(async (system) => {
      try {
        await batteryCheckForSystem(system);
      } catch (error) {
        console.error("battery check failed for " + system, error);
      }
    }));

    return {};
  },
});

async function batteryCheckForSystem(system: string) {
  const { metrics } = await getMetricsForSystem(system);

  if (!metrics.length) {
    return;
  }

  const latestMetric = metrics[0];

  if (!isLowBattery(latestMetric.battery.charge, batteryAlertThreshold)) {
    return;
  }

  await sendAlert(system, `Warning: Battery % lower than ${batteryAlertThreshold}% for ${system}`);
}
