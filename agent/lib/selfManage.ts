// `servomon-agent upgrade [--version vX.Y.Z]` and `servomon-agent uninstall`.
// Both delegate to the release's install.sh so there is one installer, and
// verify it against the release's SHA256SUMS before running it.

const RELEASES = "https://github.com/nirjan-dev/servomon/releases";
const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;

export type SelfCommand =
  | { action: "upgrade"; version?: string }
  | { action: "uninstall" };

/** Parses `upgrade [--version vX.Y.Z]` / `uninstall`; null when args are not a self-management command. */
export function parseSelfCommand(args: string[]): SelfCommand | Error | null {
  const [command, ...rest] = args;
  if (command === "uninstall") {
    return rest.length ? new Error("uninstall takes no options") : { action: "uninstall" };
  }
  if (command !== "upgrade") return null;
  if (rest.length === 0) return { action: "upgrade" };
  if (rest.length === 2 && rest[0] === "--version") {
    const version = rest[1].startsWith("v") ? rest[1] : `v${rest[1]}`;
    if (!VERSION_PATTERN.test(version)) return new Error("--version must be vX.Y.Z");
    return { action: "upgrade", version };
  }
  return new Error("Usage: servomon-agent upgrade [--version vX.Y.Z]");
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

/** Downloads, verifies and runs the installer; returns its exit code. */
export async function runSelfCommand(command: SelfCommand): Promise<number> {
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
