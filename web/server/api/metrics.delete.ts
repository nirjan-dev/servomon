export default defineEventHandler(async (event) => {
  const { timestamp, system } = await readBody(event);

  if (!timestamp || !system) {
    throw createError({
      message: "No timestamp or system parameters sent",
      statusCode: 400,
    });
  }

  try {
    await useStorage(`metrics/${system}`).removeItem(timestamp);
    return {
      statusCode: 200,
      statusMessage: "OK",
    };
  } catch (error) {
    throw error;
  }
});
