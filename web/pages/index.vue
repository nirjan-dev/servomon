<template>
  <div>
    <AgentsManager />
    <h1 class="lg:text-xl text-lg font-semi-bold">All available systems</h1>
    <div
      v-if="!isLoading"
      class="grid md:grid-cols-2 grid-cols-1 lg:grid-cols-3 gap-4 py-6"
    >
      <div v-for="system in systems" :key="system">
        <SystemOverview
          :name="system"
          :link="`/systems/${system}`"
          :enable-alert="systemConfigs[system]?.enableAlerts"
          @change-alert-toggle="
            (value) => handleAlertToggleChange(value, system)
          "
          @delete-system="(name) => handleDeleteSystem(name)"
        />
      </div>
    </div>

    <USkeleton v-else class="h-60 w-full my-6" />
  </div>
</template>

<script lang="ts" setup>
const isLoading = ref(false);

const systems = ref<string[]>([]);
const systemConfigs = ref<
  Record<
    string,
    {
      enableAlerts: boolean;
    }
  >
>({});

async function loadSystems() {
  systems.value = (await $fetch("/api/sytems")) ?? [];
}

async function loadSystemConfigs() {
  const savedSystemConfigs = await $fetch("/api/system-configs");

  if (savedSystemConfigs) {
    systemConfigs.value = savedSystemConfigs;
  }
}

onMounted(async () => {
  try {
    isLoading.value = true;
    await Promise.allSettled([loadSystems(), loadSystemConfigs()]);
  } catch (error) {
    console.log({ error });
  } finally {
    isLoading.value = false;
  }
});

async function handleDeleteSystem(system: string) {
  if (!confirm(`Delete "${system}" and all its stored metrics, config, and enrollment? This cannot be undone.`)) return;
  try {
    await $fetch(`/api/systems/${system}`, { method: "DELETE" });
    // Removing the card unmounts it, which closes its stream.
    systems.value = systems.value.filter((s) => s !== system);
    useToast().add({ title: `Deleted "${system}"`, color: "green" });
  } catch (error) {
    console.log({ error });
    useToast().add({ title: `Error deleting "${system}"`, color: "red" });
  }
}

async function handleAlertToggleChange(value: boolean, system: string) {
  try {
    await $fetch("/api/system-config", {
      method: "PUT",
      body: {
        system,
        enableAlerts: value,
      },
    });
    useToast().add({
      title: "Successfully updated system alert config",
      color: "green",
    });
  } catch (error) {
    console.log({ error });
    useToast().add({
      title: "Error updating system alert config",
      color: "red",
    });
  }
}
</script>

<style></style>
