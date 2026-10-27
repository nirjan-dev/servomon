import { listAgents } from "../utils/agentStore";

// S1: operator-only. Lists enrolled agents for the dashboard.
export default defineEventHandler(async (_event) => {
  return listAgents();
});
