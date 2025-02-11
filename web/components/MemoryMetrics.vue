<script setup lang="ts">
import { VisXYContainer, VisAxis, VisArea } from "@unovis/vue";
const props = defineProps<{
  memoryMetrics: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
    timestamp: number;
  }[];
}>();
type MemoryMetric = (typeof props.memoryMetrics)[0];
const totalMemory = computed(() => props.memoryMetrics[0]?.total ?? 0);
</script>

<template>
  <UCard>
    <template #header
      >Memory Usage ({{ memoryMetrics.at(-1)?.usedPercent }}%)</template
    >
    <VisXYContainer :data="memoryMetrics" :yDomain="[0, totalMemory]">
      <VisArea
        color="#ef4444"
        :x="(d: MemoryMetric) => d.timestamp"
        :y="(d: MemoryMetric) => d.used"
      />
      <VisAxis
        :tickLine="undefined"
        :gridLine="false"
        type="x"
        :tickFormat="(x: number) => new Date(x).toLocaleTimeString()"
      />
      <VisAxis
        :gridLine="true"
        :tickLine="true"
        :tickFormat="(y: number) => `${y} GBs`"
        type="y"
      />
    </VisXYContainer>
  </UCard>
</template>

<style scoped></style>
