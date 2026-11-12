import { PushSubscribersService } from "~/server/services/pushSubscribers.service";
import { getSystemConfig } from "./metricsStore";
import webpush from "web-push";
import { resolveVapidKeys } from "./vapidKeys";

let subscriptionCleanup = Promise.resolve();

export async function sendAlert(system: string, message: string) {
  try {
    const systemConfig = await getSystemConfig(system);

    if (systemConfig?.enableAlerts === false) {
      console.log("skipped alert because alerts disabled for " + system);
      return;
    }

    console.log("sending alert with message: ", message);
    const results = await Promise.allSettled([
      sendDiscordAlert(message),
      sendPushAlerts(message),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("alerts sending failed", result.reason);
      }
    }
  } catch (error) {
    console.error("alert config lookup failed for " + system, error);
  }
}

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
  // Serialize cleanup across alerts so expired subscriptions cannot restore each other.
  const cleanup = subscriptionCleanup.then(async () => {
    for (const endpoint of expiredEndpoints) await pushSubService.removeSubscription(endpoint);
  });
  subscriptionCleanup = cleanup.catch(() => {});
  await cleanup;
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
