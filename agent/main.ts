interface ProcessInfo {
  app: string;
  pid: number;
  cpuPercent: string;
}

interface DiskInfo {
  device: string;
  mountPoint: string;
  total: string;
  free: string;
  used: string;
  usedPercentage: string;
}

interface metrics {
  timestamp: string;
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

function getMetrics(): metrics {
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

const ENABLED = false;

// setup a timer to update the metrics every 5 seconds and send them to the web server
setInterval(() => {
  if (!ENABLED) return;

  const metrics = getMetrics();

  console.log("sending metrics to server");
  try {
    fetch("http://localhost:3000/api/metrics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metrics),
    });
  } catch (error) {
    console.error(error);
  }
}, 2000);

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
