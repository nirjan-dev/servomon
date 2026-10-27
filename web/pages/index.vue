<template>
  <div>
    <AgentsManager />
    <h1 class="lg:text-xl text-lg font-semi-bold">All available systems</h1>
    <div
      v-if="!isLoading"
      class="grid md:grid-cols-2 grid-cols-1 lg:grid-cols-3 gap-4 py-6"
    >
      <div v-for="system in systems">
        <SystemOverview
          v-if="systemMetricsStreams[system]?.at(-1)"
          :name="system"
          :link="`/systems/${system}`"
          :enable-alert="systemConfigs[system]?.enableAlerts"
          :metrics="systemMetricsStreams[system].at(-1)!"
          @change-alert-toggle="
            (value) => handleAlertToggleChange(value, system)
          "
          @delete-system="(name) => handleDeleteSystem(name)"
        />
        <USkeleton class="h-60 w-full" v-else />
      </div>
    </div>

    <USkeleton v-else class="h-60 w-full my-6" />
  </div>
</template>

<script lang="ts" setup>
import type { Metrics } from "../../shared/types";
const isLoading = ref(false);

const systems = ref([]);
const systemConfigs = ref<
  Record<
    string,
    {
      enableAlerts: boolean;
    }
  >
>({});
const systemMetricsStreams = reactive<Record<string, Metrics[]>>({});
const streamHandles: Record<string, EventSource> = {};

function setupMetricsStream() {
  systems.value.forEach((system) => {
    const metricsStream = new EventSource("/api/metrics-stream?name=" + system);
    streamHandles[system] = metricsStream;

    metricsStream.onmessage = (event) => {
      const newMetrics = JSON.parse(event.data) as Metrics[];

      systemMetricsStreams[system] = newMetrics;
    };
  });
}

onUnmounted(() => {
  for (const stream of Object.values(streamHandles)) stream.close();
});

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
    setupMetricsStream();
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
    streamHandles[system]?.close();
    delete streamHandles[system];
    delete systemMetricsStreams[system];
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
