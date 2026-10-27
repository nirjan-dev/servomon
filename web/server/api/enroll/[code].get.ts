import { enrollPollRateLimited, getEnrollRequest, verifyCollectorSecret } from "../../utils/ticketStore";

// S1: public poll endpoint for a pending agent. 202 while waiting, 200 with
// the one-time token once approved, 410 once denied/expired/consumed.
//
// Status polls need only the public code, but token collection requires the
// device-only collector secret (Authorization: Bearer <secret>) submitted at
// request time. The response carries no-store so proxies must not cache the
// long-lived token.
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
  const header = getHeader(event, "authorization") ?? "";
  const secret = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!verifyCollectorSecret(secret, record.collectorHash)) {
    throw createError({ statusCode: 401, statusMessage: "Collection secret required" });
  }
  const token = record.token!;
  record.token = undefined;
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Pragma", "no-cache");
  return { status: "approved" as const, agentId: record.agentId, system: record.system, token };
});
