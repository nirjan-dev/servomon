<template>
  <UBreadcrumb :links="breadcrumbLinks" class="capitalize" />

  <USkeleton v-if="isLoadingMetrics" class="mt-6 w-full h-svh" />

  <template v-else>
    <div
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 flex-wrap mt-6 mb-12"
    >
      <SystemInfo
        :name="systemName"
        :timestamp="metrics[0]?.timestamp"
        :system-info="systemInfo"
      />
      <MemoryOverview :memoryMetrics="memoryStats.at(-1)!" />
      <NetworkOverview :network-metrics="networkStats.at(-1)!" />
      <MemoryMetrics :memory-metrics="memoryStats" />
      <StorageMetrics :storage-metrics="diskStats" />
      <CPUUsage :cpu-metrics="cpuStats" />
    </div>
    <UCard class="mb-4" v-if="dockerStats.length">
      <template #header>
        <h2 class="inline-block mr-2">Containers</h2>
        <div class="inline-flex gap-2">
          <UButton color="red" @click="executeDockerCommand('stop')"
            >Stop</UButton
          >
          <UButton color="yellow" @click="executeDockerCommand('pause')"
            >Pause</UButton
          >
          <UButton color="green" @click="executeDockerCommand('unpause')"
            >Unpause</UButton
          >
        </div>
      </template>
      <UTable
        v-model="selectedContainers"
        :rows="dockerStats"
        :columns="containersColumns"
      />
    </UCard>
    <UCard class="mb-4">
      <template #header>
        <h2 class="inline-block mr-2">Top Processes</h2>
        <UButton color="red" @click="killSelectedProcesses">Kill</UButton>
      </template>
      <UTable
        :columns="processTableColumns"
        v-model="selectedProcesses"
        :rows="processesStats"
      />
    </UCard>
  </template>
</template>

<script setup lang="ts">
import {
  type ContainerInfo,
  type Metrics,
  type ProcessInfo,
} from "@global-shared/types";
import { CommandExecutorWebsocketClient } from "~/shared/lib/CommandExecutorWebsocketClient";
const metrics = ref<Metrics[]>([]);
const selectedProcesses = ref<typeof processesStats.value>([]);
const selectedContainers = ref<typeof dockerStats.value>([]);
const systemName = useRoute().params.name ?? "";
const isLoadingMetrics = computed(() => metrics.value.length === 0);
const breadcrumbLinks = [
  {
    label: "Home",
    icon: "i-heroicons-home",
    to: "/",
  },
  {
    label: `${systemName} Dashboard`,
    icon: "heroicons:chart-bar",
  },
];
const processTableColumns = [
  // NOTE: adding a placeholder to the start because for some reason if I make the table selectable it removes the first column
  {
    key: "placeholder",
  },
  {
    key: "ID",
    label: "ID",
  },

  {
    key: "name",
    label: "name",
  },

  {
    key: "cpu",
    label: "CPU",
  },
  {
    key: "memory",
    label: "memory",
  },
];

let ws: CommandExecutorWebsocketClient;

const memoryStats = computed(() => {
  return metrics.value.map((metricsItem) => {
    return {
      timestamp: metricsItem.timestamp,
      total: metricsItem.memory.total,

      free: metricsItem.memory.free,

      used: metricsItem.memory.used,

      usedPercent: metricsItem.memory.usedPercentage,
    };
  });
});
const systemInfo = computed(() => {
  return metrics.value[0]?.systemInfo;
});
const networkStats = computed(() => {
  return metrics.value.map((metricsItem) => {
    return {
      upload: metricsItem.networkInfo.uploadPerSecond,
      download: metricsItem.networkInfo.downloadPerSecond,
      uploadErrors: metricsItem.networkInfo.uploadErrors,
      uploadDrops: metricsItem.networkInfo.uploadDrops,
      downloadErrors: metricsItem.networkInfo.downloadErrors,
      downloadDrops: metricsItem.networkInfo.downloadDrops,
    };
  });
});

