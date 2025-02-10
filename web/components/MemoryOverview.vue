<script setup lang="ts">
defineProps<{
  memoryMetrics: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
    timestamp: number;
  };
}>();
</script>

<template>
  <UCard class="max-w-fit min-w-52">
    <template #header>Memory Overview</template>
    <h2 class="flex justify-between items-center gap-6">
      Used
      <span class="text-lg font-bold text-red-500"
        >{{ memoryMetrics.used }} GBs</span
      >
    </h2>

    <h2 class="flex justify-between items-center">
      Free
      <span class="text-lg font-bold text-green-500"
        >{{ memoryMetrics.free }} GBs</span
      >
    </h2>

    <h2 class="flex justify-between items-center">
      Total
      <span class="text-lg font-bold">{{ memoryMetrics.total }} GBs </span>
    </h2>

    <h2 class="flex justify-between items-center">
      Usage
      <span class="text-lg font-bold">{{ memoryMetrics.usedPercent }}% </span>
    </h2>
  </UCard>
</template>
