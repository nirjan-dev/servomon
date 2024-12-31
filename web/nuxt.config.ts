// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  nitro: {
    storage: {
      metrics: {
        driver: "memory",
      },
    },
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      "* * * * *": ["metrics:healthcheck"],
      "*/2 * * * *": ["metrics:cleanup"],
    },
  },
  modules: ["@nuxt/ui"],
  compatibilityDate: "2024-12-30",
  runtimeConfig: {
    discordWebhookUrl: "",
    public: {
      enableDiscordAlerts: false,
      metricsToCleanUp: 20,
    },
  },
});
