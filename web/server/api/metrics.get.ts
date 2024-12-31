export default defineEventHandler(async (event) => {
  let metricsKeys;
  let metrics;

  try {
    metricsKeys = await useStorage("metrics").getKeys();

    metrics = await Promise.all(
      metricsKeys.map(async (metricKey) => {
        return await useStorage("metrics").getItem(metricKey);
      })
    );
  } catch (error) {
    throw error;
  }

  return {
    statusCode: 200,
    statusMessage: "OK",
    count: metricsKeys.length,
    metrics,
  };
});
