import { CommandResponderWebsocketClient } from "./lib/CommandResponderWebsocketClient.ts";
import { enrollAgent } from "./lib/enroll.ts";
import { resolveDockerSocket } from "./lib/dockerSocket.ts";
import "@std/dotenv/load";
import type {
  Metrics,
  MemoryInfo,
  BatteryInfo,
  CpuInfo,
  ProcessInfo,
  DiskInfo,
  ContainerInfo,
  NetworkInfo,
  SystemInfo,
} from "../shared/types.ts";
import denoJSON from "./deno.json" with { type: "json" };

const version = denoJSON.version;

if (Deno.args.length === 1 && Deno.args[0] === "--version") {
  console.log(version);
  Deno.exit(0);
}
const enrollOnly = Deno.args.length === 1 && Deno.args[0] === "enroll";
if (Deno.args.length && !enrollOnly) {
  console.error("Usage: servomon-agent [enroll | --version]");
  Deno.exit(1);
}
const SEND_REQUESTS = Deno.env.get("SEND_REQUESTS") !== "false";
const SERVER_URL = Deno.env.get("SERVER_URL");
const REQUESTS_PER_MINUTE_UNIT =
  Number(Deno.env.get("REQUESTS_PER_MINUTE_UNIT")) || 20;
const MINUTE_UNIT = Number(Deno.env.get("MINUTE_UNIT")) || 2;
let AGENT_TOKEN = Deno.env.get("AGENT_TOKEN");
const PORT = Number(Deno.env.get("PORT")) || 8282;
const NAME = Deno.env.get("NAME") || Deno.hostname().replace(/[^A-Za-z0-9._-]/g, "-");
if (enrollOnly && AGENT_TOKEN) {
  console.log("Already enrolled: AGENT_TOKEN is set.");
  Deno.exit(0);
}
if (!SERVER_URL) {
  throw new Error("No SERVER_URL set in env variables. Exiting agent...");
}
if (!AGENT_TOKEN) {
  // S1: first run — enroll with the operator's approval, then continue.
  console.log("No AGENT_TOKEN set; starting enrollment…");
  const enrolled = await enrollAgent(SERVER_URL, NAME, Deno.cwd());
  Deno.env.set("AGENT_TOKEN", enrolled.token);
  AGENT_TOKEN = enrolled.token;
}
if (enrollOnly) Deno.exit(0);

const dockerSocket = await resolveDockerSocket();
Deno.env.set("DOCKER_SOCKET", dockerSocket);
console.log(`Docker socket: ${dockerSocket}`);
// Dynamic import guarantees systeminformation reads the resolved socket at
// evaluation time; static import ordering would run it before this assignment.
const {
  battery, currentLoad, dockerContainers, dockerContainerStats, fsSize, get,
  mem, networkInterfaceDefault, networkStats, processes, processLoad,
} = await import("systeminformation");

const requestIntervalMilliSeconds = getRequestIntervalMilliSeconds(
  REQUESTS_PER_MINUTE_UNIT,
  MINUTE_UNIT,
);

function getRequestIntervalMilliSeconds(
  requestsPerMinuteUnit: number,
  minuteUnit: number,
) {
  const totalMilliSeconds = 1000 * 60 * minuteUnit;
  return totalMilliSeconds / requestsPerMinuteUnit;
}

console.log("Current Servomon agent version", version);
console.log("Current Deno version", Deno.version.deno);
console.log("Current TypeScript version", Deno.version.typescript);
console.log("Current V8 version", Deno.version.v8);

console.log(`REQUEST interval: ${requestIntervalMilliSeconds}`);
console.log(
  `will send ${REQUESTS_PER_MINUTE_UNIT} requests every ${MINUTE_UNIT} minutes`,
);
console.log(`SEND_REQUESTS: ${SEND_REQUESTS}`);
console.log(`SERVER_URL: ${SERVER_URL}`);
console.log(`PORT: ${PORT}`);
console.log(`NAME: ${NAME}`)

