interface ServerStateKV {
  live: boolean;
}

const SERVER_STATE_KV_KEY = "serverState";
const MIN_TO_CHECK_UPTIME = 3;

/**
 *
 * @param timeStamp the timestamp to check if it's within a certain minute window from now
 * @param minutesWithinNow how many minutes do you want to check if the timestamp is within
 * @returns true or false based on if it's within that timeframe ornot
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
    const metricsResponse = await $fetch("/api/metrics");

    let serverState =
      await useStorage().getItem<ServerStateKV>(SERVER_STATE_KV_KEY);
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
            message: "No new metrics found, server might be down",
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
            message: "Metrics coming in again, server might be up again",
          },
        });
      }

      isServerLive = true;
    }

    await useStorage().setItem<ServerStateKV>(SERVER_STATE_KV_KEY, {
      live: isServerLive,
    });
    return {};
  },
});
