import { Metrics } from "../../../shared/types";

import { metricsSchema } from "~/shared/schemas.zod";

export default defineEventHandler(async (event) => {
  const metricsData = await readValidatedBody(event, (body) =>
    metricsSchema.safeParse(body)
  );

  if (!metricsData.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid metrics data",
      data: metricsData.error.issues,
    });
  }

  try {
    await storeMetrics(metricsData.data);
  } catch (error) {
    throw error;
  }

  return {
    statusCode: 200,
    statusMessage: "OK",
  };
});

async function storeMetrics(metrics: Metrics) {
  try {
    await useStorage("metrics").setItem(metrics.timestamp, metrics);
    return true;
  } catch (error) {
    throw error;
  }
}
