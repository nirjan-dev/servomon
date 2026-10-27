<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
  confirmLabel: string;
}>();

const emit = defineEmits<{ close: [boolean] }>();
</script>

<template>
  <!-- Escape and outside clicks cancel; focus starts on Cancel (first control). -->
  <UModal
    :title="title"
    :description="description"
    :close="false"
    :ui="{ footer: 'justify-end' }"
    @update:open="(open: boolean) => !open && emit('close', false)"
  >
    <template #footer>
      <UButton color="neutral" variant="outline" label="Cancel" @click="emit('close', false)" />
      <UButton color="error" :label="confirmLabel" @click="emit('close', true)" />
    </template>
  </UModal>
</template>
