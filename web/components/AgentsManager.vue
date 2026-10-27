<template>
  <div class="mb-8 space-y-4">
    <UCard v-if="pending.length">
      <template #header>
        <h2 class="font-semibold">Pending agents ({{ pending.length }})</h2>
        <p class="text-sm text-muted">
          New agents waiting for your approval. Verify the fingerprint matches
          what the agent printed, then approve.
        </p>
      </template>
      <div
        v-for="req in pending"
        :key="req.code"
        class="flex flex-wrap items-center gap-3 py-2 border-b border-default last:border-0"
      >
        <div class="flex-1 min-w-48">
          <p class="font-mono font-bold">{{ req.system }}</p>
          <p class="text-xs text-muted">
            code <span class="font-mono">{{ req.code }}</span> ·
            fingerprint
            <span class="font-mono">{{ req.fingerprint.slice(0, 19) }}…</span>
          </p>
        </div>
        <UButton color="success" @click="approve(req.code)">
          Approve
        </UButton>
        <UButton color="error" variant="soft" @click="deny(req.code)">
          Deny
        </UButton>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">Enrolled agents ({{ agents.length }})</h2>
          <UButton variant="ghost" @click="refresh">Refresh</UButton>
        </div>
      </template>
      <p v-if="!agents.length" class="text-sm text-muted">
        No agents enrolled yet. Run the agent without an
        <span class="font-mono">AGENT_TOKEN</span> and approve its pairing code
        here.
      </p>
      <div
        v-for="agent in agents"
        :key="agent.agentId"
        class="flex flex-wrap items-center gap-3 py-2 border-b border-default last:border-0"
      >
        <div class="flex-1 min-w-48">
          <NuxtLink :to="`/systems/${agent.system}`" class="font-mono font-bold underline">
            {{ agent.system }}
          </NuxtLink>
          <p class="text-xs text-muted">
            last seen {{ formatSeen(agent.lastSeenAt) }}
          </p>
        </div>
        <UButton
          color="error"
          variant="soft"
          @click="removeAgent(agent.agentId, agent.system)"
        >
          Remove
        </UButton>
      </div>
    </UCard>
  </div>
</template>

<script lang="ts" setup>
type PendingRequest = {
  code: string;
  system: string;
  fingerprint: string;
  expiresAt: number;
};

type Agent = {
  agentId: string;
  system: string;
  fingerprint: string;
  createdAt: number;
  lastSeenAt: number | null;
};

const pending = ref<PendingRequest[]>([]);
const agents = ref<Agent[]>([]);

function formatSeen(ts: number | null): string {
  if (!ts) return "never";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

async function refresh() {
  const [pendingRes, agentsRes] = await Promise.allSettled([
    $fetch<PendingRequest[]>("/api/enroll/pending"),
    $fetch<Agent[]>("/api/agents"),
  ]);
  if (pendingRes.status === "fulfilled") pending.value = pendingRes.value ?? [];
  if (agentsRes.status === "fulfilled") agents.value = agentsRes.value ?? [];
}

async function approve(code: string) {
  try {
    await $fetch("/api/enroll/approve", { method: "POST", body: { code } });
    useToast().add({ title: "Agent approved", color: "success" });
  } catch (error) {
    console.log({ error });
    useToast().add({ title: "Approval failed", color: "error" });
  } finally {
    await refresh();
  }
}

async function deny(code: string) {
  try {
    await $fetch("/api/enroll/deny", { method: "POST", body: { code } });
  } catch (error) {
    console.log({ error });
  } finally {
    await refresh();
  }
}

async function removeAgent(agentId: string, system: string) {
  if (!confirm(`Remove agent "${system}"? Its token stops working immediately.`)) return;
  try {
    await $fetch(`/api/agents/${agentId}`, { method: "DELETE" });
    useToast().add({ title: `Removed agent "${system}"`, color: "success" });
  } catch (error) {
    console.log({ error });
    useToast().add({ title: "Removal failed", color: "error" });
  } finally {
    await refresh();
  }
}

onMounted(() => {
  refresh();
  const timer = setInterval(refresh, 15000);
  onUnmounted(() => clearInterval(timer));
});
</script>
