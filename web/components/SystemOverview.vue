<template>
  <UCard>
    <template #header
      ><div class="flex flex-wrap justify-between items-center">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="capitalize font-bold text-primary"> {{ name }}</span>
          <span class="flex items-center gap-1.5 text-xs text-gray-500">
            <span class="inline-block w-2 h-2 rounded-full" :class="freshness.dotClass.value" />
            {{ freshness.label.value }}
          </span>
        </div>
        <div class="flex items-center gap-4 flex-wrap">
          <span class="flex items-center gap-1">
            Alerts
            <UToggle
              @change="(value) => $emit('changeAlertToggle', value)"
              v-model="enableAlert"
            />
          </span>
          <UButton :to="link">View Details</UButton>
          <UButton color="red" variant="soft" size="sm" @click="$emit('deleteSystem', name)">Delete</UButton>
        </div>
      </div>
    </template>

    <div v-if="latest">
      <h2
        v-for="(info, label) in rows"
        class="flex mb-1 justify-between items-center"
      >
        <span class="text-sm">{{ label }}</span>
        <span :title="info" class="text-base font-bold truncate max-w-36"
          >{{ info }}
        </span>
      </h2>
    </div>
    <USkeleton v-else class="h-60 w-full" />
  </UCard>
</template>

<script lang="ts" setup>
import { useFreshness } from "~/composables/useFreshness";
import { useMetricsStream } from "~/composables/useMetricsStream";
const emits = defineEmits<{
  (e: "changeAlertToggle", value: boolean): void;
  (e: "deleteSystem", system: string): void;
}>();

const props = defineProps<{
  name: string;
  link: string;
  enableAlert?: boolean;
}>();

// S3: each card owns its stream. Deleting the card unmounts it, which closes
// the stream via the composable's onUnmounted — no parent bookkeeping.
const { metrics, connect } = useMetricsStream(computed(() => props.name));
const latest = computed(() => metrics.value.at(-1));
const freshness = useFreshness(computed(() => latest.value?.timestamp));

onMounted(() => {
  connect();
});

const enableAlert = ref(props.enableAlert ?? true);
const formatter = new Intl.DateTimeFormat("en-Us", {
  month: "short",
  day: "2-digit",
  hourCycle: "h12",
  hour: "2-digit",
  minute: "2-digit",
});
const rows = computed(() => {
  const m = latest.value;
  if (!m) return {};
  return {
    "Last Update": formatter.format(new Date(m.timestamp)),
    OS: m.systemInfo.os,
    Device: m.systemInfo.device,
    Battery: `${m.battery.charge}%`,
    "Memory Used": `${m.memory.usedPercentage}%`,
    "CPU Used": `${m.cpu.used}%`,
    "Active Containers": `${m.containersInfo.length}`,
    "Download Speed": `${m.networkInfo.downloadPerSecond}`,
    "Upload Speed": `${m.networkInfo.uploadPerSecond}`,
  };
});
</script>

<style></style>
