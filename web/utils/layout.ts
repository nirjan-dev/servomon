// Column template shared by the overview's header row and each system row.
export const FLEET_GRID =
  "grid grid-cols-6 items-center gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,1fr))_minmax(0,1.05fr)_5.5rem]";

// Drops the platform prefix the agent puts before the distro:
// "linux Ubuntu 24.04.1 LTS" -> "Ubuntu 24.04.1 LTS".
export function osName(os: string | undefined): string {
  if (!os) return "";
  return os.replace(/^(linux|darwin|win32|freebsd|openbsd|sunos|aix)\s+(?=\S)/i, "");
}
