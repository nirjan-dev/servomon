import type { Metrics } from "../../../shared/types";

import { metricsSchema } from "~/shared/schemas.zod";
import { authenticate, authenticateAgent, bearerToken } from "../utils/auth";
import { touchAgent } from "../utils/agentStore";

// S1: agent ingestion. The middleware already enforced operator-or-agent auth.
// The system name is taken from the enrolled agent's token binding — a body
// `name` that disagrees is a 403 (an agent cannot impersonate another system).
export default defineEventHandler(async (event) => {
  const operator = authenticate(event);
  const agent = operator
    ? null
    : await authenticateAgent(bearerToken(getHeader(event, "authorization")));
  if (!operator && !agent) {
    throw createError({ statusCode: 401, statusMessage: "Authentication required" });
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

  if (agent && metricsData.data.name !== agent.system) {
    throw createError({
      statusCode: 403,
      statusMessage: "Agent token is not valid for this system",
    });
  }

  try {
    await storeMetrics(metricsData.data);
  } catch (error) {
    throw error;
  }

  if (agent) await touchAgent(agent.agentId);

  return {
    statusCode: 201,
    statusMessage: "OK",
  };
});

async function storeMetrics(metrics: Metrics) {
  try {
    await useStorage(`metrics/${metrics.name}`).setItem(
      String(metrics.timestamp),
      metrics
    );
    return true;
  } catch (error) {
    throw error;
  }
}
