import { z } from "zod";
import { enrollRateLimited, findPendingByAgent, findPendingBySystem, hashCollectorSecret, mintEnrollCode, setEnrollRequest } from "../../utils/ticketStore";
import { getAgent, isSystemTaken } from "../../utils/agentStore";

// S1: public entry point for agent onboarding. An unenrolled agent POSTs its
// claimed system name and key fingerprint; the operator approves it from the
// dashboard and the agent polls GET /api/enroll/:code for its token.
// Rate-limited per IP; 409 if the name is taken or already pending.
//
// The caller also submits a device-only collector secret (never displayed).
// Collection requires proving knowledge of that secret, so knowing the
// public metadata and pairing code is not enough to take the token.
const requestSchema = z.object({
  system: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  agentId: z.string().min(1).max(128),
  fingerprint: z.string().min(8).max(128),
  collectorSecret: z.string().min(32).max(128),
});

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? "unknown";
  if (enrollRateLimited(ip)) {
    throw createError({ statusCode: 429, statusMessage: "Too many enrollment requests" });
  }
  const body = await readValidatedBody(event, requestSchema.safeParse);
  if (body.error) {
    throw createError({ statusCode: 400, message: "Invalid enrollment request", data: body.error.issues });
  }
  if (await isSystemTaken(body.data.system)) {
    throw createError({ statusCode: 409, statusMessage: "System name already enrolled" });
  }
  if (await getAgent(body.data.agentId)) {
    throw createError({ statusCode: 409, statusMessage: "Agent id already enrolled" });
  }
  const existing = findPendingByAgent(body.data.agentId);
  if (existing) {
    if (existing.fingerprint !== body.data.fingerprint || existing.system !== body.data.system) {
      throw createError({ statusCode: 409, statusMessage: "Enrollment already pending for this agent" });
    }
    // Re-requests prove nothing new and must not rotate the collector binding.
    if (!existing.collectorHash) {
      existing.collectorHash = hashCollectorSecret(body.data.collectorSecret);
      setEnrollRequest(existing);
    }
    return { code: existing.code, expiresAt: existing.expiresAt };
  }
  const systemPending = findPendingBySystem(body.data.system);
  if (systemPending) {
    throw createError({ statusCode: 409, statusMessage: "System name already pending enrollment" });
  }
  const record = mintEnrollCode(body.data);
  record.collectorHash = hashCollectorSecret(body.data.collectorSecret);
  setEnrollRequest(record);
  return { code: record.code, expiresAt: record.expiresAt };
});
