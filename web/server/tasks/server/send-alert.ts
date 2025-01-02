export default defineTask({
  meta: {
    name: "server:send-alert",
    description: "Send alert when no metrics are available",
  },
  async run({ payload: { message } }) {
    let alertMessage: string = (message as string) ?? "alert message not sent";
    console.log("sending alert with message: ", alertMessage);
    await sendDiscordAlert(alertMessage);
    return {};
  },
});

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
