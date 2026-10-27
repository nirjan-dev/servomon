import { enrollPollRateLimited, getEnrollRequest } from "../../utils/ticketStore";

// S1: public poll endpoint for a pending agent. 202 while waiting, 200 with
// the one-time token once approved, 410 once denied/expired/consumed.
export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? "unknown";
  if (enrollPollRateLimited(ip)) {
    throw createError({ statusCode: 429, statusMessage: "Too many enrollment polls" });
  }
  const code = getRouterParam(event, "code") ?? "";
  const record = getEnrollRequest(code);
  if (!record || record.expiresAt < Date.now()) {
    throw createError({ statusCode: 410, statusMessage: "Enrollment code expired" });
  }
  if (record.status === "denied" || (record.status === "approved" && !record.token)) {
    throw createError({ statusCode: 410, statusMessage: "Enrollment no longer available" });
  }
  if (record.status === "pending") {
    setResponseStatus(event, 202);
    return { status: "pending" as const, expiresAt: record.expiresAt };
  }
  const token = record.token!;
  record.token = undefined;
  return { status: "approved" as const, agentId: record.agentId, system: record.system, token };
});
