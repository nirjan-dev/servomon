import { PushSubscribersService } from "~/server/services/pushSubscribers.service";

export default defineEventHandler(async (event) => {
  const { endpoint } = await getQuery(event);

  if (!endpoint || typeof endpoint !== "string") {
    throw createError({
      message: "no valid endpoint query param provided",
    });
  }

  const pushSubscribersService = new PushSubscribersService();

  const isSubscribed = await pushSubscribersService.isSubscribed(endpoint);

  return {
    statusCode: 200,
    isSubscribed,
  };
});
