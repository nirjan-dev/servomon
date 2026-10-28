import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(
  defineConfig({
    title: "Servomon",
    description: "Simple home server monitoring — secure by default",
    base: "/",
    themeConfig: {
      nav: [
        { text: "Guide", link: "/guide" },
        { text: "WebSocket auth", link: "/websocket-auth" },
        { text: "Agent enrollment", link: "/agent-enrollment" },
      ],
      sidebar: [
        {
          text: "Start here",
          items: [
            { text: "Overview", link: "/" },
            { text: "Installation & setup", link: "/guide" },
            { text: "Demo", link: "/demo" },
          ],
        },
        {
          text: "Security design",
          items: [
            { text: "WebSocket authentication", link: "/websocket-auth" },
            { text: "Agent enrollment", link: "/agent-enrollment" },
          ],
        },
      ],
      socialLinks: [{ icon: "github", link: "https://github.com/nirjan-dev/servomon" }],
    },
  }),
);