const cpuStats = computed(() => {
  return metrics.value.map((metricsItem) => {
    return {
      available: metricsItem.cpu.available,
      used: metricsItem.cpu.used,
      Cores: metricsItem.cpu.cores,
      timestamp: metricsItem.timestamp,
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
      total: disk.total,
      usedPercent: disk.usedPercentage,
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
      name: process.app,
      cpu: process.cpuPercent,
      ID: process.pid,
      memory: process.memoryPercent,
    };
  });
});
const rawDockerStats = ref<ContainerInfo[]>([]);
const dockerStats = computed(() => {
  if (!rawDockerStats.value.length) {
    return [];
  }

  return rawDockerStats.value.map((container) => {
    return {
      name: container.name,
      state: container.state,
      cpu: container.cpuUsed,
      memory: container.memoryUsed,
      "memory %": container.memoryUsedPercent,
    };
  });
});

const containersColumns = [
  {
    key: "spaceForSelectBox",
    label: "space for select box",
  },
  {
    key: "name",
    label: "Name",
    class: "sticky z-10 bg-gray-900 left-0",
    rowClass: "sticky z-10 bg-gray-900 left-0 truncate max-w-[25ch]",
  },
  {
    key: "state",
    label: "State",
  },
  {
    key: "cpu",
    label: "CPU",
  },
  {
    key: "memory",
    label: "Memory",
  },
  {
    key: "memory %",
    label: "Memory %",
  },
];

onMounted(async () => {
  setupMetricsStream();
  await Promise.allSettled([setupWebsocket(), setupPushSubscription()]);
});

async function setupPushSubscription() {
  const { $pwa } = useNuxtApp();

  if (!$pwa || !$pwa.getSWRegistration()) {
    console.log("no pwa object found");
    setTimeout(setupPushSubscription, 300);
    return;
  }

  const pushManager = $pwa.getSWRegistration()!.pushManager;

  let subscription = await pushManager.getSubscription();

  if (!subscription) {
    const {
      public: { pushPublicKey },
    } = useRuntimeConfig();
    // setup new sub
    const newSub = await subscribeUserToPushNotifications(
      pushManager,
      pushPublicKey
    );

    if (!newSub) {
      return;
    }
    const storedNewSub = await storeSubscription(newSub);
    if (!storedNewSub) {
      console.log("couldn't store new sub");
    }
    return;
  }

  const subscriptionsStoredCheck = await $fetch("/api/check-subscription", {
    params: { endpoint: subscription.endpoint },
  });

  if (!subscriptionsStoredCheck.isSubscribed) {
    // store sub
    const storedNewSub = await storeSubscription(subscription);
    if (!storedNewSub) {
      console.log("couldn't store new sub");
    }
    return;
  }
}

async function storeSubscription(sub: PushSubscription) {
  try {
    // store sub to server
    await $fetch("/api/subscriptions", {
      method: "POST",
      body: sub,
    });
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
}

async function subscribeUserToPushNotifications(
  pushManager: PushManager,
  publicKey: string
): Promise<PushSubscription | undefined> {
  if (Notification.permission !== "granted") {
    await Notification.requestPermission();
  }
  if (Notification.permission !== "granted") {
    alert(
      "Push notifications disabled because notification permission was denied"
    );
    return;
  }

  let newSub: PushSubscription;

  try {
    newSub = await pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });
  } catch (error) {
    console.log("error trying to subscribe to push notifications", error);
    return;
  }

  return newSub;
}

function setupMetricsStream() {
  const metricsStream = new EventSource(
    "/api/metrics-stream?name=" + systemName
  );

  metricsStream.onmessage = (event) => {
    const newMetrics = JSON.parse(event.data) as Metrics[];

    metrics.value = newMetrics;

    if (!selectedProcesses.value.length && metrics.value.at(-1)?.processes) {
      rawProcessStats.value = metrics.value.at(-1)!.processes;
    }

    if (
      !selectedContainers.value.length &&
      metrics.value.at(-1)?.containersInfo
    ) {
      rawDockerStats.value = metrics.value.at(-1)!.containersInfo;
    }
  };
}

async function setupWebsocket() {
  if (ws) {
    return;
  }
  ws = new CommandExecutorWebsocketClient({
    url: "/api/ws",
  });

  await ws.connect();
}

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
      system: systemName as string,
    });
  });

  selectedProcesses.value = [];
}

function executeDockerCommand(action: "pause" | "unpause" | "stop") {
  if (!selectedContainers.value.length) {
    return;
  }

  selectedContainers.value.forEach((container) => {
    ws.executeCommand({
      type: "docker",
      action,
      containerName: container.name,
      system: systemName as string,
    });
  });

  selectedContainers.value = [];
}

onBeforeUnmount(async () => {
  ws.disconnect();
});
</script>
