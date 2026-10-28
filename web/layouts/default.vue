<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";
import { FRESHNESS_COLOR, freshnessOf, useNow } from "~/composables/useFreshness";
import { useFleet, useFleetPolling } from "~/composables/useFleet";

useFleetPolling();
const { entries, pending } = useFleet();
const now = useNow();
const open = ref(false);

const mainItems = computed<NavigationMenuItem[]>(() => [
  { label: "Overview", icon: "i-lucide-layout-grid", to: "/", exact: true },
  {
    label: "Agents",
    icon: "i-lucide-key-round",
    to: "/agents",
    badge: pending.value.length
      ? { label: String(pending.value.length), color: "warning", variant: "subtle" }
      : undefined,
  },
]);

// Status comes from each agent's last report (polled), so the list needs no
// per-system stream. Systems without an agent stay neutral.
const systemItems = computed<NavigationMenuItem[]>(() => [
  { label: "Systems", type: "label" },
  ...entries.value.map((entry) => ({
    label: entry.name,
    to: `/systems/${entry.name}`,
    ui: { linkLabel: "font-mono text-[13px]" },
    status: entry.agent ? FRESHNESS_COLOR[freshnessOf(entry.agent.lastSeenAt, now.value)] : "neutral",
  })),
]);
</script>

<template>
  <VitePwaManifest />
  <UDashboardGroup unit="rem" storage="local">
    <UDashboardSidebar
      id="main"
      v-model:open="open"
      collapsible
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink to="/" class="flex items-center gap-2.5 rounded-md px-1" aria-label="Servomon overview">
          <img src="/logo.svg" alt="" class="size-7 shrink-0 rounded-sm" />
          <span v-if="!collapsed" class="font-semibold tracking-tight text-highlighted">Servomon</span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="mainItems" orientation="vertical" tooltip />
        <UNavigationMenu
          v-if="entries.length"
          :collapsed="collapsed"
          :items="systemItems"
          orientation="vertical"
          tooltip
        >
          <template #item-leading="{ item }">
            <span v-if="item.status" class="flex size-5 items-center justify-center">
              <StatusDot :color="item.status" />
            </span>
          </template>
        </UNavigationMenu>
      </template>

      <template #footer="{ collapsed }">
        <div class="flex w-full flex-col gap-2">
        <NotificationSettings :collapsed="collapsed" />
        <div class="flex w-full items-center justify-between gap-2">
          <p v-if="!collapsed" class="text-xs text-muted">
            Made with ❤️ by
            <a class="underline underline-offset-2 hover:text-highlighted" target="_blank" href="https://nirjan.dev">Nirjan</a>
          </p>
          <UColorModeButton />
        </div>
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
