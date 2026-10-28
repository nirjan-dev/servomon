# Troubleshooting

Start with agent logs (`journalctl -u servomon-agent -f`) and server logs (`docker compose logs -f`, or your host's log viewer). Do not share tokens, `.env`, identity files, webhook URLs or raw credential-bearing requests.

## No containers shown

- Confirm Docker is running as the service user: `docker ps` and `docker context show` should refer to the engine you expect.
- On Docker Desktop for Linux, `/var/run/docker.sock` may not exist. The agent discovers the active Docker context, then tries `~/.docker/desktop/docker.sock` before the standard engine socket.
- If needed, set `DOCKER_SOCKET=/home/YOUR-USER/.docker/desktop/docker.sock` in `/opt/servomon-agent/.env` and restart with `sudo systemctl restart servomon-agent`. Use your actual path, not another user's socket.
- Check socket ownership and access. The agent runs as the installer user; add appropriate engine access through your Docker installation's normal permissions. Never use `chmod 666` on the socket — Docker access grants powerful control over the host.
- `DOCKER_SOCKET` overrides `DOCKER_HOST`, which overrides CLI context discovery. A stale explicit setting can point at the wrong engine. Metrics and command execution use the same resolved socket.
- Docker CLI actions additionally need `docker` available to the service. Host metrics can work without Docker.

## Pairing code expired, disappeared or denied

Requests expire **15 minutes after creation**, not after approval. Restart enrollment to obtain a live request; restarting an agent while the same request is still live can reuse its code. A server restart loses pending requests, so request a new one. A denied request does not receive a token.

If approval succeeded but token delivery or saving failed, remove the orphaned enrollment from **Agents**, leave `AGENT_TOKEN` empty locally, and enroll again. Detailed failure cases are covered in [enrollment recovery](/agent-enrollment#_6-file-storage-and-recovery).

## Name conflict

Each system needs a unique name. Another enrolled agent or a pending request may already hold it. Use a new name, or remove the obsolete enrollment only if you intend to replace it. For an installer-managed agent that failed initial enrollment, edit `NAME` in `/opt/servomon-agent/.env` and re-run the installer. Preserved configuration is not overwritten by a later `--name` flag.

Do not copy an enrolled `.env` or identity file onto a different machine: that copies its authority, not a new enrollment.

## Agent cannot reach the server

- Check `SERVER_URL` from the agent host, not just your browser. It must be the dashboard base URL, not an `/api` URL or documentation URL.
- Check DNS, routing, firewall and proxy settings. Agents need outbound HTTPS and WebSocket connectivity; do not open their local debug port to the internet.
- A reverse proxy must support `/api/ws` upgrades and streaming SSE for the dashboard. Additional SSO/Access login gates can block agent API calls even when browser login works.
- For a private CA, browser trust is not sufficient. Pass `--ca-cert ./servomon-ca.crt` to the installer, or set `DENO_CERT` in the process/unit environment for a manual agent. Putting it in the agent's `.env` does not configure Deno's TLS trust. See [private-CA HTTPS setup](/server-docker#lan-only-https-options); do not disable TLS verification.
- Check the service working directory: its `.env` and identity are read from there, not wherever the executable happens to be.

## 401 responses

**Dashboard:** verify `NUXT_BASIC_AUTH_USERS` is configured with a valid `user:password` pair. Browsers cache Basic login credentials; reopen a fresh browser session after credential changes. Keep `NUXT_BASIC_AUTH_ENABLED=true`.

**Agent metrics or ticket minting:** a nonempty but revoked/stale `AGENT_TOKEN` skips enrollment and is rejected. Stop the service, remove its old enrollment on **Agents** if present, clear `AGENT_TOKEN` in its working-directory `.env`, then run enrollment again as the service user and approve the new request. Restart the service afterward. Never use operator credentials in place of an agent token.

**WebSocket handshake:** tickets are single-use, expire by default after 60 seconds and disappear on server restart. Never save/reuse a ticket URL. Normal clients obtain a fresh ticket for each connection. See [WebSocket authentication](/websocket-auth).

## Push not arriving

- Use HTTPS, allow notifications in browser **and OS** settings, and check Focus/Do Not Disturb mode.
- On iOS/iPadOS 16.4+, launch the added-to-home-screen web app before enabling notifications.
- Click **Enable notifications** on the receiving device. If browser permission is blocked, change it in the browser's site settings first.
- Enable the system's **Alerts** toggle. It controls delivery to both push and Discord.
- Check the scheduled check times: storage checks are daily, battery hourly, and healthchecks every minute. Machines without a battery do not generate low-battery alerts.
- Keep `/app/data` persistent. If VAPID keys changed (or data was lost), re-enable notifications to replace subscriptions tied to the old key.
- When pinning keys, set both `NUXT_PUBLIC_PUSH_PUBLIC_KEY` and `NUXT_PUSH_PRIVATE_KEY`, and a valid `NUXT_PUSH_SUBJECT` contact URI. Inspect server logs for delivery failures.

## Data vanished after redeploy

Verify your host still mounts the same persistent disk at `/app/data` and runs only one instance. A container's writable layer is not a persistent volume. Metric cleanup is intentionally bounded to the [retention policy](/architecture#storage-and-retention); it is not long-term history storage.
