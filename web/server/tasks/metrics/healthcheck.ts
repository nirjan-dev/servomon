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
    const systems = (await $fetch("/api/sytems")) ?? [];

    systems.forEach((system) => {
      healthCheckForSystem(system);
    });

    return {};
  },
});

async function healthCheckForSystem(system: string) {
  const metricsResponse = await $fetch("/api/metrics", {
    params: {
      system,
    },
  });

  let serverState =
    await useStorage("serverState").getItem<ServerStateKV>(system);
  let isServerLive: boolean;

  if (
    !metricsResponse ||
    metricsResponse.count === 0 ||
    !isWithinGivenMinutesOfCurrentTime(
      metricsResponse.metrics[0].timestamp,
      MIN_TO_CHECK_UPTIME
    )
  ) {
    console.log("last metric timestamp not within specified threshold");

    if (serverState?.live) {
      console.log("server set to live but no new metrics, sending alert...");
      runTask("server:send-alert", {
        payload: {
          message: `No new metrics found, ${system} might be down`,
          system,
        },
      });
    }
    isServerLive = false;
  } else {
    if (!serverState?.live) {
      console.log(
        "server not set to live but new metrics coming in now, sending alert..."
      );
      runTask("server:send-alert", {
        payload: {
          message: `Metrics coming in again, ${system} might be up again`,
          system,
        },
      });
    }

    isServerLive = true;
  }

  await useStorage("serverState").setItem<ServerStateKV>(system, {
    live: isServerLive,
  });
}
