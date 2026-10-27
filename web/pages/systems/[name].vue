<template>
  <div class="flex items-center gap-3 flex-wrap">
    <UBreadcrumb :items="breadcrumbItems" class="capitalize" />
    <span v-if="!isLoadingMetrics" class="flex items-center gap-1.5 text-sm text-muted">
      <span class="inline-block w-2 h-2 rounded-full" :class="freshness.dotClass.value" />
      {{ freshness.label.value }}
    </span>
  </div>

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
          <UButton color="error" @click="executeDockerCommand('stop')"
            >Stop</UButton
          >
          <UButton color="warning" @click="executeDockerCommand('pause')"
            >Pause</UButton
          >
          <UButton color="success" @click="executeDockerCommand('unpause')"
            >Unpause</UButton
          >
        </div>
      </template>
      <UTable
        v-model:row-selection="containerSelection"
        :data="dockerStats"
        :columns="containersColumns"
        :get-row-id="(row: ContainerRow) => row.name"
      />
    </UCard>
    <UCard class="mb-4">
      <template #header>
        <h2 class="inline-block mr-2">Top Processes</h2>
        <UButton color="error" @click="killSelectedProcesses">Kill</UButton>
      </template>
      <UTable
        v-model:row-selection="processSelection"
        :data="processesStats"
        :columns="processTableColumns"
        :get-row-id="(row: ProcessRow) => String(row.ID)"
      />
    </UCard>
  </template>
</template>

<script setup lang="ts">
import { h, resolveComponent } from "vue";
import type { TableColumn } from "@nuxt/ui";
import type { ContainerInfo, Metrics, ProcessInfo } from "../../../shared/types";
import { CommandExecutorWebsocketClient } from "~/shared/lib/CommandExecutorWebsocketClient";
import { useFreshness } from "~/composables/useFreshness";
const UCheckbox = resolveComponent("UCheckbox");
const metrics = ref<Metrics[]>([]);
// Table selection, keyed by row id (pid / container name; see :get-row-id).
const processSelection = ref<Record<string, boolean>>({});
const containerSelection = ref<Record<string, boolean>>({});
const systemName = useRoute().params.name ?? "";
const isLoadingMetrics = computed(() => metrics.value.length === 0);
// Newest sample across the stream; freshness follows it as data arrives.
const newestTimestamp = computed(() => {
  if (!metrics.value.length) return undefined;
  return Math.max(...metrics.value.map((m) => m.timestamp));
});
const freshness = useFreshness(newestTimestamp);
const breadcrumbItems = [
  {
    label: "Home",
    icon: "i-heroicons-home",
    to: "/",
  },
  {
    label: `${systemName} Dashboard`,
    icon: "i-heroicons-chart-bar",
  },
];

function selectColumn<T>(): TableColumn<T> {
  return {
    id: "select",
    header: ({ table }) =>
      h(UCheckbox, {
        modelValue: table.getIsSomePageRowsSelected()
          ? "indeterminate"
          : table.getIsAllPageRowsSelected(),
        "onUpdate:modelValue": (value: boolean | "indeterminate") =>
          table.toggleAllPageRowsSelected(!!value),
        "aria-label": "Select all",
      }),
    cell: ({ row }) =>
      h(UCheckbox, {
        modelValue: row.getIsSelected(),
        "onUpdate:modelValue": (value: boolean | "indeterminate") =>
          row.toggleSelected(!!value),
        "aria-label": "Select row",
      }),
  };
}

const processTableColumns: TableColumn<ProcessRow>[] = [
  selectColumn<ProcessRow>(),
  { accessorKey: "ID", header: "ID" },
  { accessorKey: "name", header: "name" },
  { accessorKey: "cpu", header: "CPU" },
  { accessorKey: "memory", header: "memory" },
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
type ProcessRow = (typeof processesStats.value)[number];
const selectedProcesses = computed(() =>
  processesStats.value.filter((p) => processSelection.value[String(p.ID)])
);
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
type ContainerRow = (typeof dockerStats.value)[number];
const selectedContainers = computed(() =>
  dockerStats.value.filter((c) => containerSelection.value[c.name])
);

const containersColumns: TableColumn<ContainerRow>[] = [
  selectColumn<ContainerRow>(),
  {
    accessorKey: "name",
    header: "Name",
    meta: {
      class: {
        th: "sticky z-10 bg-neutral-900 left-0",
        td: "sticky z-10 bg-neutral-900 left-0 truncate max-w-[25ch]",
      },
    },
  },
  { accessorKey: "state", header: "State" },
  { accessorKey: "cpu", header: "CPU" },
  { accessorKey: "memory", header: "Memory" },
  { accessorKey: "memory %", header: "Memory %" },
];

onMounted(async () => {
  connectMetrics();
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
const { metrics: streamedMetrics, connect: connectMetrics } = useMetricsStream(
  computed(() => systemName as string)
);

// Tables follow the newest sample until the user picks rows explicitly.
watch(streamedMetrics, (samples) => {
  metrics.value = samples;
  if (!selectedProcesses.value.length && samples.at(-1)?.processes) {
    rawProcessStats.value = samples.at(-1)!.processes;
  }
  if (!selectedContainers.value.length && samples.at(-1)?.containersInfo) {
    rawDockerStats.value = samples.at(-1)!.containersInfo;
  }
});

async function setupWebsocket() {
  if (ws) {
    return;
  }
  ws = new CommandExecutorWebsocketClient({
    url: "/api/ws",
    // S1: mint a fresh single-use ticket per connection attempt. The browser
    // re-sends the cached basic-auth credentials with this same-origin POST.
    resolveUrl: async () => {
      const { ticket } = await $fetch<{ ticket: string }>("/api/ws-ticket", {
        method: "POST",
      });
      const wsUrl = new URL("/api/ws", window.location.origin);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.searchParams.set("ticket", ticket);
      return wsUrl.toString();
    },
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

  processSelection.value = {};
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

  containerSelection.value = {};
}

onBeforeUnmount(async () => {
  ws.disconnect();
});
</script>
