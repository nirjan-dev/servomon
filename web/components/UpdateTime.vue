<template>
  <UCard class="max-w-fit">
    <template #header><h2>Last update</h2></template>
    <h3 class="text-2xl font-semibold text-primary">{{ valueToShow }}</h3>
  </UCard>
</template>

<script setup lang="ts">
const props = defineProps<{
  updateTime?: number;
}>();

const valueToShow = computed(() => {
  if (props.updateTime) {
    return new Date(props.updateTime).toLocaleTimeString();
  }

  return "loading...";
});
</script>
