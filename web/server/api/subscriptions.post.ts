import { PushSubscribersService } from "~/server/services/pushSubscribers.service";

export default defineEventHandler(async (event) => {
  const newSubscription = await readBody(event);

  if (!newSubscription || !newSubscription.endpoint) {
    throw createError({
      message: "invalid new subscription sent",
    });
  }

  const pushSubscribersService = new PushSubscribersService();
  const addedNewSub =
    await pushSubscribersService.addSubscription(newSubscription);

  if (addedNewSub) {
    return {
      statusCode: 204,
    };
  }

  return {
    statusCode: 500,
    message: "Error adding new push subscription",
  };
});
