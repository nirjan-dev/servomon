import { timingSafeEqual } from "node:crypto";
import type { H3Event } from "h3";
import { findAgentByToken } from "./agentStore";
import type { H3Event } from "h3";

// S1: credential verification for the two principals.
// - Operator: HTTP Basic user from NUXT_BASIC_AUTH_USERS (dashboard user).
// - Agent: Bearer token issued at enrollment (one token per enrolled system).

export type OperatorPrincipal = { kind: "operator"; username: string };
export type AgentPrincipal = { kind: "agent"; agentId: string; system: string };
export type Principal = OperatorPrincipal | AgentPrincipal;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function parseBasicUsers(): { username: string; password: string }[] {
  const raw = process.env.NUXT_BASIC_AUTH_USERS ?? "";
  if (!raw.trim()) return [];
  return raw.split(",").flatMap((entry) => {
    const sep = entry.indexOf(":");
    if (sep <= 0) return [];
    const username = entry.slice(0, sep);
    const password = entry.slice(sep + 1);
    if (!username || !password) return [];
    return [{ username, password }];
  });
}

export function verifyOperator(header: string | undefined): OperatorPrincipal | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ", 2);
  if (scheme !== "Basic" || !encoded) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep <= 0) return null;
  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  for (const user of parseBasicUsers()) {
    if (safeEqual(user.username, username) && safeEqual(user.password, password)) {
      return { kind: "operator", username: user.username };
    }
  }
  return null;
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ", 2);
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export function authenticate(event: H3Event): Principal | null {
  const header = getHeader(event, "authorization");
  const operator = verifyOperator(header);
  if (operator) return operator;
  return null;
}

export async function authenticateAgent(token: string | null): Promise<AgentPrincipal | null> {
  if (!token) return null;
  const agent = await findAgentByToken(token);
  if (!agent) return null;
  return { kind: "agent", agentId: agent.agentId, system: agent.system };
}

export async function authenticateEither(event: H3Event): Promise<Principal | null> {
  const operator = authenticate(event);
  if (operator) return operator;
  return authenticateAgent(bearerToken(getHeader(event, "authorization")));
}
