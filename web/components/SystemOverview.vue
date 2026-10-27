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

    <div>
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
  </UCard>
</template>

<script lang="ts" setup>
import { useFreshness } from "~/composables/useFreshness";
const emits = defineEmits<{
  (e: "changeAlertToggle", value: boolean): void;
  (e: "deleteSystem", system: string): void;
}>();

const props = defineProps<{
  name: string;
  link: string;
  enableAlert?: boolean;
  metrics: {
    timestamp: number;
    memory: {
      usedPercentage: number;
    };
    cpu: {
      used: number;
    };
    containersInfo: unknown[];
    networkInfo: {
      downloadPerSecond: string;
      uploadPerSecond: string;
    };
    systemInfo: {
      os: string;
      device: string;
    };
    battery: {
      charge: number;
    };
  };
}>();

const freshness = useFreshness(computed(() => props.metrics.timestamp));
const enableAlert = ref(props.enableAlert ?? true);
const formatter = new Intl.DateTimeFormat("en-Us", {
  month: "short",
  day: "2-digit",
  hourCycle: "h12",
  hour: "2-digit",
  minute: "2-digit",
});
const rows = computed(() => {
  return {
    "Last Update": formatter.format(new Date(props.metrics.timestamp)),
    OS: props.metrics.systemInfo.os,
    Device: props.metrics.systemInfo.device,
    Battery: `${props.metrics.battery.charge}%`,
    "Memory Used": `${props.metrics.memory.usedPercentage}%`,
    "CPU Used": `${props.metrics.cpu.used}%`,
    "Active Containers": `${props.metrics.containersInfo.length}`,
    "Download Speed": `${props.metrics.networkInfo.downloadPerSecond}`,
    "Upload Speed": `${props.metrics.networkInfo.uploadPerSecond}`,
  };
});
</script>

<style></style>
