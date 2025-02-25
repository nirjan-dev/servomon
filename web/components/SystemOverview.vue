<template>
  <UCard>
    <template #header
      ><div class="flex flex-wrap justify-between">
        <span class="capitalize"> {{ name }}</span>
        <div class="flex items-center gap-4 flex-wrap">
          <span class="flex items-center gap-1">
            Alerts
            <UToggle
              @change="(value) => $emit('changeAlertToggle', value)"
              v-model="enableAlert"
            />
          </span>
          <UButton :to="link">View Details</UButton>
        </div>
      </div>
    </template>

    <div>
      <h2
        v-for="(info, label) in rows"
        class="flex justify-between items-center"
      >
        {{ label }}
        <span class="text-lg font-bold">{{ info }} </span>
      </h2>
    </div>
  </UCard>
</template>

<script lang="ts" setup>
const emits = defineEmits<{
  (e: "changeAlertToggle", value: boolean): void;
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

const enableAlert = ref(props.enableAlert ?? true);

const rows = computed(() => {
  return {
    "Last Update": new Date(props.metrics.timestamp).toLocaleString(),
    OS: props.metrics.systemInfo.os,
    Device: props.metrics.systemInfo.device,
    Battery: props.metrics.battery.charge,
    "Memory Used": `${props.metrics.memory.usedPercentage}%`,
    "CPU Used": `${props.metrics.cpu.used}%`,
    "Active Containers": `${props.metrics.containersInfo.length}`,
    "Download Speed": `${props.metrics.networkInfo.downloadPerSecond}`,
    "Upload Speed": `${props.metrics.networkInfo.uploadPerSecond}`,
  };
});
</script>

<style></style>
