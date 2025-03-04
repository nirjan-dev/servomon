<template>
  <UCard>
    <template #header><h2>System Info</h2></template>
    <h2 class="flex justify-between items-center">
      Name
      <span class="capitalize font-bold text-primary">{{ name }} </span>
    </h2>

    <h2 class="flex justify-between items-center">
      Updated at
      <span class="font-bold text-primary">{{ updateTime }} </span>
    </h2>
    <template v-if="systemInfo" v-for="(info, label) in systemInfo">
      <h2 class="mb-2 flex justify-between items-center">
        {{ label }}
        <span class="font-bold">{{ info }} </span>
      </h2>
    </template>
  </UCard>
</template>

<script setup lang="ts">
const props = defineProps<{
  name: string | string[];
  timestamp?: number;
  systemInfo?: {
    os: string;
    kernel: string;
    device: string;
  };
}>();

const updateTime = computed(() => {
  if (props.timestamp) {
    return new Date(props.timestamp).toLocaleTimeString();
  }

  return "loading...";
});
</script>
