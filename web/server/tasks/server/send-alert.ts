import { PushSubscribersService } from "~/server/services/pushSubscribers.service";
import { getSystemConfig } from "../../utils/metricsStore";
import webpush from "web-push";
import { resolveVapidKeys } from "../../utils/vapidKeys";

export default defineTask({
  meta: {
    name: "server:send-alert",
    description: "Send alert when no metrics are available",
  },
  async run({ payload: { message, system } }) {
    let alertMessage: string = (message as string) ?? "alert message not sent";

    const systemConfig = await getSystemConfig(system as string);


    if (systemConfig?.enableAlerts === false) {
      console.log("skipped alert because alerts disabled for " + system);
      return {};
    }

    console.log("sending alert with message: ", alertMessage);
    try {
      await Promise.allSettled([
        sendDiscordAlert(alertMessage),
        sendPushAlerts(alertMessage),
      ]);
      console.log("successfully sent alerts");
    } catch (error) {
      console.log("alerts sending failed", error);
    }

    return {};
  },
});

async function sendPushAlerts(content: string) {
  const keys = await resolveVapidKeys();
  if (!keys) return;
  webpush.setVapidDetails(useRuntimeConfig().pushSubject, keys.publicKey, keys.privateKey);

  const pushSubService = new PushSubscribersService();

  const subs = await pushSubService.getAllSubscriptions();

  if (!subs.length) {
    return;
  }

  console.log("Sending push notification");

  const expiredEndpoints: string[] = [];
  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, content);
    } catch (error) {
      const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
      if (status === 404 || status === 410) {
        expiredEndpoints.push(sub.endpoint);
      } else {
        console.error("[push] Notification delivery failed", error);
      }
    }
  }));
  // Serialize storage updates so two expired subscriptions cannot restore each other.
  for (const endpoint of expiredEndpoints) await pushSubService.removeSubscription(endpoint);
}

async function sendDiscordAlert(content: string) {
  const {
    discordWebhookUrl,
    public: { enableDiscordAlerts },
  } = useRuntimeConfig();

  if (!enableDiscordAlerts) {
    return;
  }

  if (!discordWebhookUrl) {
    throw new Error("No Discord webhook URL provided");
  }

  console.log("Sending Discord alert");

  return $fetch(discordWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
    }),
  });
}
