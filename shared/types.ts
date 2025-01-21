export interface ProcessInfo {
  app: string;
  pid: number;
  cpuPercent: string;
  memoryPercent: string;
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
  charge: string;
}

export interface ContainerInfo {
  memoryUsedPercent: string;
  memoryUsed: string;
  cpuUsed: string;
  name: string;
  id: string;
  state: string;
}

export interface Metrics {
  timestamp: number;
  memory: MemoryInfo;
  cpu: CpuInfo;
  processes: ProcessInfo[];
  disk: DiskInfo[];
  battery: BatteryInfo;
  containersInfo: ContainerInfo[];
}

// Command Types
export type CommandType =
  // | "shell"
  "process" | "docker";
// | "service"
// | "network";

// Base Interfaces
export interface BaseCommand {
  type: CommandType;
}

export interface BaseCommandResult {
  timestamp: number;
  success: boolean;
  error?: string;
}

// Shell Commands
// export interface ShellCommand extends BaseCommand {
//   type: "shell";
//   command: string;
//   args?: string[];
//   cwd?: string;
//   env?: Record<string, string>;
// }

// export interface ShellCommandResult extends BaseCommandResult {
//   output: string;
//   code: number;
//   signal?: string;
// }

// Process Commands
export interface ProcessCommand extends BaseCommand {
  type: "process";
  action: "start" | "stop" | "restart" | "kill";
  processName: string;
  pid: string;
  signal?: "SIGTERM" | "SIGKILL" | "SIGINT";
}

export interface PSInfo {
  pid: number;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  command: string;
}

export interface ProcessCommandResult extends BaseCommandResult {
  processes?: PSInfo[];
  affectedPid: string;
  affectedProcessName: string;
}

// Docker Commands
export interface DockerCommand extends BaseCommand {
  type: "docker";
  action: "stop" | "pause" | "unpause";
  containerName: string;
}

// export interface ContainerInfo {
//   id: string;
//   name: string;
//   image: string;
//   status: string;
//   ports: Array<{ host: number; container: number }>;
//   created: string;
//   state: "running" | "stopped" | "exited" | "created";
//   health?: "healthy" | "unhealthy" | "none";
// }

export interface DockerCommandResult extends BaseCommandResult {
  logs?: string;
  containerName?: string;
}

// Service Commands
// export interface ServiceCommand extends BaseCommand {
//   type: "service";
//   action: "start" | "stop" | "restart" | "status" | "list";
//   serviceName?: string;
// }

// export interface ServiceInfo {
//   name: string;
//   status: "running" | "stopped" | "failed";
//   pid?: number;
//   uptime?: number;
//   memory?: number;
//   autostart: boolean;
// }

// export interface ServiceCommandResult extends BaseCommandResult {
//   services?: ServiceInfo[];
//   affectedService?: string;
// }

// // Network Commands
// export interface NetworkCommand extends BaseCommand {
//   type: "network";
//   action: "status" | "scan" | "list" | "configure";
//   interface?: string;
//   config?: {
//     ip?: string;
//     netmask?: string;
//     gateway?: string;
//   };
// }

// export interface NetworkInfo {
//   interface: string;
//   ip: string;
//   netmask: string;
//   gateway?: string;
//   mac: string;
//   status: "up" | "down";
//   type: "ethernet" | "wifi" | "loopback";
// }

// export interface NetworkCommandResult extends BaseCommandResult {
//   networks?: NetworkInfo[];
//   affectedInterface?: string;
// }

// Union Types
// export type Command =
//   | ShellCommand
//   | ProcessCommand
//   | DockerCommand
//   | ServiceCommand
//   | NetworkCommand;
export type Command = ProcessCommand | DockerCommand;

// export type CommandResult =
//   | ShellCommandResult
//   | ProcessCommandResult
//   | DockerCommandResult
//   | ServiceCommandResult
//   | NetworkCommandResult;
export type CommandResult =
  | {
      type: "process";
      data: ProcessCommandResult;
    }
  | {
      type: "docker";
      data: DockerCommandResult;
    };

// Utility Types
// export interface CommandStatus {
//   id: string;
//   type: CommandType;
//   status: "pending" | "running" | "completed" | "failed";
//   progress?: number;
//   startTime: number;
//   endTime?: number;
// }

// export interface CommandOptions {
//   timeout?: number;
//   retries?: number;
//   retryDelay?: number;
//   priority?: "high" | "normal" | "low";
// }

// export interface CommandMetadata {
//   userId?: string;
//   source?: "web" | "api" | "scheduler";
//   correlationId?: string;
//   tags?: string[];
// }

// export interface ExtendedCommand extends BaseCommand {
//   options?: CommandOptions;
//   metadata?: CommandMetadata;
// }
