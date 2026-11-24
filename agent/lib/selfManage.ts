// `servomon-agent upgrade [--version vX.Y.Z | --check]` and `servomon-agent uninstall`.
// Upgrade and uninstall delegate to the release's install.sh so there is one
// installer, and verify it against the release's SHA256SUMS before running it.

const RELEASES = "https://github.com/nirjan-dev/servomon/releases";
const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;

export type SelfCommand =
  | { action: "upgrade"; version?: string }
  | { action: "check" }
  | { action: "uninstall" };

const UPGRADE_USAGE = "Usage: servomon-agent upgrade [--version vX.Y.Z | --check]";

/** Parses `upgrade [--version vX.Y.Z | --check]` / `uninstall`; null when args are not a self-management command. */
export function parseSelfCommand(args: string[]): SelfCommand | Error | null {
  const [command, ...rest] = args;
  if (command === "uninstall") {
    return rest.length ? new Error("uninstall takes no options") : { action: "uninstall" };
  }
  if (command !== "upgrade") return null;
  if (rest.length === 0) return { action: "upgrade" };
  if (rest.length === 1 && rest[0] === "--check") return { action: "check" };
  if (rest.length === 2 && rest[0] === "--version") {
    const version = rest[1].startsWith("v") ? rest[1] : `v${rest[1]}`;
    if (!VERSION_PATTERN.test(version)) return new Error("--version must be vX.Y.Z");
    return { action: "upgrade", version };
  }
  return new Error(UPGRADE_USAGE);
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const [left, right] = [a, b].map((version) => version.replace(/^v/, "").split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function updateStatus(current: string, latest: string): string {
  const installed = `v${current.replace(/^v/, "")}`;
  const comparison = compareVersions(installed, latest);
  if (comparison < 0) return `Update available: ${installed} -> ${latest}. Run: servomon-agent upgrade`;
  if (comparison > 0) return `servomon-agent ${installed} is newer than the latest release (${latest}).`;
  return `servomon-agent ${installed} is up to date.`;
}

/** Reads the latest release tag from GitHub's /releases/latest redirect (no API rate limit). */
async function latestReleaseVersion(): Promise<string> {
  const response = await fetch(`${RELEASES}/latest`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  await response.body?.cancel();
  const tag = /\/releases\/tag\/(v\d+\.\d+\.\d+)$/.exec(response.headers.get("location") ?? "")?.[1];
  if (!tag) throw new Error(`Could not determine the latest release (HTTP ${response.status})`);
  return tag;
}

/** Finds install.sh's digest in a SHA256SUMS manifest; exact filename match only. */
export function installerChecksum(manifest: string): string | null {
  for (const line of manifest.split("\n")) {
    const [hash, filename, ...extra] = line.trim().split(/\s+/);
    if (filename === "install.sh" && extra.length === 0 && /^[0-9a-f]{64}$/i.test(hash)) {
      return hash.toLowerCase();
    }
  }
  return null;
}

async function download(url: string): Promise<Uint8Array<ArrayBuffer>> {
  // A local directory works too, matching install.sh's SERVOMON_RELEASE_BASE_URL.
  if (url.startsWith("/")) return await Deno.readFile(url);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Runs a self-management command; returns the process exit code. */
export async function runSelfCommand(command: SelfCommand, currentVersion: string): Promise<number> {
  if (command.action === "check") {
    console.log(updateStatus(currentVersion, await latestReleaseVersion()));
    return 0;
  }
  const version = command.action === "upgrade" ? command.version : undefined;
  // Same override the installer honors, for mirrors and testing.
  const base = Deno.env.get("SERVOMON_RELEASE_BASE_URL") ??
    (version ? `${RELEASES}/download/${version}` : `${RELEASES}/latest/download`);

  const [installer, manifest] = await Promise.all([
    download(`${base}/install.sh`),
    download(`${base}/SHA256SUMS`),
  ]);
  const expected = installerChecksum(new TextDecoder().decode(manifest));
  if (!expected) throw new Error("SHA256SUMS has no valid entry for install.sh");
  if (await sha256Hex(installer) !== expected) {
    throw new Error("install.sh checksum mismatch; nothing was changed");
  }

  const dir = await Deno.makeTempDir({ prefix: "servomon-" });
  try {
    const script = `${dir}/install.sh`;
    await Deno.writeFile(script, installer, { mode: 0o600 });
    const args = command.action === "uninstall"
      ? ["--uninstall"]
      : version ? ["--version", version] : [];
    const { code } = await new Deno.Command("sh", {
      args: [script, ...args],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn().status;
    return code;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
