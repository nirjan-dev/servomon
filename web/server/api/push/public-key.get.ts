import { resolveVapidKeys } from "../../utils/vapidKeys";

// The default operator-only rule in 10-api-auth covers this route.
export default defineEventHandler(async () => {
  const keys = await resolveVapidKeys();
  if (!keys) throw createError({ statusCode: 503, statusMessage: "Push notifications are disabled: configure both VAPID keys or neither" });
  return { publicKey: keys.publicKey };
});
