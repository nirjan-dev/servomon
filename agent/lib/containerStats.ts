// Docker's `memory_stats.usage` is the cgroup's total charge, which includes
// page cache. A container that streams files (qBittorrent, Jellyfin) can show
// tens of GB that the kernel reclaims on demand. Report what `docker stats`
// reports instead: usage minus inactive file cache.
// Mirrors calculateMemUsageUnixNoCache in docker/cli.

export type DockerMemoryStats = {
  usage?: number;
  limit?: number;
  stats?: Record<string, number | undefined>;
};

export type ContainerMemory = { usedBytes: number; percent: number };

export function containerMemory(memoryStats: DockerMemoryStats | undefined): ContainerMemory {
  const usage = memoryStats?.usage ?? 0;
  const stats = memoryStats?.stats ?? {};
  // cgroup v1 reports total_inactive_file; cgroup v2 reports inactive_file.
  const inactiveFile = stats.total_inactive_file ?? stats.inactive_file ?? 0;
  const usedBytes = inactiveFile < usage ? usage - inactiveFile : usage;
  const limit = memoryStats?.limit ?? 0;
  return { usedBytes, percent: limit > 0 ? (usedBytes / limit) * 100 : 0 };
}

export type DockerCpuStats = {
  cpu_usage?: { total_usage?: number };
  system_cpu_usage?: number;
};

/**
 * Container CPU as a share of the whole host, the same scale as the host CPU
 * figure and the process list. `docker stats` (and systeminformation) scale by
 * the core count instead, so one busy core reads 100% and a container can show
 * 20% on a 24-core host that is 2% busy overall.
 * `system_cpu_usage` already sums all cores, so no core multiplier is applied.
 */
export function containerCpuPercent(current: DockerCpuStats | undefined, previous: DockerCpuStats | undefined): number {
  const cpuDelta = (current?.cpu_usage?.total_usage ?? 0) - (previous?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (current?.system_cpu_usage ?? 0) - (previous?.system_cpu_usage ?? 0);
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;
  return Math.min(100, (cpuDelta / systemDelta) * 100);
}
