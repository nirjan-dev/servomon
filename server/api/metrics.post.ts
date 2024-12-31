export default defineEventHandler(async (event) => {
  const metrics = await readBody(event);

  if (!metrics) {
    throw createError({
      statusCode: 400,
      statusMessage: "No metrics provided",
    });
  }

  try {
    await storeMetrics(metrics);
  } catch (error) {
    throw error;
  }

  return {
    statusCode: 200,
    statusMessage: "OK",
  };
});

async function storeMetrics(metrics: any) {
  try {
    await useStorage("metrics").setItem(metrics.timestamp, metrics);
    return true;
  } catch (error) {
    throw error;
  }
}
