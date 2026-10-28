import { PushSubscribersService } from "../services/pushSubscribers.service";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  if (!body || typeof body.endpoint !== "string" || !body.endpoint) {
    throw createError({ statusCode: 400, statusMessage: "A subscription endpoint is required" });
  }
  await new PushSubscribersService().removeSubscription(body.endpoint);
  setResponseStatus(event, 204);
  return null;
});
