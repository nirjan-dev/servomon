import { Metrics } from "../../../shared/types";

import { metricsSchema } from "~/shared/schemas.zod";

export default defineEventHandler(async (event) => {
  const { agentToken } = useRuntimeConfig();

  const authHeader = getHeader(event, "Authorization");

  const token = authHeader?.split(" ")[1];

  if (!token || token !== agentToken) {
    throw createError({
      statusCode: 403,
      statusMessage: "No token or unauthorized agent token in header",
    });
  }

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
    statusCode: 201,
    statusMessage: "OK",
  };
});

async function storeMetrics(metrics: Metrics) {
  try {
    await useStorage(`metrics/${metrics.name}`).setItem(
      metrics.timestamp,
      metrics
    );
    return true;
  } catch (error) {
    throw error;
  }
}
