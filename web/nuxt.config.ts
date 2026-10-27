// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
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
      agents: {
        driver: "fs",
        base: "./data/agents",
      },
      audit: {
        driver: "fs",
        base: "./data/audit",
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
  // Fonts are self-hosted from npm (fontsource): no build-time or runtime
  // requests to font CDNs, so @nuxt/fonts is turned off.
  ui: { fonts: false },
  css: [
    "@fontsource-variable/ibm-plex-sans",
    "@fontsource/ibm-plex-mono/400.css",
    "@fontsource/ibm-plex-mono/500.css",
    "@fontsource/ibm-plex-mono/600.css",
    "~/assets/css/main.css",
  ],
  // With ssr off, icons missing from the client bundle are fetched from the
  // public Iconify API at runtime; scan the sources and bundle them instead.
  icon: { clientBundle: { scan: true } },
  vite: {
    build: {
      // One stylesheet, linked from the HTML. With split CSS, a chunk's
      // preload list names the entry stylesheet, but its content hash doesn't
      // cover that name: after a CSS-only change the chunk keeps its URL
      // (served immutable) while its content changes, so returning browsers
      // run a cached copy that loads the previous build's stylesheet on top.
      cssCodeSplit: false,
    },
  },
  compatibilityDate: "2024-12-30",
  runtimeConfig: {
    discordWebhookUrl: "",
    public: {
      enableDiscordAlerts: false,
      pushPublicKey: "",
    },
    wsTicketTtlSeconds: 60,
    pushPrivateKey: "",
  },
  basicAuth: {
    enabled: true,
    // Outer gate only: exempts paths where non-Basic credentials are valid.
    // server/middleware/10-api-auth.ts is authoritative for every route.
    allowedRoutes: ["^/api/metrics", "^/api/ws-ticket", "^/api/ws", "^/api/enroll/"],
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
      // Splash: the dark UI background (ink-950). Title bar: the logo's slate.
      background_color: "#080d12",
      description:
        "Monitor your home server metrics easily with the servomon web app",
      theme_color: "#2c3e50",
      // Captured at 2x device pixel ratio; sizes are the image pixel sizes.
      screenshots: [
        {
          src: "/screenshots/mobile-screenshot-1.png",
          sizes: "856x1852",
          form_factor: "narrow",
          label: "Overview of every system",
        },
        {
          src: "/screenshots/mobile-screenshot-2.png",
          sizes: "856x1852",
          form_factor: "narrow",
          label: "System charts",
        },
        {
          src: "/screenshots/mobile-screenshot-3.png",
          sizes: "856x1852",
          form_factor: "narrow",
          label: "Containers and processes",
        },
        {
          src: "/screenshots/mobile-screenshot-4.png",
          sizes: "856x1852",
          form_factor: "narrow",
          label: "Agent approval",
        },
        {
          src: "/screenshots/desktop-screenshot-1.png",
          form_factor: "wide",
          sizes: "2880x1800",
          label: "Overview of every system",
        },
        {
          src: "/screenshots/desktop-screenshot-2.png",
          form_factor: "wide",
          sizes: "2880x1800",
          label: "System detail",
        },
        {
          src: "/screenshots/desktop-screenshot-3.png",
          form_factor: "wide",
          sizes: "2880x1800",
          label: "Agent approval",
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
