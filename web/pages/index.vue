<template>
  <div>
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
          :metrics="systemMetricsStreams[system].at(-1)!"
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

const systemMetricsStreams = reactive<Record<string, Metrics[]>>({});

function setupMetricsStream() {
  systems.value.forEach((system) => {
    const metricsStream = new EventSource("/api/metrics-stream?name=" + system);

    metricsStream.onmessage = (event) => {
      const newMetrics = JSON.parse(event.data) as Metrics[];

      systemMetricsStreams[system] = newMetrics;
    };
  });
}

async function loadSystems() {
  systems.value = (await $fetch("/api/sytems")) ?? [];
}

onMounted(async () => {
  try {
    isLoading.value = true;
    await loadSystems();
    setupMetricsStream();
  } catch (error) {
    console.log({ error });
  } finally {
    isLoading.value = false;
  }
});
</script>

<style></style>
