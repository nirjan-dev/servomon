<script lang="ts">
import type { Metrics } from "../../shared/types";

export type ChartSeries = {
  label: string;
  value: (m: Metrics) => number;
  color: string;
};
</script>

<script setup lang="ts">
import { VisArea, VisAxis, VisCrosshair, VisLine, VisTooltip, VisXYContainer } from "@unovis/vue";

const props = defineProps<{
  data: Metrics[];
  series: ChartSeries[];
  format: (value: number) => string;
  label: string;
  yDomain?: [number | undefined, number | undefined];
  yTicks?: number[];
  height?: number;
}>();

const tick = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const exact = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const x = (m: Metrics) => m.timestamp;
const ys = computed(() => props.series.map((s) => s.value));
const color = (_d: unknown, i: number) => props.series[i]?.color ?? "var(--chart-series)";
const first = computed(() => props.series[0]!);

// Values are numbers formatted by our own functions; labels are static.
function tooltip(m: Metrics): string {
  const rows = props.series
    .map(
      (s) =>
        `<div class="flex items-center gap-2"><span class="size-2 rounded-full" style="background:${s.color}"></span>` +
        `<span class="text-muted">${s.label}</span><span class="ms-auto ps-4 font-medium tabular-nums">${props.format(s.value(m))}</span></div>`,
    )
    .join("");
  return `<div class="min-w-32 space-y-1 text-xs"><div class="text-muted tabular-nums">${exact.format(m.timestamp)}</div>${rows}</div>`;
}
</script>

<template>
  <div role="img" :aria-label="label">
    <VisXYContainer :data="data" :height="height ?? 168" :y-domain="yDomain" :duration="0" :padding="{ top: 6 }">
      <VisArea :x="x" :y="first.value" :color="first.color" :opacity="0.1" :duration="0" />
      <VisLine :x="x" :y="ys" :color="color" :line-width="1.5" :duration="0" />
      <VisAxis
        type="x"
        :tick-format="(t: number) => tick.format(t)"
        :num-ticks="4"
        :tick-text-hide-overlapping="true"
        :grid-line="false"
        :tick-line="false"
        :duration="0"
      />
      <VisAxis
        type="y"
        :tick-format="(v: number) => format(v)"
        :num-ticks="yTicks ? undefined : 3"
        :tick-values="yTicks"
        :tick-line="false"
        :domain-line="false"
        :duration="0"
      />
      <VisCrosshair :x="x" :y="ys" :template="tooltip" :color="color" />
      <VisTooltip />
    </VisXYContainer>
  </div>
</template>
