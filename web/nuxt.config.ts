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
      "* * * * *": ["metrics:cleanup"],
    },
  },
  modules: ["@nuxt/ui"],
  compatibilityDate: "2024-12-30",
});
