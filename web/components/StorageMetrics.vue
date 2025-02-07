<template>
  <UCard>
    <template #header>Disk Usage (in GBs)</template>

    <div class="flex gap-5">
      <VisXYContainer
        width="60"
        v-for="(diskMetrics, index) in storageMetrics"
        :data="[diskMetrics]"
      >
        <VisAxis
          type="x"
          :tickFormat="tickFormatForXAxis"
          tickTextFitMode="wrap"
          :tickTextWidth="30"
        />
        <VisAxis :tickLine="undefined" :gridLine="false" type="y" />
        <VisStackedBar
          :color="['tomato', '#22c55e']"
          :x="(_d: DiskMetrics) => index"
          :y="[(d: DiskMetrics) => d.free, (d: DiskMetrics) => d.used]"
        />
      </VisXYContainer>
    </div>
  </UCard>
</template>

<script lang="ts" setup>
import { VisAxis, VisStackedBar, VisXYContainer } from "@unovis/vue";

const props = defineProps<{
  storageMetrics: {
    used: number;
    total: number;
    usedPercent: number;
    free: number;
    mount: string;
  }[];
}>();
type DiskMetrics = (typeof props.storageMetrics)[0];
const mounts = computed(() =>
  props.storageMetrics.map((d) => `${d.mount} ${d.usedPercent}%`)
);
const tickFormatForXAxis = (tick: number) => mounts.value[tick];
</script>

<style></style>
