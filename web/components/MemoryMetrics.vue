<script setup lang="ts">
import {
  VisXYContainer,
  VisLine,
  VisAnnotations,
  VisTooltip,
  VisAxis,
  VisSingleContainer,
  VisDonut,
  VisBulletLegend,
  VisStackedBar,
} from "@unovis/vue";
const props = defineProps<{
  memoryMetrics: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
    timestamp: number;
  }[];
}>();

const chartData = computed(() => {
  const groupedByTimeStamp = Object.groupBy(
    props.memoryMetrics,
    (item) => item.timestamp,
  );

  console.log({ groupedByTimeStamp });

  return {
    usedPercent: props.memoryMetrics.map((m) => m.usedPercent),
    timeline: props.memoryMetrics.map((m) => m.timestamp),
  };
});
</script>

<template>
  <div class="py-4 my-6 flex gap-6 flex-wrap items-start">
    <UCard class="max-w-fit">
      <template #header>Memory</template>
      <h2 class="flex justify-between items-center gap-6">
        <span class="text-lg font-bold text-red-500"
          >{{ memoryMetrics.at(-1)?.used }} GBs</span
        >
        used
      </h2>

      <h2 class="flex justify-between items-center">
        <span class="text-lg font-bold text-green-500"
          >{{ memoryMetrics.at(-1)?.free }} GBs</span
        >
        free
      </h2>

      <h2 class="flex justify-between items-center">
        <span class="text-lg font-bold"
          >{{ memoryMetrics.at(-1)?.usedPercent }}%
        </span>
        usage
      </h2>
    </UCard>

    <VisXYContainer :data="memoryMetrics" class="max-w-xl">
      <VisLine :x="(d) => d.timestamp" :y="(d) => d.used" />
      <VisAxis
        :tickLine="undefined"
        :gridLine="false"
        type="x"
        label="Time"
        :tickFormat="(x) => new Date(x).toLocaleTimeString()"
      />
      <VisAxis
        :gridLine="false"
        :tickLine="undefined"
        :tickFormat="(y) => `${y} GBs`"
        type="y"
        label="Used"
      />
    </VisXYContainer>
  </div>
</template>

<style scoped></style>
