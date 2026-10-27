# Servomon - Simple Home Server Monitoring

Servomon helps you monitor Linux servers through an easy-to-use web app. It consists of two parts:
- A web app for viewing server metrics
- An agent that runs on your servers to collect and send data

## Key Features

- **Secure by default**: the dashboard and API require an operator login; each agent gets its own token via dashboard approval (see "Adding an agent"); WebSocket connections use single-use handshake tickets ([how they work and why](docs/websocket-auth.md)) and every forwarded command is audit-logged
- **Comprehensive Monitoring**:
  - Memory usage
  - Network performance (speed, errors, drops)
  - Disk usage
  - CPU usage
  - Battery percentage
  - Docker container stats
  - Top process tracking
- **Remote Management**:
  - Stop, pause and unpause Docker containers
  - Kill active processes
- **Flexible**:
  - Monitor multiple servers
  - Install as PWA on your phone
- **Alerting**:
  - Web push notifications
  - Discord Alerts
  - Supports these alerts by default: low battery, low storage, and server downtime

![Web App Screenshot](./web/public/screenshots/desktop-screenshot-2.png)
![Web App Screenshot](./web/public/screenshots/desktop-screenshot-3.png)
![Web App Screenshot](./web/public/screenshots/mobile-screenshot-2.png)
![Web App Screenshot](./web/public/screenshots/mobile-screenshot-4.png)

## Installation

### Web App

#### Option 1: Local Docker Install
1. Clone the repository
2. Navigate to the web directory
3. Create an `.env` file: `cp .env.example .env` (edit as needed)
4. Start container: `docker compose up -d`

#### Option 2: Fly.io Deploy
1. Edit `fly.toml` as needed
2. Create data volume: `fly volumes create data`
3. Set secrets: `fly secrets set NUXT_BASIC_AUTH_USERS="you:strong-password"`
4. Deploy: `fly deploy`

> Fly.io terminates TLS for `*.fly.dev` automatically. If you self-host elsewhere, serve the app behind TLS (Caddy, Tailscale Serve, Cloudflare Tunnel, …) — agent tokens travel in HTTP headers and must never cross the network in cleartext.

### Agent Setup

1. Download the binary from `/agent/dist/servomon-agent` (or build with `deno task build`)
2. Make executable: `chmod +x path/to/executable`
3. Create `.env` file in same folder (copy from `/agent/.env.example`), setting `SERVER_URL` and `NAME`. Leave `AGENT_TOKEN` empty.
4. Run: `/path/to/binary/servomon-agent`

### Adding an agent

On first run (no `AGENT_TOKEN`), the agent prints a pairing code and waits:

1. Open the dashboard and log in with your operator credentials.
2. In the **Agents** section, find the pending request. Check the fingerprint matches what the agent printed.
3. Click **Approve**. The agent receives its token automatically and starts sending metrics.

For the protocol walkthrough, diagrams, recovery behavior, and current security limits, see [Agent enrollment](docs/agent-enrollment.md). The pairing code currently also authorizes token collection: keep it secret. The displayed fingerprint is a comparison label, not verified proof of private-key ownership.

To remove an agent, click **Remove** next to it. Its token stops working immediately and its connection is closed. Pairing codes expire after 15 minutes; denied requests never receive a token.

To fully delete a monitored system — its card on the dashboard, stored metrics, alert config, and enrollment — click **Delete** on its system card. This cannot be undone.

To run in background:
- Quick method: Press `Ctrl + Z`, then type `bg`
- Recommended: Set up systemd service
  - Example file at `/agent/servomon_agent.service`
  - Copy to `/etc/systemd/system/`
  - Run:
    ```
    sudo systemctl daemon-reload
    sudo systemctl enable servomon_agent
    sudo systemctl start servomon_agent
    systemctl status servomon_agent
    ```

## Tech Stack

- [Deno](https://deno.com): JavaScript runtime used to compile the agent into an executable binary.
- [Nuxt](https://nuxt.com): Fullstack Typescript framework that powers the web app.
- [Nuxt UI & Tailwind](https://ui.nuxt.com): For UI components and custom styling
- [Zod](https://zod.dev): For runtime validation
- [@unovis/vue](https://unovis.dev/): Library for chart components
- [Typescript](https://www.typescriptlang.org/)
- Websockets: For running commands sent from the web app on the servers.
- [systeminformation](https://systeminformation.io/): Library to collect system information from the servers

## License
[MIT](https://github.com/nirjan-dev/servomon/tree/main/LICENSE)
