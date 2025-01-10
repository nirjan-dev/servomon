<template>
  <UContainer>
    <h1 class="py-4 text-lg">
      Server Metrics (last updated:
      <span v-if="metrics[0]"
        >{{ new Date(metrics[0].timestamp).toLocaleTimeString() }})</span
      >

      <span> Battery: {{ batteryCharge }}</span>
    </h1>

    <UButton @click="sendMessage">Send command</UButton>

    <div class="flex flex-wrap gap-2">
      <UCard>
        <template #header>
          <h2>Memory</h2>
        </template>
        <UTable :rows="memoryStats" />
      </UCard>

      <UCard>
        <template #header>
          <h2>CPU</h2>
        </template>
        <UTable :rows="cpuStats" />
      </UCard>

      <UCard>
        <template #header>
          <h2>Storage</h2>
        </template>
        <UTable :rows="diskStats" />
      </UCard>

      <UCard>
        <template #header>
          <h2>Top Processes</h2>
        </template>
        <UTable :rows="processesStats" />
      </UCard>
    </div>
  </UContainer>
</template>

<script setup lang="ts">
import type { Metrics } from "../shared/types";
import { WebsocketClient } from "../shared/lib/WebsocketClient";
const metrics = ref<Metrics[]>([]);

let ws: WebsocketClient;

const memoryStats = computed(() => {
  return metrics.value.map((metricsItem) => {
    return {
      Total: metricsItem.memory.total,

      Free: metricsItem.memory.free,

      "used %": metricsItem.memory.usedPercentage,
    };
  });
});

const cpuStats = computed(() => {
  return metrics.value.map((metricsItem) => {
    return {
      Available: metricsItem.cpu.available,
      Used: metricsItem.cpu.used,
    };
  });
});

const diskStats = computed(() => {
  if (!metrics.value[0]) {
    return [];
  }

  return metrics.value[0].disk.map((disk) => {
    return {
      device: disk.device,
      mount: disk.mountPoint,
      free: disk.free,
      used: disk.used,
      "used %": disk.usedPercentage,
    };
  });
});

const processesStats = computed(() => {
  if (!metrics.value[0]) {
    return [];
  }

  return metrics.value[0].processes.map((process) => {
    return {
      "CPU usage": process.cpuPercent,
      name: process.app,
      ID: process.pid,
    };
  });
});

const batteryCharge = computed(() => {
  if (!metrics.value[0]) {
    return "loading...";
  }
  return metrics.value[0].battery.charge;
});

onMounted(async () => {
  const metricsStream = new EventSource("/api/metrics-stream");

  metricsStream.onmessage = (event) => {
    const newMetrics = JSON.parse(event.data) as Metrics[];

    metrics.value = newMetrics.slice(-1);
  };

  ws = new WebsocketClient({
    url: "/api/ws",
  });

  await ws.connect();
});

function sendMessage() {
  ws.send(
    JSON.stringify({
      type: "command",
      value: "ls",
    })
  );
}
</script>
