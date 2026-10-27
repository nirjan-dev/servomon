<script setup lang="ts">
import { VisArea, VisLine, VisXYContainer } from "@unovis/vue";
import type { Metrics } from "../../shared/types";

defineProps<{
  data: Metrics[];
  value: (m: Metrics) => number;
  yDomain?: [number | undefined, number | undefined];
  height?: number;
}>();

const x = (m: Metrics) => m.timestamp;
</script>

<template>
  <!-- Decorative trend; the exact value is printed next to it. -->
  <div aria-hidden="true">
    <VisXYContainer
      :data="data"
      :height="height ?? 22"
      :y-domain="yDomain"
      :auto-margin="false"
      :margin="{ top: 1, right: 0, bottom: 1, left: 0 }"
      :duration="0"
    >
      <VisArea :x="x" :y="value" color="var(--chart-series)" :opacity="0.12" :duration="0" />
      <VisLine :x="x" :y="value" color="var(--chart-series)" :line-width="1.5" :duration="0" />
    </VisXYContainer>
  </div>
</template>
