import type { Metrics } from "../../../shared/types";
import { getMetricsForSystem } from "../utils/metricsStore";

// S1: operator-only (enforced by middleware). Reads via the shared store helper.
export default defineEventHandler(
  async (
    event
  ): Promise<{
    statusCode: number;
    statusMessage: string;
    count: number;
    metrics: Metrics[];
  }> => {
    const { system } = getQuery(event);

    if (!system || typeof system !== "string") {
      throw createError({
        message: "No system parameter sent",
        statusCode: 400,
      });
    }

    const { count, metrics } = await getMetricsForSystem(system);

    return {
      statusCode: 200,
      statusMessage: "OK",
      count,
      metrics,
    };
  }
);
