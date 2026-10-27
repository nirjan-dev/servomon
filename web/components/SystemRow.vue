<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import type { Metrics } from "../../shared/types";
import type { FleetEntry } from "~/composables/useFleet";
import { useFreshness } from "~/composables/useFreshness";
import { useMetricsStream } from "~/composables/useMetricsStream";
import { FLEET_GRID, osName } from "~/utils/layout";
import { displayRate, formatGiB, formatNumber, formatPercent, LEVEL_TEXT, levelOf } from "~/utils/metrics";

const props = defineProps<{ entry: FleetEntry }>();
const emit = defineEmits<{ alerts: [enabled: boolean]; delete: [] }>();

// S3: each row owns its stream. Removing the row unmounts it, which closes
// the stream via the composable's onUnmounted — no parent bookkeeping.
const { metrics, synced, connect } = useMetricsStream(computed(() => props.entry.name));
onMounted(connect);

const latest = computed(() => metrics.value.at(-1));
const freshness = useFreshness(computed(() => latest.value?.timestamp));
const link = computed(() => `/systems/${props.entry.name}`);

const SPARK_WINDOW_MS = 15 * 60_000;
const cpuTrend = computed(() => {
  const end = latest.value?.timestamp ?? 0;
  return metrics.value.filter((m) => m.timestamp >= end - SPARK_WINDOW_MS);
});
const cpuUsed = (m: Metrics) => m.cpu.used;

const cpuLevel = computed(() => levelOf("cpu", latest.value?.cpu.used));
const memLevel = computed(() => levelOf("memory", latest.value?.memory.usedPercentage));
const fullestDisk = computed(() => {
  const disks = latest.value?.disk ?? [];
  return disks.reduce<(typeof disks)[number] | undefined>(
    (worst, d) => (!worst || d.usedPercentage > worst.usedPercentage ? d : worst),
    undefined,
  );
});
const diskLevel = computed(() => levelOf("disk", fullestDisk.value?.usedPercentage));

const subtitle = computed(() => {
  if (synced.value && !latest.value) return "Waiting for first metrics";
  const info = latest.value?.systemInfo;
  return [info?.device, osName(info?.os)].filter(Boolean).join(" · ");
});

const statusText = computed(
  () =>
    ({ live: "text-muted", stale: "text-warning", offline: "text-error", unknown: "text-muted" })[
      freshness.state.value
    ],
);

const menu = computed<DropdownMenuItem[][]>(() => [
  [{ label: "Open", icon: "i-lucide-arrow-up-right", to: link.value }],
  [{ label: "Delete system…", icon: "i-lucide-trash-2", color: "error", onSelect: () => emit("delete") }],
]);
</script>

