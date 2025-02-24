const batteryAlertThreshold = 50;

export default defineTask({
  meta: {
    name: "metrics:battery-check",
    description:
      "Checks battery percent and sends alert if it is lower than the set threshold",
  },
  async run(_event) {
    const systems = (await $fetch("/api/sytems")) ?? [];

    systems.forEach((system) => {
      batteryCheckForSystem(system);
    });

    return {};
  },
});

async function batteryCheckForSystem(system: string) {
  const metricsResponse = await $fetch("/api/metrics", {
    params: {
      system,
    },
  });

  if (!metricsResponse || !metricsResponse.metrics.length) {
    return;
  }

  const latestMetric = metricsResponse.metrics[0];

  if (latestMetric.battery.charge > batteryAlertThreshold) {
    return;
  }

  runTask("server:send-alert", {
    payload: {
      message: `Warning: Battery % lower than ${batteryAlertThreshold}% for ${system}`,
    },
  });
}
