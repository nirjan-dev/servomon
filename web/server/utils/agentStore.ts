import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// S1: enrolled agents live in the `agents` storage mount (./data/agents),
// keyed by agentId. Tokens are stored as scrypt hashes; the plaintext token
// is shown to the agent exactly once at enrollment/approval time.

export type AgentRecord = {
  agentId: string;
  system: string;
  tokenHash: string; // "saltHex:derivedHex"
  fingerprint: string;
  createdAt: number;
  lastSeenAt: number | null;
};

export type PublicAgent = Omit<AgentRecord, "tokenHash">;

function storage() {
  return useStorage<AgentRecord>("agents");
}

export function newAgentId(): string {
  return `agent-${randomBytes(8).toString("hex")}`;
}

export function newAgentToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(token, salt, 32);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

function verifyTokenHash(token: string, stored: string): boolean {
  const sep = stored.indexOf(":");
  if (sep <= 0) return false;
  const salt = Buffer.from(stored.slice(0, sep), "hex");
  const expected = Buffer.from(stored.slice(sep + 1), "hex");
  if (salt.length !== 16 || expected.length !== 32) return false;
  const derived = scryptSync(token, salt, 32);
  return timingSafeEqual(derived, expected);
}

export async function saveAgent(record: Omit<AgentRecord, "lastSeenAt">): Promise<void> {
  await storage().setItem(record.agentId, { ...record, lastSeenAt: null });
}

export async function getAgent(agentId: string): Promise<AgentRecord | null> {
  return (await storage().getItem(agentId)) ?? null;
}

export async function listAgents(): Promise<PublicAgent[]> {
  const keys = await storage().getKeys();
  const agents: PublicAgent[] = [];
  for (const key of keys) {
    const record = await storage().getItem(key);
    if (!record) continue;
    const { tokenHash: _tokenHash, ...pub } = record;
    agents.push(pub);
  }
  return agents.sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeAgent(agentId: string): Promise<boolean> {
  if (!(await storage().hasItem(agentId))) return false;
  await storage().removeItem(agentId);
  return true;
}

export async function findAgentBySystem(system: string): Promise<AgentRecord | null> {
  const keys = await storage().getKeys();
  for (const key of keys) {
    const record = await storage().getItem(key);
    if (record && record.system === system) return record;
  }
  return null;
}

export async function touchAgent(agentId: string): Promise<void> {
  const record = await storage().getItem(agentId);
  if (!record) return;
  await storage().setItem(agentId, { ...record, lastSeenAt: Date.now() });
}

export async function findAgentByToken(token: string): Promise<AgentRecord | null> {
  const keys = await storage().getKeys();
  for (const key of keys) {
    const record = await storage().getItem(key);
    if (record && verifyTokenHash(token, record.tokenHash)) {
      return record;
    }
  }
  return null;
}

export async function isSystemTaken(system: string): Promise<boolean> {
  const keys = await storage().getKeys();
  for (const key of keys) {
    const record = await storage().getItem(key);
    if (record && record.system === system) return true;
  }
  return false;
}

export function createAgentRecord(system: string, fingerprint: string): { record: Omit<AgentRecord, "lastSeenAt">; token: string } {
  const token = newAgentToken();
  return {
    record: {
      agentId: newAgentId(),
      system,
      tokenHash: hashToken(token),
      fingerprint,
      createdAt: Date.now(),
    },
    token,
  };
}
