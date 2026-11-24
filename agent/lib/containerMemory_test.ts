import { assertAlmostEquals, assertEquals } from "@std/assert";
import { containerMemory } from "./containerMemory.ts";

const MB = 1024 * 1024;

Deno.test("cgroup v2: page cache from file I/O is not counted as used memory", () => {
  // Shape observed for qBittorrent on a homelab: 20.9 GB charged, almost all inactive file cache.
  const memory = containerMemory({
    usage: 20_988 * MB,
    limit: 60_896 * MB,
    stats: { anon: 128 * MB, file: 20_838 * MB, inactive_file: 20_812 * MB },
  });
  assertEquals(memory.usedBytes, 176 * MB);
  assertAlmostEquals(memory.percent, (176 / 60_896) * 100, 1e-9);
});

Deno.test("cgroup v1: subtracts total_inactive_file", () => {
  const memory = containerMemory({
    usage: 500 * MB,
    limit: 1000 * MB,
    stats: { total_inactive_file: 300 * MB, inactive_file: 10 * MB },
  });
  assertEquals(memory.usedBytes, 200 * MB);
  assertEquals(memory.percent, 20);
});

Deno.test("falls back to raw usage when cache stats are missing or inconsistent", () => {
  assertEquals(containerMemory({ usage: 100, limit: 0 }), { usedBytes: 100, percent: 0 });
  assertEquals(containerMemory({ usage: 100, limit: 200, stats: { inactive_file: 150 } }).usedBytes, 100);
  assertEquals(containerMemory(undefined), { usedBytes: 0, percent: 0 });
});
