import { deleteSystemData } from "../../utils/metricsStore";
import { findAgentBySystem, removeAgent } from "../../utils/agentStore";
import { closeAgentSockets } from "../ws";

// Operator-only (enforced by middleware). Fully removes a monitored system:
// revokes its agent enrollment (if any), closes its live sockets, and deletes
// its metrics, alert config, and liveness state. Idempotent.
const SYSTEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export default defineEventHandler(async (event) => {
  const system = getRouterParam(event, "system") ?? "";
  if (!SYSTEM_PATTERN.test(system)) {
    throw createError({ statusCode: 400, message: "Invalid system name" });
  }
  const agent = await findAgentBySystem(system);
  if (agent) {
    await removeAgent(agent.agentId);
    closeAgentSockets(agent.agentId);
  }
  await deleteSystemData(system);
  return { status: "deleted" as const, system, agentRemoved: !!agent };
});
