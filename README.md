# Servomon — Simple Home Server Monitoring

A self-hosted dashboard for your Linux machines: run one web server, approve an agent on each machine, and see your fleet live.

[Documentation](https://servomon.nirjan.dev/) · [Demo](https://servomon.nirjan.dev/demo) · [Releases](https://github.com/nirjan-dev/servomon/releases)

## Features

- **Live metrics:** CPU, memory, disk, network, battery, processes and Docker containers across multiple servers.
- **Remote actions:** stop/pause/unpause containers and kill processes, with command audit logging.
- **Honest freshness:** live, stale and offline states instead of frozen metrics pretending to be current.
- **Alerts:** web push and Discord for downtime/recovery, low battery and low storage; per-system alert toggles.
- **Installable PWA:** use the dashboard from your desktop or phone.
- **Secure by default:** operator login, individual agent enrollment/revocation and single-use WebSocket tickets.
- **Predictable retention:** metrics use a 24-hour window intersected with a newest-500 cap, keeping at least the newest five.

![Overview: every system with live status, CPU trend, memory, disk and network](./web/public/screenshots/desktop-dashboard.png)
![System detail in dark mode: CPU, memory and network charts, storage, containers and processes](./web/public/screenshots/desktop-detail.png)
![Overview on mobile](./web/public/screenshots/mobile-dashboard.png)

## Quick start

### 1. Start the server

Docker Compose, without cloning or building:

```sh
mkdir -p servomon && cd servomon
curl -fsSLo compose.yaml https://raw.githubusercontent.com/nirjan-dev/servomon/main/deploy/compose.yaml
curl -fsSLo .env https://raw.githubusercontent.com/nirjan-dev/servomon/main/deploy/.env.example
# Edit .env: set NUXT_BASIC_AUTH_USERS=admin:your-strong-password
docker compose up -d
```

Open **http://localhost:3000** and log in. Before connecting across a network, [set up HTTPS](https://servomon.nirjan.dev/server-docker#https-with-caddy): credentials and agent tokens must not travel in cleartext. Prefer hosted? See [Fly.io and Render](https://servomon.nirjan.dev/server-hosted).

### 2. Install and approve an agent

On the Linux x86_64 or ARM64 machine you want to monitor:

```sh
curl -fsSL https://github.com/nirjan-dev/servomon/releases/latest/download/install.sh | sh -s -- --server https://monitor.example.com
```

Replace the URL with your server's HTTPS origin. On **Agents**, match the printed pairing code and fingerprint label, then **Approve**. The installer saves its token and starts `servomon-agent.service` as the invoking user. **Agents → Add agent** can generate a prefilled installer command.

See the docs for [manual agent installation, upgrades and uninstall](https://servomon.nirjan.dev/agent-install), [configuration](https://servomon.nirjan.dev/configuration), [notifications](https://servomon.nirjan.dev/notifications), [troubleshooting](https://servomon.nirjan.dev/troubleshooting), and [architecture](https://servomon.nirjan.dev/architecture). Security trade-offs are documented in [WebSocket authentication](https://servomon.nirjan.dev/websocket-auth) and [agent enrollment](https://servomon.nirjan.dev/agent-enrollment).

## Tech stack

- **Web:** Nuxt 4 / Nitro, Vue, Nuxt UI, Tailwind CSS and Unovis charts; filesystem-backed storage, SSE and WebSockets.
- **Agent:** Deno-compiled Linux binary, TypeScript, systeminformation and Zod.
- **Docs:** VitePress with Mermaid, published at [servomon.nirjan.dev](https://servomon.nirjan.dev/).

Run the app as **one long-lived server with a persistent disk**. Docker, Fly.io and Render are supported paths; Vercel and Cloudflare Workers are not.

## Releasing

Maintainers: bump **both** `agent/deno.json` and `web/package.json` to the same version, then push a matching **`vX.Y.Z`** tag (first release: `v0.1.0`). `.github/workflows/release.yml` rejects mismatched versions, compiles Linux x86_64 and ARM64 agents, publishes `install.sh` and `SHA256SUMS` alongside them, and builds a multi-architecture GHCR image (`ghcr.io/nirjan-dev/servomon`, tags `X.Y.Z`, `X.Y`, `latest`). One tag versions the whole project.

## License

[MIT](./LICENSE)
