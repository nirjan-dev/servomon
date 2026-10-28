#!/bin/sh
# Install or upgrade the Linux agent; --ca-cert FILE trusts a private server CA.
set -eu

fail() { printf 'servomon: %s\n' "$*" >&2; exit 1; }
usage() { printf '%s\n' 'Usage: install.sh --server URL [--name NAME] [--version vX.Y.Z] [--ca-cert FILE] | --uninstall'; }
server='' name='' version=latest uninstall=false ca_cert=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --server|--name|--version|--ca-cert)
      flag=$1; shift
      [ "$#" -gt 0 ] || fail "$flag requires a value"
      case "$flag" in --server) server=$1;; --name) name=$1;; --version) version=$1;; --ca-cert) ca_cert=$1;; esac
      ;;
    --uninstall) uninstall=true;;
    --help|-h) usage; exit 0;;
    *) usage >&2; fail "Unknown option: $1";;
  esac
  shift
done

privileged() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}
service_user=${SUDO_USER:-$(id -un)}
service_home=$(getent passwd "$service_user" | cut -d: -f6)
[ -n "$service_home" ] || fail "Cannot determine home for $service_user"
as_service_user() {
  if [ "$(id -un)" = "$service_user" ]; then
    env HOME="$service_home" "$@"
  else
    runuser -u "$service_user" -- env HOME="$service_home" "$@"
  fi
}
install_dir=/opt/servomon-agent
unit=/etc/systemd/system/servomon-agent.service
if [ "$uninstall" = true ]; then
  printf 'Remove servomon-agent, including its credentials and identity? [y/N] ' >&2
  if read -r answer 2>/dev/null </dev/tty; then :; else read -r answer; fi
  case "$answer" in y|Y|yes|YES) ;; *) fail 'Uninstall cancelled';; esac
  privileged systemctl disable --now servomon-agent.service || true
  privileged rm -f "$unit"
  privileged systemctl daemon-reload
  privileged rm -rf "$install_dir"
  printf '%s\n' 'Servomon agent uninstalled. Revoke its credentials in the dashboard as well.'
  exit 0
fi

[ -n "$server" ] || fail '--server URL is required'
if [ -n "$ca_cert" ]; then
  [ -f "$ca_cert" ] && [ -r "$ca_cert" ] || fail '--ca-cert must be a readable file'
  grep -q 'BEGIN CERTIFICATE' "$ca_cert" || fail '--ca-cert must contain a PEM certificate'
fi
case "$server" in http://*|https://*) ;; *) fail '--server must be an HTTP(S) URL';; esac
# These values go into a dotenv file, not a shell script.
case "$server" in *\"*|*\'*|*' '*|*'
'*) fail '--server contains unsupported whitespace or quotes';; esac
[ -n "$name" ] || name=$(hostname | tr -d '\n' | tr -c 'A-Za-z0-9._-' '-')
case "$name" in ''|*[!A-Za-z0-9._-]*) fail '--name must contain only letters, numbers, dots, underscores, or dashes';; esac
case "$version" in latest|v[0-9]*.[0-9]*.[0-9]*) ;; *) fail '--version must be vX.Y.Z';; esac
[ "$(uname -s)" = Linux ] || fail 'Only Linux is supported'
case "$(uname -m)" in
  x86_64|amd64) arch=x86_64;;
  aarch64|arm64) arch=aarch64;;
  *) fail 'Unsupported CPU architecture (expected x86_64 or aarch64)';;
esac
for cmd in curl sha256sum systemctl getent; do command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"; done
if [ "$version" = latest ]; then
  base=https://github.com/nirjan-dev/servomon/releases/latest/download
else
  base=https://github.com/nirjan-dev/servomon/releases/download/$version
fi
base=${SERVOMON_RELEASE_BASE_URL:-$base}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
asset=servomon-agent-linux-$arch
fetch() {
  case "$base" in
    /*) cp "$base/$1" "$tmp/$1";;
    *) curl --fail --show-error --location "$base/$1" --output "$tmp/$1";;
  esac
}
fetch "$asset"
fetch SHA256SUMS
# Select exactly this asset; never trust paths supplied by the manifest.
checksum=$(while read -r hash filename rest; do
  if [ "$filename" = "$asset" ] && [ -z "$rest" ]; then printf '%s' "$hash"; fi
done <"$tmp/SHA256SUMS")
[ "${#checksum}" -eq 64 ] || fail "Missing or invalid checksum for $asset"
case "$checksum" in *[!0-9a-fA-F]*) fail 'Invalid SHA256 checksum';; esac
printf '%s  %s\n' "$checksum" "$asset" >"$tmp/checksum"
(cd "$tmp" && sha256sum -c checksum) || fail 'Checksum verification failed; nothing installed'
privileged install -d -m 700 -o "$service_user" "$install_dir"
if [ -n "$ca_cert" ]; then
  privileged install -m 644 "$ca_cert" "$install_dir/ca.crt"
fi
ca_environment=''
if privileged test -f "$install_dir/ca.crt"; then
  ca_environment='Environment=DENO_CERT=/opt/servomon-agent/ca.crt'
fi
# Replace the executable atomically; an active process can keep its old inode.
privileged install -m 755 "$tmp/$asset" "$install_dir/servomon-agent.new"
privileged mv "$install_dir/servomon-agent.new" "$install_dir/servomon-agent"
if ! privileged test -f "$install_dir/.env"; then
  (umask 077; printf 'SERVER_URL=%s\nNAME=%s\n' "${server%/}" "$name" >"$tmp/env")
  privileged install -m 600 -o "$service_user" "$tmp/env" "$install_dir/.env"
else
  printf '%s\n' 'Keeping existing .env and identity (including server URL and name).'
fi
cat >"$tmp/service" <<EOF
[Unit]
Description=Servomon monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$service_user
Environment=HOME=$service_home
$ca_environment
WorkingDirectory=/opt/servomon-agent
ExecStart=/opt/servomon-agent/servomon-agent
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
privileged install -m 644 "$tmp/service" "$unit"
privileged systemctl daemon-reload
# Stop an existing agent before enrollment/upgrade to avoid duplicate sockets.
privileged systemctl stop servomon-agent.service
(cd "$install_dir" && if [ -n "$ca_environment" ]; then
  as_service_user env DENO_CERT="$install_dir/ca.crt" ./servomon-agent enroll
else
  as_service_user ./servomon-agent enroll
fi)
privileged systemctl enable --now servomon-agent.service
printf '%s\n' 'Servomon agent installed. Follow logs with:' 'journalctl -u servomon-agent -f'
