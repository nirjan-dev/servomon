<template>
  <UCard>
    <template #header>Disk Usage (in GBs)</template>

    <div class="flex gap-5">
      <div
        class="grid items-start justify-center text-center"
        v-for="(diskMetrics, index) in storageMetrics"
      >
        <p class="text-xs pl-9">{{ diskMetrics.usedPercent }}%</p>

        <VisXYContainer :width="80" :data="[diskMetrics]">
          <VisAxis
            type="x"
            :tickFormat="tickFormatForXAxis"
            tickTextFontSize="10px"
            tickTextFitMode="wrap"
            position="top"
            :tickLine="undefined"
          />
          <VisAxis
            :tickLine="undefined"
            :gridLine="false"
            type="y"
            tickTextFontSize="10px"
          />
          <VisStackedBar
            :color="['#ef4444', '#22c55e']"
            :x="(_d: DiskMetrics) => index"
            :y="[(d: DiskMetrics) => d.used, (d: DiskMetrics) => d.free]"
          />
        </VisXYContainer>
      </div>
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
  props.storageMetrics.map((d) =>
    d.mount === "/" ? `${d.mount}` : `${d.mount.split("/").at(-1)}`
  )
);
const tickFormatForXAxis = (tick: number) => mounts.value[tick];
</script>

<style></style>
