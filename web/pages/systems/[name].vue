<script setup lang="ts">
import type { ContainerInfo, Metrics, ProcessInfo } from "../../../shared/types";
import type { ChartSeries } from "~/components/TimeSeriesChart.vue";
import type { ContainerRow, DockerAction } from "~/components/ContainerTable.vue";
import type { ProcessRow } from "~/components/ProcessTable.vue";
import { CommandExecutorWebsocketClient } from "~/shared/lib/CommandExecutorWebsocketClient";
import { useFleet } from "~/composables/useFleet";
import { useFreshness } from "~/composables/useFreshness";
import { useMetricsStream } from "~/composables/useMetricsStream";
import { osName } from "~/utils/layout";
import {
  displayRate,
  formatGiB,
  formatPercent,
  formatRate,
  LEVEL_TEXT,
  levelOf,
  parsePercent,
  parseRate,
  rateScale,
} from "~/utils/metrics";

// Nuxt keys pages by route params, so switching systems remounts this page.
const systemName = String(useRoute().params.name ?? "");
const { entries, setAlerts } = useFleet();
const entry = computed(() => entries.value.find((e) => e.name === systemName));

const { metrics, synced, connect: connectMetrics } = useMetricsStream(systemName);
const latest = computed(() => metrics.value.at(-1));
const freshness = useFreshness(computed(() => latest.value?.timestamp));

const statusText = computed(
  () =>
    ({ live: "text-muted", stale: "text-warning", offline: "text-error", unknown: "text-muted" })[
      freshness.state.value
    ],
);

const windowLabel = computed(() => {
  const first = metrics.value[0]?.timestamp;
  const last = latest.value?.timestamp;
  if (!first || !last || last <= first) return "";
  const minutes = Math.max(1, Math.round((last - first) / 60_000));
  return minutes < 90 ? `Last ${minutes} min` : `Last ${Math.round(minutes / 60)} h`;
});

const cpuSeries: ChartSeries[] = [{ label: "CPU", value: (m) => m.cpu.used, color: "var(--chart-series)" }];
const memorySeries: ChartSeries[] = [
  { label: "Used", value: (m) => m.memory.used, color: "var(--chart-series)" },
];
const networkSeries: ChartSeries[] = [
  { label: "Download", value: (m) => parseRate(m.networkInfo.downloadPerSecond) ?? 0, color: "var(--chart-series)" },
  { label: "Upload", value: (m) => parseRate(m.networkInfo.uploadPerSecond) ?? 0, color: "var(--chart-series-2)" },
];
const networkScale = computed(() =>
  rateScale(Math.max(0, ...metrics.value.flatMap((m) => networkSeries.map((s) => s.value(m))))),
);

const cpuLevel = computed(() => levelOf("cpu", latest.value?.cpu.used));
const memLevel = computed(() => levelOf("memory", latest.value?.memory.usedPercentage));

const disks = computed(() =>
  [...(latest.value?.disk ?? [])].sort((a, b) => b.usedPercentage - a.usedPercentage),
);

const networkIssues = computed(() => {
  const n = latest.value?.networkInfo;
  if (!n) return [];
  return [
    ["Download errors", n.downloadErrors],
    ["Download drops", n.downloadDrops],
    ["Upload errors", n.uploadErrors],
    ["Upload drops", n.uploadDrops],
  ].filter(([, value]) => (parsePercent(value) ?? 0) > 0) as [string, string][];
});

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const details = computed(() => {
  const m = latest.value;
  if (!m) return [];
  return [
    ["OS", osName(m.systemInfo.os) || "—"],
    ["Kernel", m.systemInfo.kernel || "—"],
    ["Device", m.systemInfo.device || "—"],
    ["CPU", `${m.cpu.cores} cores`],
    // The agent reports 0 when the machine has no battery.
    ["Battery", m.battery.charge > 0 ? `${m.battery.charge}%` : "Not detected"],
    ["Last sample", timeFormat.format(m.timestamp)],
  ];
});

