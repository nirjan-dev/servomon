<template>
  <UContainer>
    <UCard class="mt-10">
      <template #header>
        <h1>Server Metrics</h1>
      </template>

      <ul>
        <li v-for="metric in metrics">
          <pre>
            <code>
              {{ metric }}
            </code>
          </pre>
        </li>
      </ul>
    </UCard>
  </UContainer>
</template>

<script setup lang="ts">
const metrics = ref([]);

onMounted(async () => {
  const metricsStream = new EventSource(
    "http://localhost:3000/api/metrics-stream"
  );

  metricsStream.onmessage = (event) => {
    metrics.value = JSON.parse(event.data);
  };
});
</script>
