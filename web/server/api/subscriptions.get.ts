import { PushSubscribersService } from "~/server/services/pushSubscribers.service";

export default defineEventHandler(async (_event) => {
  const pushSubsService = new PushSubscribersService();

  const subs = await pushSubsService.getAllSubscriptions();

  return {
    statusCode: 201,
    subs,
  };
});
