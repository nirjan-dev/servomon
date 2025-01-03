export interface ProcessInfo {
  app: string;
  pid: number;
  cpuPercent: string;
}

export interface DiskInfo {
  device: string;
  mountPoint: string;
  total: string;
  free: string;
  used: string;
  usedPercentage: string;
}

export interface MemoryInfo {
  total: string;
  free: string;
  used: string;
  usedPercentage: string;
}

export interface CpuInfo {
  cores: number;
  used: string;
  available: string;
}

export interface BatteryInfo {
  state: string;
  charge: string;
}

export interface Metrics {
  timestamp: number;
  memory: MemoryInfo;
  cpu: CpuInfo;
  processes: ProcessInfo[];
  disk: DiskInfo[];
  battery: BatteryInfo;
}
