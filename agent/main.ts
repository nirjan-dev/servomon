import "@std/dotenv/load";
import { Metrics, MemoryInfo } from "../shared/types.ts";

const SEND_REQUESTS = Deno.env.get("SEND_REQUESTS") === "true" ? true : false;
const SERVER_URL = Deno.env.get("SERVER_URL");
const REQUESTS_PER_MINUTE_UNIT =
  Number(Deno.env.get("REQUESTS_PER_MINUTE_UNIT")) ?? 5;
const MINUTE_UNIT = Number(Deno.env.get("MINUTE_UNIT"));

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

function getMemoryStats(): MemoryInfo {
  const { free, total } = Deno.systemMemoryInfo();
  const used = total - free;

  function formatMemory(memoryInBytes: number) {
    return `${Math.round(memoryInBytes / 1024 / 1024 / 1024)} GBs`;
  }

  const memoryStats = {
    free: formatMemory(free),
    total: formatMemory(total),
    used: formatMemory(used),
    usedPercentage: `${Math.round((used / total) * 100)}%`,
  };

  return memoryStats;
}

function getMetrics(): Metrics {
  return {
    timestamp: Date.now(),
    memory: getMemoryStats(),
    cpu: {
      cores: 4,
      used: "50%",
      available: "50%",
    },
    processes: [
      {
        app: "app1",
        pid: 1234,
        cpuPercent: "50%",
      },
      {
        app: "app2",
        pid: 5678,
        cpuPercent: "20%",
      },
    ],
    disk: [
      {
        device: "/dev/sda1",
        mountPoint: "/",
        total: "10GB",
        free: "5GB",
        used: "5GB",
        usedPercentage: "50%",
      },
      {
        device: "/dev/sda2",
        mountPoint: "/home",
        total: "20GB",
        free: "10GB",
        used: "10GB",
        usedPercentage: "50%",
      },
    ],
  };
}

// setup a timer to update the metrics every 5 seconds and send them to the web server

setInterval(async () => {
  if (!SEND_REQUESTS) {
    return;
  }

  if (!SERVER_URL) {
    throw new Error("No server URL provided");
  }

  const metrics = getMetrics();

  try {
    await fetch(`${SERVER_URL}/api/metrics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metrics),
    });
  } catch (error) {
    console.error(error);
  }
}, requestIntervalMilliSeconds);

// start a local web server with a handler
function handler(_req: Request): Response {
  const metrics = getMetrics();

  return new Response(JSON.stringify(metrics), {
    headers: {
      "content-type": "application/json",
    },
  });
}

Deno.serve(
  {
    port: 1234,
  },
  handler
);
