<script lang="ts" setup>
import { ageLabel, FRESHNESS_COLOR, freshnessOf, useNow } from "~/composables/useFreshness";
import { useFleet } from "~/composables/useFleet";

const { agents, pending, loaded, approve, deny, removeAgent } = useFleet();
const now = useNow();
const busy = ref<string | null>(null);

const SETUP_GUIDE = "https://servomon.nirjan.dev/agent-install";
const addOpen = ref(false);
const agentName = ref("");
const copied = ref(false);
const copyError = ref("");
const origin = ref("");
onMounted(() => { origin.value = window.location.origin; });
const nameValid = computed(() => !agentName.value || /^[A-Za-z0-9._-]+$/.test(agentName.value));
const localOrigin = computed(() => {
  if (!origin.value) return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin.value).hostname);
});
const installCommand = computed(() => {
  // Quote the URL even though the optional name has a shell-safe allowlist.
  const server = "'" + origin.value.replaceAll("'", "'\\''") + "'";
  return `curl -fsSL https://github.com/nirjan-dev/servomon/releases/latest/download/install.sh | sh -s -- --server ${server}${agentName.value && nameValid.value ? ` --name ${agentName.value}` : ""}`;
});
watch([agentName, origin], () => { copied.value = false; });
async function copyCommand() {
  copyError.value = "";
  try {
    await navigator.clipboard.writeText(installCommand.value);
    copied.value = true;
  } catch {
    copyError.value = "Clipboard access is unavailable. Select and copy the command below.";
  }
}
const enrolledDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

const sortedAgents = computed(() => [...agents.value].sort((a, b) => a.system.localeCompare(b.system)));

function expiresIn(expiresAt: number): string {
  const minutes = Math.ceil((expiresAt - now.value) / 60_000);
  if (minutes <= 0) return "expiring";
  return minutes === 1 ? "expires in 1 min" : `expires in ${minutes} min`;
}

function lastSeen(lastSeenAt: number | null): string {
  if (lastSeenAt == null) return "No metrics yet";
  return `Last seen ${ageLabel(Math.max(0, now.value - lastSeenAt))}`;
}

async function act(code: string, action: (code: string) => Promise<void>) {
  busy.value = code;
  try {
    await action(code);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <UDashboardPanel id="agents">
    <template #header>
      <UDashboardNavbar title="Agents">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UModal v-model:open="addOpen" title="Add agent" description="Run this command on the Linux machine you want to monitor.">
            <UButton label="Add agent" icon="i-lucide-plus" />
            <template #body>
              <div class="space-y-4">
                <UFormField label="Agent name" hint="Optional" :error="nameValid ? undefined : 'Use only letters, numbers, dots, underscores, and hyphens.'">
                  <UInput v-model="agentName" placeholder="Defaults to the machine hostname" class="w-full" />
                </UFormField>
                <p class="text-sm text-muted">The target machine must be able to reach {{ origin }}.</p>
                <UAlert v-if="localOrigin" color="warning" title="Local-only URL" description="localhost and 127.0.0.1 point to the agent's own machine. Open this dashboard using a LAN address or public HTTPS URL before copying the command for another machine." />
                <pre class="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-elevated p-3 text-xs"><code>{{ installCommand }}</code></pre>
                <UButton :label="copied ? 'Copied' : 'Copy command'" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" :disabled="!nameValid" @click="copyCommand" />
                <p v-if="copyError" class="text-sm text-error">{{ copyError }}</p>
                <p class="text-sm text-muted">Then approve the pairing request that appears on this page. Check that its code and fingerprint match the agent's terminal.</p>
                <UButton :to="SETUP_GUIDE" target="_blank" color="neutral" variant="link" label="Manual installation guide" trailing-icon="i-lucide-arrow-up-right" />
              </div>
            </template>
          </UModal>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex max-w-4xl flex-col gap-8">
        <section v-if="pending.length" aria-labelledby="pending-heading">
          <div class="mb-3">
            <h2 id="pending-heading" class="text-sm font-semibold text-highlighted">Waiting for approval</h2>
            <p class="text-sm text-muted">Approve only if the code and fingerprint match the agent's terminal.</p>
          </div>
          <ul class="divide-y divide-default rounded-lg border border-default">
            <li v-for="req in pending" :key="req.code" class="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
              <div class="min-w-0 flex-1">
                <p class="font-mono text-[15px] font-semibold text-highlighted">{{ req.system }}</p>
                <dl class="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                  <div class="flex gap-1.5">
                    <dt>Code</dt>
                    <dd class="font-mono font-medium text-highlighted">{{ req.code }}</dd>
                  </div>
                  <div class="flex gap-1.5">
                    <dt>Fingerprint</dt>
                    <dd class="font-mono text-default">{{ req.fingerprint.slice(0, 19) }}…</dd>
                  </div>
                  <div>{{ expiresIn(req.expiresAt) }}</div>
                </dl>
              </div>
              <div class="flex gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  label="Deny"
                  :disabled="busy === req.code"
                  @click="act(req.code, deny)"
                />
                <UButton label="Approve" :loading="busy === req.code" @click="act(req.code, approve)" />
              </div>
            </li>
          </ul>
        </section>

        <section v-if="agents.length" aria-labelledby="enrolled-heading">
          <h2 id="enrolled-heading" class="mb-3 text-sm font-semibold text-highlighted">
            Enrolled <span class="font-normal text-muted tabular-nums">{{ agents.length }}</span>
          </h2>
          <ul class="divide-y divide-default rounded-lg border border-default">
            <li v-for="agent in sortedAgents" :key="agent.agentId" class="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <StatusDot :color="FRESHNESS_COLOR[freshnessOf(agent.lastSeenAt, now)]" />
                  <NuxtLink
                    :to="`/systems/${agent.system}`"
                    class="truncate font-mono text-[15px] font-semibold text-highlighted underline-offset-4 hover:underline"
                  >
                    {{ agent.system }}
                  </NuxtLink>
                </div>
                <p class="mt-0.5 flex flex-wrap gap-x-3 ps-4 text-xs text-muted">
                  <span>{{ lastSeen(agent.lastSeenAt) }}</span>
                  <span>Enrolled {{ enrolledDate.format(agent.createdAt) }}</span>
                  <span class="font-mono">{{ agent.fingerprint.slice(0, 19) }}…</span>
                </p>
              </div>
              <UButton color="neutral" variant="ghost" label="Remove" @click="removeAgent(agent)" />
            </li>
          </ul>
        </section>

        <UEmpty
          v-if="loaded && !agents.length && !pending.length"
          icon="i-lucide-key-round"
          title="No agents yet"
          description="Add agent gives you a one-line install command. Run it on the machine, then approve its pairing request here."
          :actions="[
            { label: 'Add agent', icon: 'i-lucide-plus', onClick: () => { addOpen = true } },
            { label: 'Setup guide', to: SETUP_GUIDE, target: '_blank', trailingIcon: 'i-lucide-arrow-up-right', color: 'neutral', variant: 'outline' },
          ]"
        />
        <USkeleton v-else-if="!loaded" class="h-40 w-full" />
      </div>
    </template>
  </UDashboardPanel>
</template>
