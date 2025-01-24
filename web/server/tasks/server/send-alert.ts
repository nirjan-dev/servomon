import { PushSubscribersService } from "~/server/services/pushSubscribers.service";
import webpush from "web-push";

export default defineTask({
  meta: {
    name: "server:send-alert",
    description: "Send alert when no metrics are available",
  },
  async run({ payload: { message } }) {
    let alertMessage: string = (message as string) ?? "alert message not sent";
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
  const {
    public: { pushPublicKey },
    pushPrivateKey,
  } = useRuntimeConfig();

  if (!pushPrivateKey || !pushPublicKey) {
    throw new Error("No push public or private keys");
  }

  webpush.setVapidDetails(
    "https://nkmonitor.fly.dev",
    pushPublicKey,
    pushPrivateKey
  );

  const pushSubService = new PushSubscribersService();

  const subs = await pushSubService.getAllSubscriptions();

  if (!subs.length) {
    return;
  }

  console.log("Sending push notification");

  let notificationPromises: any[] = [];

  subs.forEach((sub) => {
    notificationPromises.push(webpush.sendNotification(sub, content));
  });

  return Promise.allSettled(notificationPromises);
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
