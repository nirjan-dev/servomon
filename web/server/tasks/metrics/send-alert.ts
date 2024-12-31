export default defineTask({
  meta: {
    name: "metrics:send-alert",
    description: "Send alert when no metrics are available",
  },
  async run() {
    await sendDiscordAlert("No metrics available, server is probably down");
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
