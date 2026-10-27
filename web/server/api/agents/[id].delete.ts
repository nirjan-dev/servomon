import { removeAgent } from "../../utils/agentStore";
import { closeAgentSockets } from "../ws";

// S1: operator-only. Removes an enrolled agent: deletes its token and closes
// its live sockets immediately so revocation takes effect at once.
export default defineEventHandler(async (event) => {
  const agentId = getRouterParam(event, "id") ?? "";
  if (!agentId) {
    throw createError({ statusCode: 400, message: "Missing agent id" });
  }
  if (!(await removeAgent(agentId))) {
    throw createError({ statusCode: 404, statusMessage: "Agent not found" });
  }
  closeAgentSockets(agentId);
  return { status: "removed" as const };
});
