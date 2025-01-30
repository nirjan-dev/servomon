<template>
  <VitePwaManifest />
  <UContainer>
    <MetricsTitle :update-time="metrics[0]?.timestamp" />

    <div class="grid gap-2">
      <UCard>
        <template #header>
          <h2>Memory</h2>
        </template>
        <UTable :rows="memoryStats" />
      </UCard>

      <UCard>
        <template #header>
          <h2>Storage</h2>
        </template>
        <UTable :rows="diskStats" />
      </UCard>

      <UCard>
        <template #header>
          <h2>Network</h2>
        </template>
        <UTable :rows="networkStats" />
      </UCard>

      <UCard>
        <template #header>
          <h2>CPU</h2>
        </template>
        <UTable :rows="cpuStats" />
      </UCard>

      <UCard v-if="dockerStats.length">
        <template #header>
          <h2 class="inline-block mr-2">Top Containers</h2>
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

      <UCard>
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
    </div>
    <UNotifications />
  </UContainer>
</template>

<script setup lang="ts">
import {
  type ContainerInfo,
  type Metrics,
  type ProcessInfo,
} from "../shared/types";
import { CommandExecutorWebsocketClient } from "~/shared/lib/CommandExecutorWebsocketClient";
const metrics = ref<Metrics[]>([]);
const selectedProcesses = ref<typeof processesStats.value>([]);
const selectedContainers = ref<typeof dockerStats.value>([]);
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
const toast = useToast();

let ws: CommandExecutorWebsocketClient;

const memoryStats = computed(() => {
  return metrics.value.map((metricsItem) => {
    return {
      Total: metricsItem.memory.total,

      Free: metricsItem.memory.free,

      Used: metricsItem.memory.used,

      "used %": metricsItem.memory.usedPercentage,
    };
  });
});

const networkStats = computed(() => {
  return metrics.value.map((metricsItem) => {
    return {
      Upload: metricsItem.networkInfo.uploadPerSecond,
      Download: metricsItem.networkInfo.downloadPerSecond,
      "Upload Error": metricsItem.networkInfo.uploadErrors,
      "Upload Drops": metricsItem.networkInfo.uploadDrops,
      "Download Error": metricsItem.networkInfo.downloadErrors,
      "Download Drops": metricsItem.networkInfo.downloadDrops,
    };
  });
});

const cpuStats = computed(() => {
  return metrics.value.map((metricsItem) => {
    return {
      Available: metricsItem.cpu.available,
      Used: metricsItem.cpu.used,
      Cores: metricsItem.cpu.cores,
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
      "used %": disk.usedPercentage + "%",
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
    label: "name",
  },
  {
    key: "state",
    label: "state",
  },
  {
    key: "cpu",
    label: "cpu",
  },
  {
    key: "memory",
    label: "memory",
  },
  {
    key: "memory %",
    label: "memory %",
  },
];

const batteryCharge = computed(() => {
  if (!metrics.value[0]) {
    return "loading...";
  }
  return metrics.value[0].battery.charge + "%";
});

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
      pushPublicKey,
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
  publicKey: string,
): Promise<PushSubscription | undefined> {
  if (Notification.permission !== "granted") {
    await Notification.requestPermission();
  }
  if (Notification.permission !== "granted") {
    alert(
      "Push notifications disabled because notification permission was denied",
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
  const metricsStream = new EventSource("/api/metrics-stream");

  metricsStream.onmessage = (event) => {
    const newMetrics = JSON.parse(event.data) as Metrics[];

    metrics.value = newMetrics.slice(-1);

    if (!selectedProcesses.value.length) {
      rawProcessStats.value = metrics.value[0].processes;
    }

    if (!selectedContainers.value.length) {
      rawDockerStats.value = metrics.value[0].containersInfo;
    }
  };
}

async function setupWebsocket() {
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
    });
  });

  selectedContainers.value = [];
}
</script>
