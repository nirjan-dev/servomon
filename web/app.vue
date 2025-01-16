<template>
  <UContainer>
    <h1 class="py-4 text-lg">
      Server Metrics (last updated:
      <span v-if="metrics[0]"
        >{{ new Date(metrics[0].timestamp).toLocaleTimeString() }})</span
      >

      <span> Battery: {{ batteryCharge }}</span>
    </h1>

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
          <h2 class="inline-block mr-2">Top Processes</h2>
          <UButton color="red" @click="killSelectedProcesses">Kill</UButton>
        </template>
        <UTable v-model="selectedProcesses" :rows="processesStats" />
      </UCard>
    </div>
    <UNotifications />
  </UContainer>
</template>

<script setup lang="ts">
import type { Metrics, ProcessInfo } from "../shared/types";
import { CommandExecutorWebsocketClient } from "~/shared/lib/CommandExecutorWebsocketClient";
const metrics = ref<Metrics[]>([]);
const selectedProcesses = ref<typeof processesStats.value>([]);
const toast = useToast();

let ws: CommandExecutorWebsocketClient;

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

const rawProcessStats = ref<ProcessInfo[]>([]);

const processesStats = computed(() => {
  if (!rawProcessStats.value.length) {
    return [];
  }

  return rawProcessStats.value.map((process) => {
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

    if (!selectedProcesses.value.length) {
      rawProcessStats.value = metrics.value[0].processes;
    }
  };

  ws = new CommandExecutorWebsocketClient({
    url: "/api/ws",
  });

  await ws.connect();
});

function killSelectedProcesses() {
  if (!selectedProcesses.value.length) {
    return;
  }
  selectedProcesses.value.forEach((process) => {
    ws.executeCommand({
      type: "process",
      action: "kill",
      pid: String(process.ID),
      processName: process.name,
    });
  });

  selectedProcesses.value = [];
}
</script>
