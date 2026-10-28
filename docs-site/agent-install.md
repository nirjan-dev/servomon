# Install an agent

Agents run on **Linux x86_64 or ARM64 (aarch64)**. Remote actions use Linux `kill` and the Docker CLI; macOS and Windows agents are not supported. Docker itself is optional if you only want host metrics. For container actions, install the Docker CLI and give the service user access to the engine.

## Recommended: installer + systemd

Run as the user whose processes and Docker engine you want to manage:

```sh
curl -fsSL https://github.com/nirjan-dev/servomon/releases/latest/download/install.sh | sh -s -- --server https://monitor.example.com
```

Replace the URL with your dashboard origin. **Agents → Add agent** generates the command for your instance. To choose a unique name:

```sh
curl -fsSL https://github.com/nirjan-dev/servomon/releases/latest/download/install.sh | sh -s -- --server https://monitor.example.com --name mini-pc
```

The POSIX shell installer:

1. Detects the CPU architecture and downloads the matching binary and `SHA256SUMS` from GitHub Releases.
2. Verifies the binary checksum before installing it.
3. Uses sudo for privileged steps and installs under `/opt/servomon-agent/`, with a `.env` and local identity file.
4. Runs **`servomon-agent enroll` in the foreground as the service user**. Compare its pairing code and fingerprint with the request on **Agents**, then click **Approve**. Do not approve unfamiliar requests.
5. Enables and starts **`servomon-agent.service`**, running as the invoking user (`SUDO_USER` when invoked through sudo), not automatically as root.
6. Prints the log command: `journalctl -u servomon-agent -f`.

Keep the terminal open until approval and installation finish. Pairing requests expire after 15 minutes. The fingerprint is a comparison label, not proof of private-key ownership. Enrollment writes `AGENT_ID` and `AGENT_TOKEN` into `.env`; protect it and `.servomon-identity.json` as secrets.

## Docker Desktop for Linux

Run the installer as your normal desktop user so the service can access your own Desktop socket. Engine discovery uses this order:

1. `DOCKER_SOCKET`.
2. `DOCKER_HOST` when it is a `unix://` endpoint.
3. The active Docker CLI context's `unix://` endpoint.
4. `~/.docker/desktop/docker.sock`, if present.
5. `/var/run/docker.sock`.

The same resolved socket is used for metrics and Docker CLI commands. Set an explicit `DOCKER_SOCKET` in `/opt/servomon-agent/.env` if needed, then restart the service. The user must have permission to access that socket; do not make it world-writable. A Desktop engine must be running before container metrics can work.

### Private-CA HTTPS

For a server using Caddy's internal CA, obtain its root CA using the [LAN HTTPS guide](/server-docker#lan-only-https-options), then add `--ca-cert ./servomon-ca.crt` to the installer command. It copies the CA to `/opt/servomon-agent/ca.crt`, uses it for foreground enrollment and configures the systemd unit's `DENO_CERT` process environment. Upgrades preserve this CA configuration. Your browsers/phones also need to trust the CA for push and PWA.

For manual operation, run `DENO_CERT=/path/ca.crt ./servomon-agent` (and the same prefix for `enroll`). These runtime TLS settings must be in the process environment, **not** the agent's `.env`. As an alternative, add the CA to the OS trust store and set `DENO_TLS_CA_STORE=system` in the unit environment. Do not bypass certificate verification.

## Manual download and checksum

For a non-systemd setup, download into your chosen working directory:

```sh
mkdir -p "$HOME/servomon-agent" && cd "$HOME/servomon-agent"
# Use linux-aarch64 instead on ARM64.
curl -fLO https://github.com/nirjan-dev/servomon/releases/latest/download/servomon-agent-linux-x86_64
curl -fLO https://github.com/nirjan-dev/servomon/releases/latest/download/SHA256SUMS
# Verify only the asset you downloaded; the manifest also lists other release assets.
sha256sum --ignore-missing -c SHA256SUMS
mv servomon-agent-linux-x86_64 servomon-agent
chmod +x servomon-agent
printf '%s\n' 'SERVER_URL=https://monitor.example.com' 'NAME=mini-pc' > .env
chmod 600 .env
./servomon-agent enroll
# Approve the request in the dashboard, then:
./servomon-agent
```

No arguments runs the agent, enrolling first if `AGENT_TOKEN` is absent. `enroll` only enrolls, exits after saving the token, and exits successfully with a message if already enrolled. Denial, timeout and errors exit nonzero. `./servomon-agent --version` prints its version.

The binary reads `.env` from its **working directory**, not its executable directory. Always run it there.

### Manual systemd alternative

Download the [example unit](https://github.com/nirjan-dev/servomon/blob/main/agent/servomon-agent.service), set `User=`, `WorkingDirectory=` and `ExecStart=` to match your installation, and save it as `/etc/systemd/system/servomon-agent.service`. Enroll as that user first, in the configured working directory. Then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now servomon-agent
journalctl -u servomon-agent -f
```

## Upgrade

Re-run the installer command. It upgrades the executable in place, keeps `.env` and identity, skips enrollment when a token already exists, and restarts the service. Existing configuration is preserved; edit the installed `.env` to change the server URL or name.

To pin a release, pass **`--version v0.1.0`**. The default is `latest`. Version-pinned manual downloads use `/releases/download/v0.1.0/` in place of `/releases/latest/download/`.

## Remove

```sh
curl -fsSL https://github.com/nirjan-dev/servomon/releases/latest/download/install.sh | sh -s -- --uninstall
```

The uninstall flow confirms removal, removes the service and `/opt/servomon-agent/` including credentials and identity. It does **not** revoke the server-side enrollment: also choose **Remove** on **Agents**. Remove retains metric history. To delete enrollment, history and system settings together, use **Delete system…** in the overview row's **⋯** menu; this is irreversible.
