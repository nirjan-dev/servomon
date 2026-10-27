import { z } from "zod";
import { deleteEnrollRequest, getEnrollRequest, setEnrollRequest } from "../../utils/ticketStore";
import { createAgentRecord, getAgent, isSystemTaken, saveAgent } from "../../utils/agentStore";

// S1: operator-only. Approves a pending request: issues the agent token and
// persists the enrolled agent. Denial is a separate route.
//
// The name/id check and registry write run under a module-local promise
// chain, so concurrent approvals cannot issue the same system name twice or
// overwrite a registry entry for a reused agent id.
const approveSchema = z.object({ code: z.string().min(1).max(32) });

let approvalChain: Promise<void> = Promise.resolve();

function withApprovalLock<T>(work: () => Promise<T>): Promise<T> {
  const run = approvalChain.then(work);
  approvalChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, approveSchema.safeParse);
  if (body.error) {
    throw createError({ statusCode: 400, message: "Invalid approval request", data: body.error.issues });
  }
  return withApprovalLock(async () => {
    const record = getEnrollRequest(body.data.code);
    if (!record || record.status !== "pending" || record.expiresAt < Date.now()) {
      deleteEnrollRequest(body.data.code);
      throw createError({ statusCode: 410, statusMessage: "Enrollment request not available" });
    }
    if ((await isSystemTaken(record.system)) || (await getAgent(record.agentId))) {
      deleteEnrollRequest(body.data.code);
      throw createError({ statusCode: 409, statusMessage: "System name or agent id already enrolled" });
    }
    const { record: agent, token } = createAgentRecord(record.system, record.fingerprint);
    await saveAgent({ ...agent, agentId: record.agentId });
    record.status = "approved";
    record.token = token;
    setEnrollRequest(record);
    return { agentId: record.agentId, system: record.system };
  });
});