async function getMemoryStats(): Promise<MemoryInfo> {
  const { total, available, active } = await mem();

  function formatMemory(memoryInBytes: number) {
    return Number((memoryInBytes / 1024 / 1024 / 1024).toFixed(1));
  }

  const memoryStats = {
    free: formatMemory(available),
    total: formatMemory(total),
    used: formatMemory(active),
    usedPercentage: Number(((active / total) * 100).toFixed(1)),
  };

  return memoryStats;
}

async function getBatteryStats(): Promise<BatteryInfo> {
  const { percent } = await battery();

  return {
    charge: percent,
  };
}

async function getSystemInfo():Promise<SystemInfo> {
  const {osInfo, system} = await get({
    osInfo:'platform, distro, release, kernel',
    system: 'model, manufacturer, version',
  })
  const combinedSystemInfo:SystemInfo = {
    os: `${osInfo?.platform} ${osInfo?.distro} ${osInfo?.release}`,
    kernel: osInfo?.kernel,
    device: system?.version || system?.model || system?.manufacturer
  }
  return combinedSystemInfo
}

await getSystemInfo()

async function getCPUStats(): Promise<CpuInfo> {
  const { currentLoad: cpuLoad, cpus } = await currentLoad();

  const used = cpuLoad;
  const available = 100 - used;
  const cores = cpus.length;

  const cpuStats = {
    available: Number(available.toFixed(0)),
    cores,
    used: Number(used.toFixed(0)),
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
    Array.from(topProcessesName).join(","),
  );

  const processStats: ProcessInfo[] = processesWithLoad
  .filter(p => p.pid)
  .sort((a, b) => b.mem - a.mem)  
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
    disk.fs.startsWith("/dev"),
  );

  function getDiskSizeInGB(size: number) {
    return Number((size / 1024 / 1024 / 1024).toFixed(1));
  }

  const diskStats: DiskInfo[] = onlyPhysicalRawDiskStats.map((disk) => {
    return {
      device: disk.fs,
      mountPoint: disk.mount,
      free: getDiskSizeInGB(disk.available),
      total: getDiskSizeInGB(disk.size),
      used: getDiskSizeInGB(disk.used),
      usedPercentage: Number(disk.use.toFixed(0)),
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

  const [memory, battery, cpu, processes, disk, containersInfo, networkInfo, systemInfo] = await Promise.all([
    getMemoryStats(),
    getBatteryStats(),
    getCPUStats(),
    getProcessStats(),
    getDiskStats(),
    getContainersInfo(),
    getNetworkStats(),
    getSystemInfo()
  ])

  return {
    name: NAME,
    timestamp: Date.now(),
    memory,
    battery,
    containersInfo,
    cpu,
    disk,
    networkInfo,
    processes,
    systemInfo
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
      networkStat.rx_bytes,
    ),
    downloadErrors: getFormattedNetworkPercentageMetric(
      networkStat.rx_errors,
      networkStat.rx_bytes,
    ),
    downloadPerSecond: getFormattedNetworkSpeed(networkStat.rx_sec),
    uploadDrops: getFormattedNetworkPercentageMetric(
      networkStat.tx_dropped,
      networkStat.tx_bytes,
    ),
    uploadErrors: getFormattedNetworkPercentageMetric(
      networkStat.tx_errors,
      networkStat.tx_bytes,
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
      throw new Error(`Error sending metrics ` + parsedResponse?.statusMessage + JSON.stringify(parsedResponse?.data, null, 2));
    }
  } catch (error:unknown) {
    console.log(error)
    console.log('tried sending: ', JSON.stringify(metrics, null, 2))
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
  url: `${SERVER_URL}/api/ws`,
  // S1: mint a fresh single-use ticket per connection attempt.
  resolveUrl: async () => {
    const ticketRes = await fetch(`${SERVER_URL}/api/ws-ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
    });
    if (!ticketRes.ok) {
      throw new Error(`WS ticket mint failed with HTTP ${ticketRes.status}`);
    }
    const { ticket } = (await ticketRes.json()) as { ticket: string };
    const wsUrl = new URL(`${SERVER_URL}/api/ws`);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("type", "server");
    wsUrl.searchParams.set("name", NAME);
    wsUrl.searchParams.set("ticket", ticket);
    return wsUrl.toString();
  },
});

await ws.connect();

Deno.serve({ hostname: "127.0.0.1", port: PORT }, handler);
