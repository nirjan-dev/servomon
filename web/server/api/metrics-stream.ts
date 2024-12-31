export default defineEventHandler(async (event) => {
  const metricsStream = createEventStream(event);

  const interval = setInterval(async () => {
    const metricsKeys = await useStorage("metrics").getKeys();

    const metrics = await Promise.all(
      metricsKeys.map(async (metricKey) => {
        return await useStorage("metrics").getItem(metricKey);
      })
    );
    metricsStream.push(JSON.stringify(metrics));
  }, 2000);

  metricsStream.onClosed(async () => {
    clearInterval(interval);
    await metricsStream.close();
  });

  return metricsStream.send();
});
