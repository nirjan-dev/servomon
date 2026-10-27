import { z } from "zod";
import { deleteEnrollRequest, getEnrollRequest, setEnrollRequest } from "../../utils/ticketStore";
import { createAgentRecord, isSystemTaken, saveAgent } from "../../utils/agentStore";

// S1: operator-only. Approves a pending request: issues the agent token and
// persists the enrolled agent. Denial is a separate route.
const approveSchema = z.object({ code: z.string().min(1).max(32) });

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, approveSchema.safeParse);
  if (body.error) {
    throw createError({ statusCode: 400, message: "Invalid approval request", data: body.error.issues });
  }
  const record = getEnrollRequest(body.data.code);
  if (!record || record.status !== "pending" || record.expiresAt < Date.now()) {
    deleteEnrollRequest(body.data.code);
    throw createError({ statusCode: 410, statusMessage: "Enrollment request not available" });
  }
  if (await isSystemTaken(record.system)) {
    deleteEnrollRequest(body.data.code);
    throw createError({ statusCode: 409, statusMessage: "System name already enrolled" });
  }
  const { record: agent, token } = createAgentRecord(record.system, record.fingerprint);
  await saveAgent({ ...agent, agentId: record.agentId });
  record.status = "approved";
  record.token = token;
  setEnrollRequest(record);
  return { agentId: record.agentId, system: record.system };
});