<template>
  <li
    :class="FLEET_GRID"
    class="relative px-4 py-3.5 transition-colors hover:bg-elevated/60 has-[a[data-row-link]:focus-visible]:outline-2 has-[a[data-row-link]:focus-visible]:-outline-offset-2 has-[a[data-row-link]:focus-visible]:outline-primary"
  >
    <div class="col-span-6 min-w-0 lg:col-span-1">
      <div class="flex min-w-0 items-center gap-2">
        <StatusDot :color="freshness.color.value" />
        <NuxtLink
          :to="link"
          data-row-link
          class="truncate font-mono text-[15px] font-semibold text-highlighted outline-none after:absolute after:inset-0"
        >
          {{ entry.name }}
        </NuxtLink>
        <UBadge v-if="!entry.agent" label="No agent" color="neutral" variant="subtle" size="sm" class="shrink-0" />
        <span class="ms-auto shrink-0 text-xs lg:hidden" :class="statusText">{{ freshness.label.value }}</span>
      </div>
      <p class="mt-0.5 truncate ps-4 text-xs text-muted">
        <span class="hidden lg:inline" :class="statusText">{{ freshness.label.value }}</span>
        <span v-if="subtitle" class="hidden lg:inline"> · </span>{{ subtitle }}
      </p>
    </div>

    <template v-if="latest">
      <div class="col-span-2 min-w-0 lg:col-span-1" :class="{ 'opacity-50': freshness.state.value === 'offline' }">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-xs text-muted lg:hidden">CPU</span>
          <span class="font-medium tabular-nums" :class="LEVEL_TEXT[cpuLevel]">{{ formatPercent(latest.cpu.used) }}</span>
          <span class="hidden text-xs text-muted tabular-nums xl:inline">{{ latest.cpu.cores }} cores</span>
        </div>
        <SparkLine class="mt-1" :data="cpuTrend" :value="cpuUsed" :y-domain="[0, 100]" />
      </div>

      <div class="col-span-2 min-w-0 lg:col-span-1" :class="{ 'opacity-50': freshness.state.value === 'offline' }">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-xs text-muted lg:hidden">Memory</span>
          <span class="font-medium tabular-nums" :class="LEVEL_TEXT[memLevel]">{{ formatPercent(latest.memory.usedPercentage) }}</span>
          <span class="hidden text-xs text-muted tabular-nums xl:inline">
            {{ formatNumber(latest.memory.used) }} / {{ formatGiB(latest.memory.total) }}
          </span>
        </div>
        <UsageMeter
          class="mt-2.5"
          :percent="latest.memory.usedPercentage"
          :level="memLevel"
          :label="`Memory used on ${entry.name}`"
        />
      </div>

      <div class="col-span-2 min-w-0 lg:col-span-1" :class="{ 'opacity-50': freshness.state.value === 'offline' }">
        <template v-if="fullestDisk">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-xs text-muted lg:hidden">Disk</span>
            <span class="font-medium tabular-nums" :class="LEVEL_TEXT[diskLevel]">{{ formatPercent(fullestDisk.usedPercentage) }}</span>
            <span class="hidden truncate font-mono text-xs text-muted xl:inline">{{ fullestDisk.mountPoint }}</span>
          </div>
          <UsageMeter
            class="mt-2.5"
            :percent="fullestDisk.usedPercentage"
            :level="diskLevel"
            :label="`Fullest disk on ${entry.name}`"
          />
        </template>
        <span v-else class="text-xs text-muted">No disks</span>
      </div>

      <div
        class="col-span-4 flex min-w-0 gap-x-4 text-sm tabular-nums lg:col-span-1 lg:flex-col"
        :class="{ 'opacity-50': freshness.state.value === 'offline' }"
      >
        <span class="flex items-center gap-1 truncate">
          <UIcon name="i-lucide-arrow-down" class="size-3.5 shrink-0 text-dimmed" />
          <span class="sr-only">Download</span>{{ displayRate(latest.networkInfo.downloadPerSecond) }}
        </span>
        <span class="flex items-center gap-1 truncate">
          <UIcon name="i-lucide-arrow-up" class="size-3.5 shrink-0 text-dimmed" />
          <span class="sr-only">Upload</span>{{ displayRate(latest.networkInfo.uploadPerSecond) }}
        </span>
      </div>
    </template>

    <template v-else>
      <div v-for="n in 3" :key="n" class="col-span-2 lg:col-span-1">
        <USkeleton v-if="!synced" class="h-8 w-full" />
        <span v-else class="text-sm text-dimmed">—</span>
      </div>
      <div class="col-span-4 lg:col-span-1">
        <USkeleton v-if="!synced" class="h-8 w-full" />
        <span v-else class="text-sm text-dimmed">—</span>
      </div>
    </template>

    <div class="relative z-10 col-span-2 flex items-center justify-end gap-1 lg:col-span-1">
      <UTooltip :text="entry.alerts ? 'Alerts on' : 'Alerts off'">
        <USwitch
          :model-value="entry.alerts"
          size="sm"
          color="neutral"
          :aria-label="`Push alerts for ${entry.name}`"
          @update:model-value="(enabled: boolean) => emit('alerts', enabled)"
        />
      </UTooltip>
      <UDropdownMenu :items="menu" :content="{ align: 'end' }">
        <UButton
          icon="i-lucide-ellipsis"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          :aria-label="`Actions for ${entry.name}`"
        />
      </UDropdownMenu>
    </div>
  </li>
</template>
