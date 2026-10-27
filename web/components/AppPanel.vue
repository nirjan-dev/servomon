<script setup lang="ts">
defineProps<{ title?: string; flush?: boolean }>();
</script>

<template>
  <section class="min-w-0 rounded-lg border border-default bg-default">
    <header
      v-if="title || $slots.header || $slots.actions"
      class="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3"
      :class="{ 'pb-3 border-b border-default': flush }"
    >
      <slot name="header">
        <h2 class="text-sm font-semibold text-highlighted">{{ title }}</h2>
      </slot>
      <slot name="actions" />
    </header>
    <div :class="flush ? '' : 'p-4'">
      <slot />
    </div>
  </section>
</template>
