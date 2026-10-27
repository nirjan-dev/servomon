import { computed, onMounted, onUnmounted } from "vue";
import { useConfirmDialog } from "~/composables/useConfirmDialog";

export type PendingRequest = {
  code: string;
  system: string;
  fingerprint: string;
  expiresAt: number;
};

export type Agent = {
  agentId: string;
  system: string;
  fingerprint: string;
  createdAt: number;
  lastSeenAt: number | null;
};

type SystemConfigs = Record<string, { enableAlerts: boolean }>;

// One row per system name known from stored metrics or from an enrolled agent:
// an approved agent shows up before its first sample, and a system keeps its
// history after its agent is removed.
export type FleetEntry = {
  name: string;
  agent: Agent | null;
  hasData: boolean;
  alerts: boolean;
};

const POLL_MS = 15_000;

export function useFleet() {
  const systems = useState<string[]>("fleet:systems", () => []);
  const agents = useState<Agent[]>("fleet:agents", () => []);
  const pending = useState<PendingRequest[]>("fleet:pending", () => []);
  const configs = useState<SystemConfigs>("fleet:configs", () => ({}));
  const loaded = useState<boolean>("fleet:loaded", () => false);
  const toast = useToast();
  const confirm = useConfirmDialog();

  async function refreshSystems() {
    const [systemsRes, configsRes] = await Promise.allSettled([
      $fetch<string[]>("/api/sytems"),
      $fetch<SystemConfigs>("/api/system-configs"),
    ]);
    if (systemsRes.status === "fulfilled") systems.value = systemsRes.value ?? [];
    if (configsRes.status === "fulfilled") configs.value = configsRes.value ?? {};
  }

  async function refreshAgents() {
    const [pendingRes, agentsRes] = await Promise.allSettled([
      $fetch<PendingRequest[]>("/api/enroll/pending"),
      $fetch<Agent[]>("/api/agents"),
    ]);
    if (pendingRes.status === "fulfilled") pending.value = pendingRes.value ?? [];
    if (agentsRes.status === "fulfilled") agents.value = agentsRes.value ?? [];
    // Listing systems walks every stored sample key; reload it only when an
    // agent has reported for a system the list doesn't have yet.
    if (agents.value.some((a) => a.lastSeenAt && !systems.value.includes(a.system))) {
      await refreshSystems();
    }
  }

  async function refresh() {
    await refreshSystems();
    await refreshAgents();
    loaded.value = true;
  }

  const entries = computed<FleetEntry[]>(() => {
    const names = new Set([...systems.value, ...agents.value.map((a) => a.system)]);
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({
        name,
        agent: agents.value.find((a) => a.system === name) ?? null,
        hasData: systems.value.includes(name),
        // The server alerts unless a system explicitly opted out.
        alerts: configs.value[name]?.enableAlerts ?? true,
      }));
  });

  async function approve(code: string) {
    try {
      await $fetch("/api/enroll/approve", { method: "POST", body: { code } });
      toast.add({ title: "Agent approved", color: "success" });
    } catch (error) {
      console.log({ error });
      toast.add({ title: "Approval failed", color: "error" });
    } finally {
      await refreshAgents();
    }
  }

  async function deny(code: string) {
    try {
      await $fetch("/api/enroll/deny", { method: "POST", body: { code } });
    } catch (error) {
      console.log({ error });
      toast.add({ title: "Couldn't deny the request", color: "error" });
    } finally {
      await refreshAgents();
    }
  }

  async function removeAgent(agent: Agent) {
    const confirmed = await confirm({
      title: `Remove the agent for ${agent.system}?`,
      description: "Its token stops working immediately and its connection closes. Stored metrics are kept.",
      confirmLabel: "Remove agent",
    });
    if (!confirmed) return;
    try {
      await $fetch(`/api/agents/${encodeURIComponent(agent.agentId)}`, { method: "DELETE" });
      toast.add({ title: `Removed agent "${agent.system}"`, color: "success" });
    } catch (error) {
      console.log({ error });
      toast.add({ title: "Removal failed", color: "error" });
    } finally {
      await refreshAgents();
    }
  }

  async function deleteSystem(name: string): Promise<boolean> {
    const confirmed = await confirm({
      title: `Delete ${name}?`,
      description: "Deletes its stored metrics, alert setting and agent enrollment. This can't be undone.",
      confirmLabel: "Delete system",
    });
    if (!confirmed) return false;
    try {
      await $fetch(`/api/systems/${encodeURIComponent(name)}`, { method: "DELETE" });
      systems.value = systems.value.filter((s) => s !== name);
      toast.add({ title: `Deleted "${name}"`, color: "success" });
      return true;
    } catch (error) {
      console.log({ error });
      toast.add({ title: `Error deleting "${name}"`, color: "error" });
      return false;
    } finally {
      await refreshAgents();
    }
  }

  async function setAlerts(name: string, enableAlerts: boolean) {
    const previous = configs.value[name];
    configs.value = { ...configs.value, [name]: { enableAlerts } };
    try {
      await $fetch("/api/system-config", { method: "PUT", body: { system: name, enableAlerts } });
      toast.add({
        title: enableAlerts ? `Alerts on for ${name}` : `Alerts off for ${name}`,
        color: "success",
      });
    } catch (error) {
      console.log({ error });
      const rest = { ...configs.value };
      delete rest[name];
      configs.value = previous ? { ...rest, [name]: previous } : rest;
      toast.add({ title: "Couldn't update the alert setting", color: "error" });
    }
  }

  return {
    systems,
    agents,
    pending,
    loaded,
    entries,
    refresh,
    refreshAgents,
    approve,
    deny,
    removeAgent,
    deleteSystem,
    setAlerts,
  };
}

// Called once by the layout: one poller per tab, whatever page is open.
export function useFleetPolling() {
  const fleet = useFleet();
  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    void fleet.refresh();
    timer = setInterval(() => void fleet.refreshAgents(), POLL_MS);
  });
  onUnmounted(() => clearInterval(timer));
}
