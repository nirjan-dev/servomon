import { Metrics } from "../../../shared/types";

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

    if (!system) {
      throw createError({
        message: "No system parameter sent",
        statusCode: 400,
      });
    }

    let metricsKeys: string[];
    let metrics: Metrics[];

    try {
      metricsKeys = await useStorage(`metrics/${system}`)
        .getKeys()
        .then((keys) => keys.sort((a, b) => Number(b) - Number(a)));

      const MetricsWithValues = await Promise.all(
        metricsKeys.map(async (metricKey) => {
          return await useStorage(`metrics/${system}`).getItem<Metrics>(
            metricKey
          );
        })
      );
      metrics = MetricsWithValues.filter((metricsItem) => metricsItem !== null);
    } catch (error) {
      throw error;
    }

    return {
      statusCode: 200,
      statusMessage: "OK",
      count: metricsKeys.length,
      metrics,
    };
  }
);
