<template>
  <header class="flex items-center py-6 gap-2">
    <img class="h-10" src="/logo.svg" alt="" />
    <h1>
      <span class="font-bold text-lg">Servomon</span> | simple home server
      monitoring

      <span v-if="updateTime" class="ml-1 text-lg">
        | updated at
        <span class="text-primary font-semibold">
          {{ new Date(updateTime).toLocaleTimeString() }}
        </span>
      </span>
    </h1>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  updateTime?: number;
}>();
</script>
