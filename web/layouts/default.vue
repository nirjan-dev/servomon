<template>
  <VitePwaManifest />
  <UContainer>
    <MetricsTitle />
    <slot />

    <UNotifications />

    <footer>
      <p class="text-center py-4">
        Made with ❤️ by
        <a
          class="underline text-blue-500"
          target="_blank"
          href="https://nirjan.dev"
          >Nirjan</a
        >
      </p>
    </footer>
  </UContainer>
</template>

<script lang="ts" setup></script>

<style></style>
