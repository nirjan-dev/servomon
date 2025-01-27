import { CommandResponderWebsocketClient } from "./lib/CommandResponderWebsocketClient.ts";
import "@std/dotenv/load";
import {
  Metrics,
  MemoryInfo,
  BatteryInfo,
  CpuInfo,
  ProcessInfo,
  DiskInfo,
  ContainerInfo,
  NetworkInfo,
} from "../shared/types.ts";
import {
  battery,
  currentLoad,
  dockerContainers,
  dockerContainerStats,
  fsSize,
  mem,
  networkInterfaceDefault,
  networkStats,
  processes,
  processLoad,
} from "systeminformation";

const SEND_REQUESTS = Deno.env.get("SEND_REQUESTS") === "true" ? true : false;
const SERVER_URL = Deno.env.get("SERVER_URL");
const REQUESTS_PER_MINUTE_UNIT =
  Number(Deno.env.get("REQUESTS_PER_MINUTE_UNIT")) ?? 5;
const MINUTE_UNIT = Number(Deno.env.get("MINUTE_UNIT"));
const AGENT_TOKEN = Deno.env.get("AGENT_TOKEN");
if (!AGENT_TOKEN) {
  throw new Error("No AGENT_TOKEN set in env variables. Exiting agent...");
}

const requestIntervalMilliSeconds = getRequestIntervalMilliSeconds(
  REQUESTS_PER_MINUTE_UNIT,
  MINUTE_UNIT
);

function getRequestIntervalMilliSeconds(
  requestsPerMinuteUnit: number,
  minuteUnit: number
) {
  const totalMilliSeconds = 1000 * 60 * minuteUnit;
  return totalMilliSeconds / requestsPerMinuteUnit;
}

console.log(`REQUEST interval: ${requestIntervalMilliSeconds}`);
console.log(
  `will send ${REQUESTS_PER_MINUTE_UNIT} requests every ${MINUTE_UNIT} minutes`
);
console.log(`SEND_REQUESTS: ${SEND_REQUESTS}`);
console.log(`SERVER_URL: ${SERVER_URL}`);

async function getMemoryStats(): Promise<MemoryInfo> {
  const { total, available, active } = await mem();

  function formatMemory(memoryInBytes: number) {
    return `${(memoryInBytes / 1024 / 1024 / 1024).toFixed(1)} GBs`;
  }

  const memoryStats = {
    free: formatMemory(available),
    total: formatMemory(total),
    used: formatMemory(active),
    usedPercentage: `${((active / total) * 100).toFixed(1)}%`,
  };

  return memoryStats;
}

async function getBatteryStats(): Promise<BatteryInfo> {
  const { percent } = await battery();

  return {
    charge: percent + "%",
  };
}

async function getCPUStats(): Promise<CpuInfo> {
  const { currentLoad: cpuLoad, cpus } = await currentLoad();

  const used = cpuLoad;
  const available = 100 - used;
  const cores = cpus.length;

  const cpuStats = {
    available: `${available.toFixed(1)}%`,
    cores,
    used: `${used.toFixed(1)}%`,
  };
  return cpuStats;
}

async function getProcessStats(): Promise<ProcessInfo[]> {
  const processStatsRaw = await processes();

  const topProcesses = processStatsRaw.list
    .sort((a, b) => b.cpu - a.cpu)
    .splice(0, Math.min(50, processStatsRaw.list.length));

  const topProcessesName = new Set(topProcesses.map((p) => p.name));

  const processesWithLoad = await processLoad(
    Array.from(topProcessesName).join(",")
  );

  const processStats: ProcessInfo[] = processesWithLoad
    .sort((a, b) => b.cpu - a.cpu)
    .splice(0, Math.min(12, processesWithLoad.length))
    .map((process) => {
      return {
        app: process.proc,
        cpuPercent: `${process.cpu.toFixed(2)}%`,
        pid: process.pid,
        memoryPercent: `${process.mem.toFixed(2)}%`,
      };
    });

  return processStats;
}

async function getDiskStats(): Promise<DiskInfo[]> {
  const rawDiskStats = await fsSize();

  const onlyPhysicalRawDiskStats = rawDiskStats.filter((disk) =>
    disk.fs.startsWith("/dev")
  );

  function formatDiskSize(size: number) {
    return `${(size / 1024 / 1024 / 1024).toFixed(1)} GBs`;
  }

  const diskStats: DiskInfo[] = onlyPhysicalRawDiskStats.map((disk) => {
    return {
      device: disk.fs,
      mountPoint: disk.mount,
      free: formatDiskSize(disk.available),
      total: formatDiskSize(disk.size),
      used: formatDiskSize(disk.used),
      usedPercentage: `${disk.use.toFixed(1)}%`,
    };
  });

  return diskStats;
}

