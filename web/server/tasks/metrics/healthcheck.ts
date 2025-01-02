interface ServerStateKV {
  live: boolean;
}

const SERVER_STATE_KV_KEY = "serverState";

export default defineTask({
  meta: {
    name: "metrics:healthcheck",
    description: "Healthcheck for metrics",
  },
  async run() {
    const metricsKeys = await useStorage("metrics").getKeys();
    let serverState =
      await useStorage().getItem<ServerStateKV>(SERVER_STATE_KV_KEY);
    let isServerLive: boolean;

    if (metricsKeys.length === 0) {
      console.log("No metrics found");

      if (serverState?.live) {
        console.log("server set to live but no metrics, sending alert...");
        runTask("server:send-alert", {
          payload: {
            message: "No metrics found, server might be down",
          },
        });
      }
      isServerLive = false;
    } else {
      if (!serverState?.live) {
        console.log(
          "server not set to live but metrics coming in now, sending alert..."
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
