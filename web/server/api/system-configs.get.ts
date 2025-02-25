export default defineEventHandler(async (event) => {
  const storage = useStorage("systemConfigs");

  const keys = await storage.getKeys();

  const systemConfigs: Record<string, { enableAlerts: boolean }> = {};

  await Promise.allSettled(
    keys.map((k) => {
      return storage
        .getItem<{
          enableAlerts: boolean;
        }>(k)
        .then((config) => {
          if (config) {
            systemConfigs[k] = config;
          }
        });
    })
  );

  return systemConfigs;
});
