# Docker & HTTPS

Use this path for a homelab, NAS with Docker Compose, or VPS. You need Docker Engine or Docker Desktop with Compose, outbound access to GHCR, and a disk for persistent data. The image supports `linux/amd64` and `linux/arm64`.

## HTTP: local first run

Download two small files — no clone or build:

```sh
mkdir -p servomon && cd servomon
curl -fsSLo compose.yaml https://raw.githubusercontent.com/nirjan-dev/servomon/main/deploy/compose.yaml
curl -fsSLo .env https://raw.githubusercontent.com/nirjan-dev/servomon/main/deploy/.env.example
```

Edit `.env`, replacing `NUXT_BASIC_AUTH_USERS` with your own `user:strong-password` pair. Leave `NUXT_BASIC_AUTH_ENABLED=true`.

```sh
docker compose up -d
docker compose logs -f
```

Open `http://localhost:3000`. The app listens on port 3000 and stores data in the named volume mounted at `/app/data`. HTTP on a published port is not safe for transmitting credentials across a network; add HTTPS before remote use.

## HTTPS with Caddy

Give your host a domain such as `monitor.example.com`, with DNS pointing at it. Permit inbound TCP **80 and 443** so Caddy can obtain a publicly trusted certificate. If behind a router, forward those ports to the Docker host.

Download the **standalone HTTPS compose file**; it is not an override to merge with the HTTP file:

```sh
curl -fsSLo compose.https.yaml https://raw.githubusercontent.com/nirjan-dev/servomon/main/deploy/compose.https.yaml
```

In `.env`, set `SERVOMON_DOMAIN=monitor.example.com` and your operator credentials. If you started the HTTP file above, stop that stack first (do **not** add `-v`; keep its data volume):

```sh
docker compose down
docker compose -f compose.https.yaml up -d
```

Open **https://monitor.example.com**, then [install your first agent](/agent-install). Caddy is the public entry point; the app's port is not published to the host. Keep Caddy's certificate volumes as well as the app data volume.

## LAN-only HTTPS options

You do not have to expose the dashboard to the internet:

- **Tailscale Serve:** keep the HTTP app reachable only from the local proxy, then expose it to your tailnet using [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve). Use its HTTPS URL for `SERVER_URL`. All agent machines need access to that tailnet.
- **Cloudflare Tunnel:** run [cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) to proxy a hostname to the app without inbound router ports. Preserve WebSocket upgrades and unbuffered SSE. Extra identity-provider gates must not intercept the agent's enrollment and bearer-authenticated API traffic. This is a proxy option, not deployment to Cloudflare Workers.
- **Caddy internal CA:** for private hostnames, append `--internal-certs` to the Caddy command in `compose.https.yaml`. `localhost` uses Caddy's local CA automatically. Trust Caddy's root CA on every browser/phone and agent. See [Caddy's local HTTPS guidance](https://caddyserver.com/docs/automatic-https#local-https).

For an internal-CA installation, copy Caddy's root certificate to the directory where you run the installer:

```sh
docker compose -f compose.https.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt ./servomon-ca.crt
curl -fsSL https://github.com/nirjan-dev/servomon/releases/latest/download/install.sh | sh -s -- --server https://monitor.home.arpa --ca-cert ./servomon-ca.crt
```

Replace the hostname with yours. On a different agent machine, securely copy `servomon-ca.crt` there first and verify it came from your Caddy instance. The installer saves it as `/opt/servomon-agent/ca.crt`, supplies it during enrollment, and sets `Environment=DENO_CERT=/opt/servomon-agent/ca.crt` in the service unit. Re-runs preserve it.

Compiled agents honor `DENO_CERT` only in the **process environment**, not when put in the agent's `.env` file. Manual runs can use `DENO_CERT=/path/ca.crt ./servomon-agent`. Alternatively, install the CA in the OS trust store and set `DENO_TLS_CA_STORE=system` in the systemd unit environment. Never disable certificate verification.

Browsers and phones must also trust the CA for a trusted secure context (push/PWA). Tailscale Serve, Cloudflare Tunnel, or a real domain with a publicly trusted certificate (including DNS-challenge issuance where appropriate) are easier LAN choices if you do not want to manage device trust.

## Why HTTPS matters

Operator login and agent tokens travel in HTTP headers. Tickets do not make cleartext HTTP safe. Browser push and installable PWA features also need a secure context (HTTPS, with localhost exceptions). A LAN is not a substitute for TLS.

## Upgrade and backup

Back up the persistent `/app/data` volume before upgrading. For the HTTP stack:

```sh
docker compose pull
docker compose up -d
```

For HTTPS, use `docker compose -f compose.https.yaml` for both commands. Keep one application instance. Never use `docker compose down -v` unless you intend to delete the volumes and their data. Image tags include `latest`, `0.1` and `0.1.0`; pin the full version in your compose file for controlled upgrades.
