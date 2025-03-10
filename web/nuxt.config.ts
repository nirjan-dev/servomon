// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  alias: {
    "@global-shared/*": "../../shared/*",
  },
  ssr: false,
  nitro: {
    storage: {
      metrics: {
        driver: "fs",
        base: "./data/metrics",
      },
      pushSubs: {
        driver: "fs",
        base: "./data/pushSubs",
      },
      serverState: {
        driver: "fs",
        base: "./data/serverState",
      },
      systemConfigs: {
        driver: "fs",
        base: "./data/systemConfigs",
      },
    },
    experimental: {
      tasks: true,
      websocket: true,
    },
    scheduledTasks: {
      "* * * * *": ["metrics:healthcheck"],
      "*/2 * * * *": ["metrics:cleanup"],
      "0 * * * *": ["metrics:battery"],
      "0 9 * * *": ["metrics:storage"],
    },
  },
  modules: ["@nuxt/ui", "@kgierke/nuxt-basic-auth", "@vite-pwa/nuxt"],
  compatibilityDate: "2024-12-30",
  runtimeConfig: {
    discordWebhookUrl: "",
    public: {
      enableDiscordAlerts: false,
      pushPublicKey: "",
    },
    agentToken: "",
    pushPrivateKey: "",
  },
  basicAuth: {
    allowedRoutes: ["/api/.*"],
  },
  app: {
    head: {
      link: [
        {
          rel: "icon",
          href: "/favicon.ico",
          sizes: "48x48",
        },
        {
          rel: "icon",
          href: "/favicon.svg",
          sizes: "any",
          type: "image/svg+xml",
        },
        {
          rel: "apple-touch-icon",
          href: "/apple-touch-icon-180x180.png",
        },
      ],
    },
  },
  pwa: {
    devOptions: {
      enabled: false,
    },
    workbox: {
      skipWaiting: true,
      runtimeCaching: [
        {
          urlPattern: new RegExp("^.*"),
          handler: "NetworkOnly",
        },
      ],
      importScripts: ["sw-custom.js"],
    },
    manifest: {
      name: "Servomon - Simple Home Server Monitoring",
      short_name: "Servomon",
      background_color: "#121212",
      description:
        "Monitor your home server metrics easily with the servomon web app",
      theme_color: "#a3e635",
      screenshots: [
        {
          src: "/screenshots/mobile-screenshot-1.png",
          sizes: "428x926",
          form_factor: "narrow",
          label: "mobile view",
        },

        {
          src: "/screenshots/mobile-screenshot-2.png",
          sizes: "428x926",
          form_factor: "narrow",
          label: "mobile view",
        },
        {
          src: "/screenshots/mobile-screenshot-3.png",
          sizes: "428x926",
          form_factor: "narrow",
          label: "mobile view",
        },
        {
          src: "/screenshots/mobile-screenshot-4.png",
          sizes: "428x926",
          form_factor: "narrow",
          label: "mobile view",
        },
        {
          src: "/screenshots/desktop-screenshot-1.png",
          form_factor: "wide",
          sizes: "1440x900",
          label: "desktop view",
        },
        {
          src: "/screenshots/desktop-screenshot-2.png",
          form_factor: "wide",
          sizes: "1440x900",
          label: "desktop view",
        },
        {
          src: "/screenshots/desktop-screenshot-3.png",
          form_factor: "wide",
          sizes: "1440x900",
          label: "desktop view",
        },
      ],
      icons: [
        {
          src: "pwa-64x64.png",
          sizes: "64x64",
          type: "image/png",
        },
        {
          src: "pwa-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "pwa-512x512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "maskable-icon-512x512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
  },
});
