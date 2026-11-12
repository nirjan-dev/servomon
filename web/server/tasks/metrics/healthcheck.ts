import { getMetricsForSystem, listSystems } from "../../utils/metricsStore";
import { sendAlert } from "../../utils/alerts";

interface ServerStateKV {
  live: boolean;
}

const MIN_TO_CHECK_UPTIME = 3;

/**
 *
 * @param timeStamp the timestamp to check if it's within a certain minute window from now
 * @param minutesWithinNow how many minutes do you want to check if the timestamp is within
 * @returns true or false based on if it's within that timeframe or not
 */
function isWithinGivenMinutesOfCurrentTime(
  timeStamp: number,
  minutesWithinNow: number
): boolean {
  const now = Date.now();
  const minutesWithinNowInMilliSeconds = minutesWithinNow * 60 * 1000;
  const timeToCheckWithin = now - minutesWithinNowInMilliSeconds;

  const timeToCheck = new Date(timeStamp).getTime();

  return timeToCheck >= timeToCheckWithin;
}

export default defineTask({
  meta: {
    name: "metrics:healthcheck",
    description: "Healthcheck for metrics",
  },
  async run() {
    const systems = await listSystems();

    await Promise.all(systems.map(async (system) => {
      try {
        await healthCheckForSystem(system);
      } catch (error) {
        console.error("health check failed for " + system, error);
      }
    }));

    return {};
  },
});

async function healthCheckForSystem(system: string) {
  const { count, metrics } = await getMetricsForSystem(system);


  let serverState =
    await useStorage("serverState").getItem<ServerStateKV>(system);
  let isServerLive: boolean;

  if (
    count === 0 ||
    !isWithinGivenMinutesOfCurrentTime(
      metrics[0].timestamp,
      MIN_TO_CHECK_UPTIME
    )
  ) {
    console.log("last metric timestamp not within specified threshold");

    if (serverState?.live) {
      console.log("server set to live but no new metrics, sending alert...");
      await sendAlert(system, `No new metrics found, ${system} might be down`);
    }
    isServerLive = false;
  } else {
    if (!serverState?.live) {
      console.log(
        "server not set to live but new metrics coming in now, sending alert..."
      );
      await sendAlert(system, `Metrics coming in again, ${system} might be up again`);
    }

    isServerLive = true;
  }

  await useStorage("serverState").setItem<ServerStateKV>(system, {
    live: isServerLive,
  });
}
