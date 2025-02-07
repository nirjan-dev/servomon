<template>
  <UCard>
    <template #header> CPU Usage (in %)</template>

    <VisXYContainer :data="cpuMetrics" :yDomain="[0, 100]">
      <VisArea
        color="tomato"
        :x="(d: CPUMetric) => d.timestamp"
        :y="(d: CPUMetric) => d.used"
      />

      <VisAxis
        :gridLine="false"
        :tickLine="undefined"
        type="x"
        :tickFormat="(x: number) => new Date(x).toLocaleTimeString()"
      />
      <VisAxis type="y" />
    </VisXYContainer>
  </UCard>
</template>

<script lang="ts" setup>
import { VisArea, VisAxis, VisXYContainer } from "@unovis/vue";

const props = defineProps<{
  cpuMetrics: {
    used: number;
    timestamp: number;
  }[];
}>();

type CPUMetric = (typeof props.cpuMetrics)[0];
</script>

<style></style>
