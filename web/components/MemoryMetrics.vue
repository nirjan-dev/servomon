<script setup lang="ts">
import { VisXYContainer, VisLine, VisAxis } from "@unovis/vue";
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
</script>

<template>
  <UCard>
    <template #header>Memory Used</template>
    <VisXYContainer :data="memoryMetrics">
      <VisLine
        :x="(d: MemoryMetric) => d.timestamp"
        :y="(d: MemoryMetric) => d.used"
      />
      <VisAxis
        :tickLine="undefined"
        :gridLine="false"
        type="x"
        label="Time"
        :tickFormat="(x: number) => new Date(x).toLocaleTimeString()"
      />
      <VisAxis
        :gridLine="false"
        :tickLine="undefined"
        :tickFormat="(y: number) => `${y} GBs`"
        type="y"
        label="Used"
      />
    </VisXYContainer>
  </UCard>
</template>

<style scoped></style>
