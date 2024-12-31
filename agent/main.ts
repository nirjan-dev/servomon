import "@std/dotenv/load";
import { Metrics } from "../shared/types.ts";

function getMetrics(): Metrics {
  return {
    timestamp: new Date().toLocaleString(),
    memory: {
      total: "1GB",
      free: "500MB",
      used: "500MB",
      usedPercentage: "50%",
    },
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
const REQUEST_INTERVAL_MS = Number(Deno.env.get("REQUEST_INTERVAL_MS")) || 5000;
const SEND_REQUESTS = Boolean(Deno.env.get("SEND_REQUESTS")) || false;
const SERVER_URL = Deno.env.get("SERVER_URL");

console.log(`REQUEST_INTERVAL_MS: ${REQUEST_INTERVAL_MS}`);
console.log(`SEND_REQUESTS: ${SEND_REQUESTS}`);
console.log(`SERVER_URL: ${SERVER_URL}`);

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
}, REQUEST_INTERVAL_MS);

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