// Tables follow the newest sample until the user picks rows explicitly.
const processSelection = ref<Record<string, boolean>>({});
const containerSelection = ref<Record<string, boolean>>({});
const processes = ref<ProcessInfo[]>([]);
const containers = ref<ContainerInfo[]>([]);
const anySelected = (selection: Record<string, boolean>) => Object.values(selection).some(Boolean);

watch(metrics, (samples) => {
  const newest = samples.at(-1);
  if (!newest) return;
  if (!anySelected(processSelection.value)) processes.value = newest.processes ?? [];
  if (!anySelected(containerSelection.value)) containers.value = newest.containersInfo ?? [];
});

let ws: CommandExecutorWebsocketClient | undefined;

onMounted(async () => {
  connectMetrics();
  await setupWebsocket();
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

function killProcesses(rows: ProcessRow[]) {
  for (const row of rows) {
    ws?.executeCommand({
      type: "process",
      action: "kill",
      pid: row.pid,
      processName: row.name,
      system: systemName,
    });
  }
  processSelection.value = {};
}

function runDockerCommand(action: DockerAction, rows: ContainerRow[]) {
  for (const row of rows) {
    ws?.executeCommand({
      type: "docker",
      action,
      containerName: row.name,
      system: systemName,
    });
  }
  containerSelection.value = {};
}

onBeforeUnmount(() => {
  ws?.disconnect();
});
</script>

<template>
  <UDashboardPanel id="system">
    <template #header>
      <UDashboardNavbar :title="systemName" :ui="{ title: 'font-mono', right: 'gap-4' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #trailing>
          <span v-if="synced" class="hidden items-center gap-1.5 text-sm sm:flex" :class="statusText">
            <StatusDot :color="freshness.color.value" />{{ freshness.label.value }}
          </span>
        </template>
        <template #right>
          <USwitch
            v-if="entry"
            :model-value="entry.alerts"
            label="Alerts"
            color="neutral"
            :aria-label="`Push alerts for ${systemName}`"
            @update:model-value="(enabled: boolean) => setAlerts(systemName, enabled)"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <span v-if="synced" class="flex items-center gap-1.5 text-sm sm:hidden" :class="statusText">
        <StatusDot :color="freshness.color.value" />{{ freshness.label.value }}
      </span>

      <div v-if="!synced" class="grid gap-4 xl:grid-cols-2" aria-busy="true">
        <USkeleton v-for="n in 4" :key="n" class="h-64 w-full" />
      </div>

      <UEmpty
        v-else-if="!latest"
        icon="i-lucide-activity"
        :title="`No metrics from ${systemName} yet`"
        description="Charts appear as soon as its agent reports."
        :actions="[{ label: 'Back to overview', to: '/', color: 'neutral', variant: 'outline' }]"
      />

      <template v-else>
        <div class="grid gap-4 xl:grid-cols-2">
          <AppPanel>
            <template #header>
              <h2 class="text-sm font-semibold text-highlighted">CPU</h2>
            </template>
            <template #actions>
              <span class="text-xs text-muted">{{ windowLabel }}</span>
            </template>
            <p class="flex items-baseline gap-2">
              <span class="text-2xl font-semibold tabular-nums" :class="LEVEL_TEXT[cpuLevel]">
                {{ formatPercent(latest.cpu.used) }}
              </span>
              <span class="text-sm text-muted">of {{ latest.cpu.cores }} cores</span>
            </p>
            <TimeSeriesChart
              class="mt-3"
              :data="metrics"
              :series="cpuSeries"
              :y-domain="[0, 100]"
              :format="(v: number) => `${Math.round(v)}%`"
              :label="`CPU usage over time, now ${formatPercent(latest.cpu.used)}`"
            />
          </AppPanel>

          <AppPanel>
            <template #header>
              <h2 class="text-sm font-semibold text-highlighted">Memory</h2>
            </template>
            <template #actions>
              <span class="text-xs text-muted">{{ windowLabel }}</span>
            </template>
            <p class="flex items-baseline gap-2">
              <span class="text-2xl font-semibold tabular-nums" :class="LEVEL_TEXT[memLevel]">
                {{ formatGiB(latest.memory.used) }}
              </span>
              <span class="text-sm text-muted tabular-nums">
                of {{ formatGiB(latest.memory.total) }} · {{ formatPercent(latest.memory.usedPercentage) }}
              </span>
            </p>
            <TimeSeriesChart
              class="mt-3"
              :data="metrics"
              :series="memorySeries"
              :y-domain="[0, latest.memory.total]"
              :format="formatGiB"
              :label="`Memory used over time, now ${formatGiB(latest.memory.used)}`"
            />
          </AppPanel>
        </div>

        <div class="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <AppPanel class="lg:col-span-2 xl:col-span-1">
            <template #header>
              <h2 class="text-sm font-semibold text-highlighted">Network</h2>
            </template>
            <template #actions>
              <span class="text-xs text-muted">{{ windowLabel }}</span>
            </template>
            <dl class="flex flex-wrap gap-x-6 gap-y-1">
              <div class="flex items-center gap-2">
                <dt class="flex items-center gap-1.5 text-sm text-muted">
                  <span class="size-2 rounded-full bg-(--chart-series)" aria-hidden="true" />Download
                </dt>
                <dd class="font-semibold tabular-nums text-highlighted">
                  {{ displayRate(latest.networkInfo.downloadPerSecond) }}
                </dd>
              </div>
              <div class="flex items-center gap-2">
                <dt class="flex items-center gap-1.5 text-sm text-muted">
                  <span class="size-2 rounded-full bg-(--chart-series-2)" aria-hidden="true" />Upload
                </dt>
                <dd class="font-semibold tabular-nums text-highlighted">
                  {{ displayRate(latest.networkInfo.uploadPerSecond) }}
                </dd>
              </div>
            </dl>
            <TimeSeriesChart
              class="mt-3"
              :data="metrics"
              :series="networkSeries"
              :y-domain="[0, networkScale.top]"
              :y-ticks="networkScale.ticks"
              :format="formatRate"
              :height="132"
              label="Network throughput over time"
            />
            <p v-if="!networkIssues.length" class="mt-2 text-xs text-muted">No errors or dropped packets.</p>
            <ul v-else class="mt-2 flex flex-wrap gap-x-4 text-xs text-warning">
              <li v-for="[label, value] in networkIssues" :key="label">{{ label }} {{ value }}</li>
            </ul>
          </AppPanel>

          <AppPanel title="Storage">
            <ul class="flex flex-col gap-4">
              <li v-for="disk in disks" :key="`${disk.device}${disk.mountPoint}`">
                <div class="flex items-baseline justify-between gap-3">
                  <span class="min-w-0 truncate font-mono text-sm text-highlighted" :title="disk.device">
                    {{ disk.mountPoint }}
                  </span>
                  <span class="shrink-0 text-sm font-medium tabular-nums" :class="LEVEL_TEXT[levelOf('disk', disk.usedPercentage)]">
                    {{ formatPercent(disk.usedPercentage) }}
                  </span>
                </div>
                <UsageMeter
                  class="mt-1.5"
                  :percent="disk.usedPercentage"
                  :level="levelOf('disk', disk.usedPercentage)"
                  :label="`${disk.mountPoint} used`"
                />
                <p class="mt-1 text-xs text-muted tabular-nums">
                  {{ formatGiB(disk.used) }} of {{ formatGiB(disk.total) }} · {{ formatGiB(disk.free) }} free
                </p>
              </li>
              <li v-if="!disks.length" class="text-sm text-muted">No disks reported</li>
            </ul>
          </AppPanel>

          <AppPanel title="System">
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              <template v-for="[label, value] in details" :key="label">
                <dt class="text-muted">{{ label }}</dt>
                <dd class="truncate text-end text-highlighted tabular-nums" :title="value">{{ value }}</dd>
              </template>
            </dl>
          </AppPanel>
        </div>

        <ContainerTable
          v-if="containers.length"
          v-model:selection="containerSelection"
          :containers="containers"
          @command="runDockerCommand"
        />
        <ProcessTable v-model:selection="processSelection" :processes="processes" @kill="killProcesses" />
      </template>
    </template>
  </UDashboardPanel>
</template>
