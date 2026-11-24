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