async function getContainersInfo(): Promise<ContainerInfo[]> {
  const rawContainerStats = await dockerContainerStats("*");
  const dockerContainersInfo = await dockerContainers();
  const containerStats: ContainerInfo[] = rawContainerStats
    .toSorted((a, b) => b.cpuPercent - a.cpuPercent)
    .map((stats) => {
      const statsInfo = dockerContainersInfo.find((c) => c.id === stats.id);

      return {
        id: stats.id.split("").slice(0, 12).join(""),
        name: statsInfo?.name ?? "unknown",
        cpuUsed: `${stats.cpuPercent.toFixed(2)}%`,
        memoryUsed: `${(stats.memUsage / 1024 / 1024).toFixed(2)} MBs`,
        memoryUsedPercent: `${stats.memPercent.toFixed(2)}%`,
        state: statsInfo?.state ?? "unknown",
      };
    });

  return containerStats;
}

async function getMetrics(): Promise<Metrics> {
  return {
    timestamp: Date.now(),
    memory: await getMemoryStats(),
    battery: await getBatteryStats(),

    cpu: await getCPUStats(),

    processes: await getProcessStats(),
    disk: await getDiskStats(),
    containersInfo: await getContainersInfo(),
    networkInfo: await getNetworkStats(),
  };
}

async function getNetworkStats(): Promise<NetworkInfo> {
  const defaultInterface = await networkInterfaceDefault();
  const [networkStat] = await networkStats(defaultInterface);

  function getFormattedNetworkPercentageMetric(value: number, total: number) {
    return `${((value / total) * 100).toFixed(2)}%`;
  }

  function getFormattedNetworkSpeed(bytes: number | null) {
    if (!bytes) {
      return "0 bytes/s";
    }

    let output = bytes;

    if (output <= 100) {
      return `${output.toFixed(2)} bytes/s`;
    }

    output = output / 1024;

    if (output <= 100) {
      return `${output.toFixed(2)} KiB/s`;
    }

    output = output / 1024;

    if (output <= 100) {
      return `${output.toFixed(2)} MiB/s`;
    }

    output = output / 1024;

    return `${output.toFixed(2)} GiB/s`;
  }

  const formattedNetworkStats = {
    downloadDrops: getFormattedNetworkPercentageMetric(
      networkStat.rx_dropped,
      networkStat.rx_bytes
    ),
    downloadErrors: getFormattedNetworkPercentageMetric(
      networkStat.rx_errors,
      networkStat.rx_bytes
    ),
    downloadPerSecond: getFormattedNetworkSpeed(networkStat.rx_sec),
    uploadDrops: getFormattedNetworkPercentageMetric(
      networkStat.tx_dropped,
      networkStat.tx_bytes
    ),
    uploadErrors: getFormattedNetworkPercentageMetric(
      networkStat.tx_errors,
      networkStat.tx_bytes
    ),
    uploadPerSecond: getFormattedNetworkSpeed(networkStat.tx_sec),
  };
  return formattedNetworkStats;
}

// setup a timer to update the metrics every 5 seconds and send them to the web server

setInterval(async () => {
  if (!SEND_REQUESTS) {
    return;
  }

  if (!SERVER_URL) {
    throw new Error("No server URL provided");
  }

  const metrics = await getMetrics();
  try {
    const response = await fetch(`${SERVER_URL}/api/metrics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AGENT_TOKEN}`,
      },
      body: JSON.stringify(metrics),
    });
    const parsedResponse = await response.json();
    if (parsedResponse?.statusCode !== 201) {
      throw new Error(`Error sending metrics ` + parsedResponse?.statusMessage);
    }
  } catch (error) {
    console.error(error);
  }
}, requestIntervalMilliSeconds);

// start a local web server with a handler
async function handler(_req: Request): Promise<Response> {
  const metrics = await getMetrics();

  return new Response(JSON.stringify(metrics), {
    headers: {
      "content-type": "application/json",
    },
  });
}

const ws = new CommandResponderWebsocketClient({
  url: `${SERVER_URL}/api/ws?type=server`,
});

ws.connect();

Deno.serve(
  {
    port: 1234,
  },
  handler
);
