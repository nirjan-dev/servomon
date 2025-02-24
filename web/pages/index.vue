<template>
  <div>
    <h1 class="lg:text-xl text-lg font-semi-bold">All available systems</h1>
    <div class="grid md:grid-cols-2 grid-cols-1 lg:grid-cols-3 gap-4 py-6">
      <div v-for="system in systems">
        <SystemOverview
          v-if="systemMetricsStreams[system]?.at(-1)"
          :name="system"
          :link="`/systems/${system}`"
          :metrics="systemMetricsStreams[system].at(-1)!"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { Metrics } from "../../shared/types";

const systems = (await $fetch("/api/sytems")) ?? [];
const systemMetricsStreams = reactive<Record<string, Metrics[]>>({});

function setupMetricsStream() {
  systems.forEach((system) => {
    const metricsStream = new EventSource("/api/metrics-stream?name=" + system);

    metricsStream.onmessage = (event) => {
      const newMetrics = JSON.parse(event.data) as Metrics[];

      systemMetricsStreams[system] = newMetrics;
    };
  });
}

onMounted(() => {
  setupMetricsStream();
});
</script>

<style></style>
