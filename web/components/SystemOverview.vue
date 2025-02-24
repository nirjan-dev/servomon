<template>
  <UCard>
    <template #header
      ><div class="flex justify-between">
        <span class="capitalize"> {{ name }}</span>
        <UButton :to="link">View Details</UButton>
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
const props = defineProps<{
  name: string;
  link: string;
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
