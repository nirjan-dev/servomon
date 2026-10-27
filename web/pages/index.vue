<script lang="ts" setup>
import { freshnessOf, useNow, type FreshnessState } from "~/composables/useFreshness";
import { useFleet } from "~/composables/useFleet";
import { FLEET_GRID } from "~/utils/layout";

const { entries, pending, loaded, setAlerts, deleteSystem } = useFleet();
const now = useNow();

const SETUP_GUIDE = "https://nirjan-dev.github.io/servomon/guide.html";

// Fleet summary from each agent's last report, like the sidebar.
const summary = computed(() => {
  const counts: Partial<Record<FreshnessState, number>> = {};
  for (const entry of entries.value) {
    if (!entry.agent?.lastSeenAt) continue;
    const state = freshnessOf(entry.agent.lastSeenAt, now.value);
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return (
    [
      ["live", "success"],
      ["stale", "warning"],
      ["offline", "error"],
    ] as const
  )
    .filter(([state]) => counts[state])
    .map(([state, color]) => ({ state, color, count: counts[state]! }));
});

const pendingTitle = computed(() =>
  pending.value.length === 1
    ? `${pending.value[0]!.system} is waiting for approval`
    : `${pending.value.length} agents are waiting for approval`,
);
</script>

<template>
  <UDashboardPanel id="overview">
    <template #header>
      <UDashboardNavbar title="Overview">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <ul class="flex items-center gap-4 text-xs text-muted tabular-nums" aria-label="Fleet status">
            <li v-for="item in summary" :key="item.state" class="flex items-center gap-1.5">
              <StatusDot :color="item.color" />{{ item.count }} {{ item.state }}
            </li>
          </ul>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="pending.length"
        color="neutral"
        variant="outline"
        icon="i-lucide-key-round"
        orientation="horizontal"
        :title="pendingTitle"
        description="Check the pairing code against the agent's terminal, then approve it."
        :actions="[{ label: 'Review', to: '/agents', color: 'neutral', variant: 'solid' }]"
      />

      <section v-if="entries.length" aria-label="Systems" class="overflow-hidden rounded-lg border border-default">
        <div
          :class="FLEET_GRID"
          class="hidden border-b border-default bg-muted px-4 py-2 text-xs font-medium text-muted lg:grid"
          aria-hidden="true"
        >
          <span>System</span>
          <span>CPU</span>
          <span>Memory</span>
          <span>Disk</span>
          <span>Network</span>
          <span class="text-end">Alerts</span>
        </div>
        <ul class="divide-y divide-default">
          <SystemRow
            v-for="entry in entries"
            :key="entry.name"
            :entry="entry"
            @alerts="(enabled: boolean) => setAlerts(entry.name, enabled)"
            @delete="deleteSystem(entry.name)"
          />
        </ul>
      </section>

      <UEmpty
        v-else-if="loaded"
        icon="i-lucide-server"
        title="No systems yet"
        description="Run the agent on a machine you want to monitor. Its pairing request shows up under Agents."
        :actions="[
          { label: 'Setup guide', to: SETUP_GUIDE, target: '_blank', trailingIcon: 'i-lucide-arrow-up-right', color: 'neutral', variant: 'outline' },
        ]"
      />

      <USkeleton v-else class="h-48 w-full" />
    </template>
  </UDashboardPanel>
</template>
