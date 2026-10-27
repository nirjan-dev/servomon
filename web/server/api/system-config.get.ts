import { getSystemConfig } from "../utils/metricsStore";

// S1: operator-only (enforced by middleware).
export default defineEventHandler(async (event) => {
  const { system } = getQuery(event);

  if (!system || typeof system !== "string") {
    throw createError({
      statusCode: 400,
      message: "Invalid system",
    });
  }

  return getSystemConfig(system);
});
