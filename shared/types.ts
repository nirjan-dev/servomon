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

export interface Metrics {
  timestamp: number;
  memory: {
    total: string;
    free: string;
    used: string;
    usedPercentage: string;
  };
  cpu: {
    cores: number;
    used: string;
    available: string;
  };
  processes: ProcessInfo[];
  disk: DiskInfo[];
}
