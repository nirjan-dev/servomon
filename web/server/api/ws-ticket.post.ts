import { authenticate, authenticateAgent, bearerToken } from "../utils/auth";
import { mintWsTicket, sweepWsTickets } from "../utils/ticketStore";
import { touchAgent } from "../utils/agentStore";

// S1: mints a single-use WS handshake ticket. Operator Basic → operator ticket;
// enrolled-agent Bearer → ticket bound to that agent's system. The middleware
// already enforced authentication; this resolves which principal it was.
export default defineEventHandler(async (event) => {
  sweepWsTickets();
  const operator = authenticate(event);
  if (operator) {
    const ticket = mintWsTicket({ role: "operator", operator: operator.username });
    return { ticket: ticket.ticket, role: "operator" as const };
  }
  const agent = await authenticateAgent(bearerToken(getHeader(event, "authorization")));
  if (agent) {
    await touchAgent(agent.agentId);
    const ticket = mintWsTicket({ role: "agent", agentId: agent.agentId, system: agent.system });
    return { ticket: ticket.ticket, role: "agent" as const, system: agent.system };
  }
  throw createError({ statusCode: 401, statusMessage: "Authentication required" });
});
