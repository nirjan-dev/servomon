<script setup lang="ts">
import type { Level } from "~/utils/metrics";

const props = defineProps<{ percent: number; level: Level; label: string }>();

const FILL = {
  ok: "bg-(--ui-text-dimmed)",
  warning: "bg-warning",
  critical: "bg-error",
} as const;

const width = computed(() => `${Math.min(100, Math.max(0, props.percent))}%`);
</script>

<template>
  <div
    role="meter"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(percent)"
    class="h-1 w-full overflow-hidden rounded-full bg-accented"
  >
    <div class="h-full rounded-full" :class="FILL[level]" :style="{ width }" />
  </div>
</template>
