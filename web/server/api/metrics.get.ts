import { Metrics } from "../../../shared/types";

export default defineEventHandler(
  async (
    _event
  ): Promise<{
    statusCode: number;
    statusMessage: string;
    count: number;
    metrics: Metrics[];
  }> => {
    let metricsKeys: string[];
    let metrics: Metrics[];

    try {
      metricsKeys = await useStorage("metrics")
        .getKeys()
        .then((keys) => keys.sort((a, b) => Number(b) - Number(a)));

      const MetricsWithValues = await Promise.all(
        metricsKeys.map(async (metricKey) => {
          return await useStorage("metrics").getItem<Metrics>(metricKey);
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
