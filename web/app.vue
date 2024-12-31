<template>
  <UContainer>
    <UCard class="mt-10">
      <template #header>
        <h1>Server Metrics</h1>
      </template>

      <UTable :rows="metricsRows" />
    </UCard>
  </UContainer>
</template>

<script setup lang="ts">
import type { Metrics } from "../shared/types";

const metrics = ref<Metrics[]>([]);

const metricsRows = computed(() => {
  return metrics.value.map((metricsItem) => {
    return {
      time: new Date(metricsItem.timestamp).toLocaleTimeString(),
      "Memory Total": metricsItem.memory.total,

      "Memory Free": metricsItem.memory.free,

      "Memory used %": metricsItem.memory.usedPercentage,
    };
  });
});

onMounted(async () => {
  const metricsStream = new EventSource(
    "http://localhost:3000/api/metrics-stream"
  );

  metricsStream.onmessage = (event) => {
    metrics.value = JSON.parse(event.data) as Metrics[];
  };
});
</script>
