export default defineEventHandler(async (event) => {
  const { system } = getQuery(event);

  if (!system || typeof system !== "string") {
    throw createError({
      statusCode: 400,
      message: "Invalid system",
    });
  }

  return useStorage("systemConfigs").getItem<{
    enableAlerts: boolean;
  }>(system);
});
