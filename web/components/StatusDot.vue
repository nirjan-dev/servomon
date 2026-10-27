<script setup lang="ts">
defineProps<{ color: "success" | "warning" | "error" | "neutral" }>();

const BG = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  neutral: "bg-(--ui-text-dimmed)",
} as const;
</script>

<template>
  <span class="inline-block size-2 shrink-0 rounded-full" :class="BG[color]" aria-hidden="true" />
</template>
