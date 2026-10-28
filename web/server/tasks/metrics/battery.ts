import { getMetricsForSystem, listSystems } from "../../utils/metricsStore";
import { isLowBattery } from "../../utils/battery";

const batteryAlertThreshold = 50;

export default defineTask({
  meta: {
    name: "metrics:battery-check",
    description:
      "Checks battery percent and sends alert if it is lower than the set threshold",
  },
  async run(_event) {
    const systems = await listSystems();

    systems.forEach((system) => {
      batteryCheckForSystem(system);
    });

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

  runTask("server:send-alert", {
    payload: {
      message: `Warning: Battery % lower than ${batteryAlertThreshold}% for ${system}`,
      system,
    },
  });
}
