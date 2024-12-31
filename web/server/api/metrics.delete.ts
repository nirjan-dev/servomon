export default defineEventHandler(async (event) => {
  const { timestamp } = await readBody(event);

  try {
    await useStorage("metrics").removeItem(timestamp);
    return {
      statusCode: 200,
      statusMessage: "OK",
    };
  } catch (error) {
    throw error;
  }
});
