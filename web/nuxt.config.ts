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
      "* * * * *": ["metrics:cleanup", "metrics:healthcheck"],
    },
  },
  modules: ["@nuxt/ui"],
  compatibilityDate: "2024-12-30",
  runtimeConfig: {
    discordWebhookUrl: "",
    public: {
      enableDiscordAlerts: false,
    },
  },
});
