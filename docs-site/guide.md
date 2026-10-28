# Quick start

You need a host with Docker Compose for the server, and a Linux x86_64 or ARM64 machine for the agent. They can be the same machine. No repository clone, Deno installation or source build is needed.

## 1. Start your server

```sh
mkdir -p servomon && cd servomon
curl -fsSLo compose.yaml https://raw.githubusercontent.com/nirjan-dev/servomon/main/deploy/compose.yaml
curl -fsSLo .env https://raw.githubusercontent.com/nirjan-dev/servomon/main/deploy/.env.example
```

Edit `.env`: set `NUXT_BASIC_AUTH_USERS=admin:replace-with-a-strong-password`. Keep operator authentication enabled, then start:

```sh
docker compose up -d
```

Open `http://localhost:3000` on the Docker host and log in. The compose file downloads the prebuilt image and creates a persistent data volume. Push keys are automatic; no key-generation step is required.

::: warning Before connecting over a network
HTTP is only a local smoke-test path. Operator credentials and agent tokens need HTTPS in transit. For a homelab/VPS, follow [Docker & HTTPS](/server-docker#https-with-caddy). Prefer hosted? Use [Fly.io or Render](/server-hosted), then return here.
:::

## 2. Install an agent and approve it

On the Linux machine you want to monitor, use your server's HTTPS URL:

```sh
curl -fsSL https://github.com/nirjan-dev/servomon/releases/latest/download/install.sh | sh -s -- --server https://monitor.example.com
```

The installer downloads and verifies the binary, asks for sudo where needed, and prints a **pairing code and fingerprint** before enabling its systemd service.

In the dashboard, open **Agents**, find that code, compare the fingerprint label, then **Approve**. Return to the installer: it saves the token and starts the service. Your system should appear on the overview after metrics arrive.

**Agents → Add agent** also gives you a command prefilled with your dashboard's origin and an optional name. Use a unique name per machine. The agent needs no inbound firewall opening.

Next: [enable notifications](/notifications), review [configuration](/configuration), or use [troubleshooting](/troubleshooting). For non-systemd setups and manual installation, see [Install an agent](/agent-install).
