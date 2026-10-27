import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// S1: short-lived handshake credentials. Both stores are in-memory, which is
// safe only because the deployment runs a single machine
// (web/fly.toml: min_machines_running = max_machines_running = 1).
// A second machine would need a shared store.

export type WsTicket = {
  ticket: string;
  role: "operator" | "agent";
  operator?: string;
  agentId?: string;
  system?: string;
  expiresAt: number;
};

export type EnrollRequest = {
  code: string;
  agentId: string;
  system: string;
  fingerprint: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "approved" | "denied";
  token?: string; // plaintext, readable once by the collecting agent
  collectorHash?: string; // SHA-256 of the device-only collection secret
};

const tickets = new Map<string, WsTicket>();
const enrollments = new Map<string, EnrollRequest>();
const enrollHitsByIp = new Map<string, number[]>();

function ttlSeconds(): number {
  const raw = Number(process.env.NUXT_WS_TICKET_TTL_SECONDS ?? useRuntimeConfig().wsTicketTtlSeconds);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

export function mintWsTicket(input: { role: "operator"; operator: string } | { role: "agent"; agentId: string; system: string }): WsTicket {
  const ticket = randomBytes(32).toString("base64url");
  const record: WsTicket =
    input.role === "operator"
      ? { ticket, role: "operator", operator: input.operator, expiresAt: Date.now() + ttlSeconds() * 1000 }
      : { ticket, role: "agent", agentId: input.agentId, system: input.system, expiresAt: Date.now() + ttlSeconds() * 1000 };
  tickets.set(ticket, record);
  return record;
}

// Single-use: consuming deletes the ticket.
export function consumeWsTicket(ticket: string): WsTicket | null {
  const record = tickets.get(ticket);
  if (!record) return null;
  tickets.delete(ticket);
  if (record.expiresAt < Date.now()) return null;
  return record;
}

export function sweepWsTickets(): void {
  const now = Date.now();
  for (const [key, record] of tickets) {
    if (record.expiresAt < now) tickets.delete(key);
  }
}

const ENROLL_CODE_TTL_MS = 15 * 60 * 1000;
const ENROLL_RATE_WINDOW_MS = 60 * 1000;
const ENROLL_RATE_MAX = 30;

export function enrollRateLimited(ip: string): boolean {
  return bucketRateLimited(enrollHitsByIp, ip, ENROLL_RATE_WINDOW_MS, ENROLL_RATE_MAX);
}

const pollHitsByIp = new Map<string, number[]>();

export function enrollPollRateLimited(ip: string): boolean {
  return bucketRateLimited(pollHitsByIp, ip, ENROLL_RATE_WINDOW_MS, 60);
}

function bucketRateLimited(bucket: Map<string, number[]>, ip: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const hits = (bucket.get(ip) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  bucket.set(ip, hits);
  return hits.length > max;
}
export function findPendingByAgent(agentId: string): EnrollRequest | null {
  const now = Date.now();
  for (const [code, record] of enrollments) {
    if (record.expiresAt < now) {
      enrollments.delete(code);
      continue;
    }
    if (record.status === "pending" && record.agentId === agentId) return record;
  }
  return null;
}

export function findPendingBySystem(system: string): EnrollRequest | null {
  const now = Date.now();
  for (const [code, record] of enrollments) {
    if (record.expiresAt < now) {
      enrollments.delete(code);
      continue;
    }
    if (record.status === "pending" && record.system === system) return record;
  }
  return null;
}

export function hashCollectorSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifyCollectorSecret(secret: string | undefined, stored: string | undefined): boolean {
  if (!secret || !stored) return false;
  const candidate = Buffer.from(hashCollectorSecret(secret), "hex");
  const expected = Buffer.from(stored, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function mintEnrollCode(input: { agentId: string; system: string; fingerprint: string }): EnrollRequest {
  let code = "";
  do {
    code = randomBytes(6).toString("hex").toUpperCase();
  } while (enrollments.has(code));
  const now = Date.now();
  const record: EnrollRequest = {
    code,
    agentId: input.agentId,
    system: input.system,
    fingerprint: input.fingerprint,
    createdAt: now,
    expiresAt: now + ENROLL_CODE_TTL_MS,
    status: "pending",
  };
  enrollments.set(code, record);
  return record;
}

export function getEnrollRequest(code: string): EnrollRequest | null {
  return enrollments.get(code) ?? null;
}

export function setEnrollRequest(record: EnrollRequest): void {
  enrollments.set(record.code, record);
}

export function deleteEnrollRequest(code: string): void {
  enrollments.delete(code);
}

export function listPendingEnrollments(): EnrollRequest[] {
  const now = Date.now();
  const pending: EnrollRequest[] = [];
  for (const [code, record] of enrollments) {
    if (record.expiresAt < now) {
      enrollments.delete(code);
      continue;
    }
    if (record.status === "pending") pending.push(record);
  }
  return pending.sort((a, b) => a.createdAt - b.createdAt);
}

