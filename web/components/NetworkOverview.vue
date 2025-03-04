<template>
  <UCard class="min-w-72">
    <template #header>Network Overview</template>

    <template v-for="(metric, label) in networkMetrics">
      <h2 class="flex justify-between items-center">
        {{ formatLabel(label) }}
        <span class="text-lg font-bold">{{ metric }} </span>
      </h2>
    </template>
  </UCard>
</template>

<script lang="ts" setup>
defineProps<{
  networkMetrics?: {
    upload: string;
    download: string;
    uploadErrors: string;
    downloadErrors: string;
    uploadDrops: string;
    downloadDrops: string;
  };
}>();

function formatLabel(label: string): string {
  let formattedLabel = label;

  const regex = /([a-z])([A-Z])/;

  return formattedLabel
    .replace(regex, "$1 $2")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
</script>

<style></style>
