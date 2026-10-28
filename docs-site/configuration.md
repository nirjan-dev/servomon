# Configuration reference

The canonical server template is [`deploy/.env.example`](https://github.com/nirjan-dev/servomon/blob/main/deploy/.env.example). Download it for Compose, or enter the variables in your host's secret/environment settings. For source development from `web/`, use `cp ../deploy/.env.example .env`.

## Server

| Variable | Required / default | Meaning |
| --- | --- | --- |
| `NUXT_BASIC_AUTH_USERS` | **Required**, no usable default | Operator credentials: `user:password` or `user:password,user2:password2`. Use strong passwords; treat the whole value as secret. |
| `NUXT_BASIC_AUTH_ENABLED` | `true` | Leave enabled. The API also enforces its own credential checks; disabling this is not a supported onboarding shortcut. |
| `NUXT_PUBLIC_PUSH_PUBLIC_KEY` | Optional, automatic when both keys unset | VAPID public key; set together with the private key to pin your own pair. |
| `NUXT_PUSH_PRIVATE_KEY` | Optional, automatic when both keys unset | Secret VAPID private key. Always provide the complete pair or neither. |
| `NUXT_PUSH_SUBJECT` | `https://servomon.nirjan.dev` | VAPID contact, a `mailto:` or `https:` URI. Set your own contact for your installation. |
| `NUXT_DISCORD_WEBHOOK_URL` | Optional, unset | Secret Discord incoming webhook URL. |
| `NUXT_PUBLIC_ENABLE_DISCORD_ALERTS` | `false` | Set `true` to enable Discord delivery; also set the webhook URL. |
| `NUXT_WS_TICKET_TTL_SECONDS` | `60` | Single-use WebSocket handshake ticket lifetime in seconds. |
| `PORT` | `3000` | Server listen port inside the container. |
| `SERVOMON_DATA_DIR` | Optional; normal container root `/app/data` | Override for the filesystem data root, also used by tests. Keep it on persistent storage. |
| `SERVOMON_DOMAIN` | Required only for `deploy/compose.https.yaml` | Hostname used by Caddy, e.g. `monitor.example.com`. Not an application runtime variable. |

When both VAPID keys are unset, the server generates a pair on first boot and persists it in `serverState` storage. An environment-provided pair always wins. Keep that storage across restarts. See [notifications](/notifications) before rotating keys.

Use one server instance with a persistent `/app/data` volume. Do not expose `.env`, volume contents or private keys in support logs or source control.

## Agent

The binary loads `.env` from its current working directory; installer-managed instances use `/opt/servomon-agent/.env`. Restart the service after changes:

```sh
sudo systemctl restart servomon-agent
```

| Variable | Required / default | Meaning |
| --- | --- | --- |
| `SERVER_URL` | **Required** | Base URL of your Servomon server. Use HTTPS for network traffic. |
| `NAME` | Sanitized hostname | System name, using `A–Z`, `a–z`, `0–9`, `.`, `_`, `-`; server names must be 1–64 characters and start with a letter or digit. Must be unique in your instance. |
| `SEND_REQUESTS` | `true` | Only the literal string `false` disables metrics submission. |
| `REQUESTS_PER_MINUTE_UNIT` | `20` | Number of requests per `MINUTE_UNIT` minutes. |
| `MINUTE_UNIT` | `2` | Interval is `MINUTE_UNIT × 60 / REQUESTS_PER_MINUTE_UNIT` seconds: **6 seconds** by default. |
| `PORT` | `8282` | Local debug metrics HTTP endpoint, bound only to `127.0.0.1`; no inbound port needs opening. |
| `AGENT_TOKEN` | Written by enrollment | Secret bearer token. Empty/absent triggers enrollment; a revoked nonempty token does not automatically re-enroll. |
| `AGENT_ID` | Written by enrollment | Agent identifier saved alongside the token. |
| `DOCKER_SOCKET` | Optional | Explicit Unix socket path, taking precedence over all other engine discovery. |
| `DOCKER_HOST` | Optional | `unix://` endpoint honored after `DOCKER_SOCKET`; TCP engines are not the documented discovery path. |

[Agent installation](/agent-install#docker-desktop-for-linux) lists the complete Docker socket resolution order and upgrade/uninstall behavior. Keep `.servomon-identity.json` in the same working directory and protect both credential files.

### Private-CA runtime settings

`DENO_CERT` (path to a CA certificate) and `DENO_TLS_CA_STORE=system` (use OS-installed trust roots) are Deno **process environment** settings. Do not put them in the agent's `.env`: it is loaded too late to configure TLS trust. The installer's optional `--ca-cert FILE` copies the certificate and sets the unit environment for you. See [private-CA setup](/agent-install#private-ca-https).
