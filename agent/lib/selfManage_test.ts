import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { installerChecksum, parseSelfCommand, runSelfCommand, updateStatus } from "./selfManage.ts";

Deno.test("parses upgrade and uninstall commands", () => {
  assertEquals(parseSelfCommand(["upgrade"]), { action: "upgrade" });
  assertEquals(parseSelfCommand(["upgrade", "--version", "0.2.1"]), { action: "upgrade", version: "v0.2.1" });
  assertEquals(parseSelfCommand(["uninstall"]), { action: "uninstall" });
  assertEquals(parseSelfCommand([]), null);
  assertEquals(parseSelfCommand(["enroll"]), null);
  assertInstanceOf(parseSelfCommand(["upgrade", "--version", "latest; rm -rf /"]), Error);
  assertInstanceOf(parseSelfCommand(["uninstall", "--yes"]), Error);
});

Deno.test("reads only an exact install.sh entry from SHA256SUMS", () => {
  const hash = "a".repeat(64);
  assertEquals(installerChecksum(`${"b".repeat(64)}  servomon-agent-linux-x86_64\n${hash}  install.sh\n`), hash);
  assertEquals(installerChecksum(`${hash}  ../install.sh\n${hash}  install.sh extra\n`), null);
});

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function withRelease(installer: string, checksum: string | null, run: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir();
  const previous = Deno.env.get("SERVOMON_RELEASE_BASE_URL");
  try {
    await Deno.writeTextFile(`${dir}/install.sh`, installer);
    await Deno.writeTextFile(`${dir}/SHA256SUMS`, `${checksum ?? await sha256(installer)}  install.sh\n`);
    Deno.env.set("SERVOMON_RELEASE_BASE_URL", dir);
    await run(dir);
  } finally {
    if (previous === undefined) Deno.env.delete("SERVOMON_RELEASE_BASE_URL");
    else Deno.env.set("SERVOMON_RELEASE_BASE_URL", previous);
    await Deno.remove(dir, { recursive: true });
  }
}

// The stub records the arguments it was run with next to itself.
const recorder = (out: string) => `printf '%s\\n' "$*" > '${out}'; exit 3\n`;

Deno.test("upgrade and uninstall run the verified installer with matching flags", async () => {
  const out = await Deno.makeTempFile();
  try {
    await withRelease(recorder(out), null, async () => {
      assertEquals(await runSelfCommand({ action: "upgrade", version: "v0.2.1" }, "0.0.0"), 3);
      assertEquals(await Deno.readTextFile(out), "--version v0.2.1\n");
      assertEquals(await runSelfCommand({ action: "upgrade" }, "0.0.0"), 3);
      assertEquals(await Deno.readTextFile(out), "\n");
      assertEquals(await runSelfCommand({ action: "uninstall" }, "0.0.0"), 3);
      assertEquals(await Deno.readTextFile(out), "--uninstall\n");
    });
  } finally {
    await Deno.remove(out);
  }
});

Deno.test("a tampered installer is never run", async () => {
  const out = await Deno.makeTempFile();
  try {
    await withRelease(recorder(out), "0".repeat(64), async () => {
      await assertRejects(() => runSelfCommand({ action: "upgrade" }, "0.0.0"), Error, "checksum mismatch");
    });
    assertEquals(await Deno.readTextFile(out), "");
  } finally {
    await Deno.remove(out);
  }
});

Deno.test("upgrade --check reports pending updates by numeric version order", () => {
  assertEquals(parseSelfCommand(["upgrade", "--check"]), { action: "check" });
  assertInstanceOf(parseSelfCommand(["upgrade", "--check", "--version", "v1.0.0"]), Error);
  assertEquals(updateStatus("0.2.2", "v0.2.2"), "servomon-agent v0.2.2 is up to date.");
  assertEquals(updateStatus("0.2.9", "v0.2.10"), "Update available: v0.2.9 -> v0.2.10. Run: servomon-agent upgrade");
  assertEquals(updateStatus("0.3.0", "v0.2.10"), "servomon-agent v0.3.0 is newer than the latest release (v0.2.10).");
});
