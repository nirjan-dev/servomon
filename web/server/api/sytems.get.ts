export default defineEventHandler(async (_event) => {
  const allMetricKeys = await useStorage("metrics").getKeys();
  const uniqueKeys = [...new Set(allMetricKeys.map((k) => k.split(":")[0]))];

  return uniqueKeys;
});
