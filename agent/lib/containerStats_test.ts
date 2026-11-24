import { assertAlmostEquals, assertEquals } from "@std/assert";
import { containerCpuPercent, containerMemory } from "./containerStats.ts";

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

Deno.test("container CPU is a share of the whole host, not of one core", () => {
  // torrent-vpn on a 24-core host: 0.12 cores busy over 10 s. `docker stats` shows 12%.
  const second = 1e9;
  const percent = containerCpuPercent(
    { cpu_usage: { total_usage: 5 * second + 1.2 * second }, system_cpu_usage: 1000 * second + 24 * 10 * second },
    { cpu_usage: { total_usage: 5 * second }, system_cpu_usage: 1000 * second },
  );
  assertAlmostEquals(percent, 0.5, 1e-9);
});

Deno.test("container CPU uses the lifetime average without a previous sample and 0 on counter resets", () => {
  assertEquals(containerCpuPercent({ cpu_usage: { total_usage: 10 }, system_cpu_usage: 100 }, undefined), 10);
  assertEquals(containerCpuPercent({ cpu_usage: { total_usage: 10 }, system_cpu_usage: 100 }, {}), 10);
  assertEquals(containerCpuPercent({ cpu_usage: { total_usage: 5 }, system_cpu_usage: 100 }, { cpu_usage: { total_usage: 10 }, system_cpu_usage: 50 }), 0);
  assertEquals(containerCpuPercent(undefined, undefined), 0);
});
