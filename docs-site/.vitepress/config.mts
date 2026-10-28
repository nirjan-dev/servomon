import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(
  defineConfig({
    title: "Servomon",
    description: "Your Linux servers, live — from homelab to hosted.",
    base: "/",
    head: [
      ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
      ["link", { rel: "alternate icon", href: "/favicon.ico" }],
      ["link", { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon-180x180.png" }],
    ],
    themeConfig: {
      logo: "/favicon.svg",
      nav: [
        { text: "Get started", link: "/guide" },
        { text: "Configuration", link: "/configuration" },
        { text: "Demo", link: "/demo" },
      ],
      sidebar: [
        { text: "Start here", items: [
          { text: "Introduction & features", link: "/introduction" },
          { text: "Quick start", link: "/guide" },
          { text: "Architecture", link: "/architecture" },
          { text: "Demo", link: "/demo" },
        ] },
        { text: "Install & operate", items: [
          { text: "Docker & HTTPS", link: "/server-docker" },
          { text: "Fly.io & Render", link: "/server-hosted" },
          { text: "Install an agent", link: "/agent-install" },
          { text: "Configuration reference", link: "/configuration" },
          { text: "Notifications", link: "/notifications" },
          { text: "Troubleshooting", link: "/troubleshooting" },
        ] },
        { text: "Security design", items: [
          { text: "WebSocket authentication", link: "/websocket-auth" },
          { text: "Agent enrollment", link: "/agent-enrollment" },
        ] },
      ],
      socialLinks: [{ icon: "github", link: "https://github.com/nirjan-dev/servomon" }],
      footer: { message: "Released under the MIT License." },
    },
  }),
);
