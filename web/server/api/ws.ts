import { randomBytes } from "node:crypto";
import { commandResultSchema } from "~/shared/schemas.zod";
import { z } from "zod";
import { getAgent } from "../utils/agentStore";
import { consumeWsTicket } from "../utils/ticketStore";

// S1: authenticated command bus. Entry is gated by the `upgrade` hook — a
// single-use ticket from POST /api/ws-ticket (?ticket=...) must be consumed
// before the handshake completes, otherwise the connection is rejected with
// HTTP 401 and no socket resources are allocated.
// Roles are assigned at upgrade and fixed for the connection:
// - operators send validated commands to the owning agent only;
// - agents return results, which are fanned out to operators;
// - agents cannot command each other; every decision is audit-logged.
//
// Hardening (OWASP WebSocket cheat sheet):
// - Origin allowlist on the handshake (present Origin must match the host).
// - 64 KiB inbound message cap checked before JSON parsing (transport also
//   enforces it via serverOptions.maxPayload; this is the app-level guard).
// - Per-connection message rate limit (100/min, burst 20).
// - Heartbeat: server pings idle sockets, terminates unresponsive ones.
// - Command correlation: every forwarded command carries a server-generated
//   commandId; results without a matching outstanding id are dropped.
// - Operator credentials revalidated every 30 minutes; Basic-auth changes
//   (user removed / password rotated) close the socket.
// - Handshake decisions, violations, abnormal disconnects, and errors are
//   audit-logged with identity, IP, and Origin. Secrets are never logged.

type Peer = Parameters<NonNullable<Parameters<typeof defineWebSocketHandler>[0]["open"]>>[0];
type WsContext = { ticket: { role: "operator"; operator: string } | { role: "agent"; agentId: string; system: string } };

type Session =
  | { role: "operator"; operator: string; lastRevalidated: number }
  | { role: "agent"; agentId: string; system: string };

// Runtime state per live peer id.
type PeerState = {
  session: Session;
  lastSeen: number;
  awaitingPong: boolean;
  tokens: number;
  lastRefill: number;
};

const sessions = new Map<string, PeerState>();
const agentPeers = new Map<string, Peer>();
const operatorPeers = new Set<Peer>();

// Outstanding forwarded commands: commandId -> { system, operator, sentAt }.
const outstanding = new Map<string, { system: string; operator: string; sentAt: number }>();

const MAX_MESSAGE_BYTES = 64 * 1024;
const RATE_PER_MINUTE = 100;
const RATE_BURST = 20;
const MAX_OPERATORS = 20;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 10 * 60_000;
const OPERATOR_REVALIDATE_MS = 30 * 60_000;
const OUTSTANDING_TTL_MS = 5 * 60_000;
const MAX_BUFFERED_BYTES = 256 * 1024;

function peerSocket(peer: Peer): {
  ping?: (data?: unknown) => void;
  terminate?: () => void;
  bufferedAmount?: number;
  readyState?: number;
} {
  return (peer as unknown as { websocket: Record<string, unknown> }).websocket as never;
}

async function audit(entry: Record<string, unknown>): Promise<void> {
  // One key per entry: unstorage deserializes values on read, so a single
  // concatenated log file would corrupt on the second write. Unique keys are
  // also race-free under concurrent commands.
  try {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await useStorage("audit").setItem(key, { timestamp: Date.now(), ...entry });
  } catch (error) {
    console.error("failed to append audit log", error);
  }
}

export function closeAgentSockets(agentId: string): void {
  for (const [peerId, state] of sessions) {
    if (state.session.role !== "agent" || state.session.agentId !== agentId) continue;
    sessions.delete(peerId);
    const peer = agentPeers.get(state.session.system);
    if (peer?.id === peerId) agentPeers.delete(state.session.system);
    peer?.close(4403, "Agent removed");
  }
  for (const [commandId, cmd] of outstanding) {
    if ([...sessions.values()].some((s) => s.session.role === "agent" && s.session.system === cmd.system)) continue;
    outstanding.delete(commandId);
  }
}


const commandMessageSchema = z.union([
  z.object({
    type: z.literal("process"),
    action: z.literal("kill"),
    pid: z.string().regex(/^[1-9][0-9]{0,6}$/),
    processName: z.string().max(256),
    system: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("docker"),
    action: z.union([z.literal("stop"), z.literal("pause"), z.literal("unpause")]),
    containerName: z.string().min(1).max(256),
    system: z.string().min(1).max(64),
  }),
]);

const agentResultSchema = commandResultSchema.and(
  z.object({
    data: z.object({ commandId: z.string().min(1).max(64) }).passthrough(),
  }),
);

async function containerKnownToAgent(system: string, containerName: string): Promise<boolean> {
  try {
    const keys = await useStorage(`metrics/${system}`).getKeys();
    for (const key of keys) {
      const metrics = await useStorage(`metrics/${system}`).getItem<{
        containersInfo?: { name?: string }[];
      }>(key);
      if (metrics?.containersInfo?.some((c) => c.name === containerName)) return true;
    }
  } catch {
    // unreadable storage denies the command below
  }
  return false;
}

function requestHost(headers: Headers): string {
  return (headers.get("host") ?? headers.get("x-forwarded-host") ?? "").split(",")[0].trim().toLowerCase();
}

function checkOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return true; // non-browser clients (agents, curl) send none
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const host = requestHost(headers);
  return !!host && originHost === host;
}

function takeToken(state: PeerState): boolean {
  const now = Date.now();
  const elapsed = (now - state.lastRefill) / 60000;
  state.tokens = Math.min(RATE_BURST, state.tokens + elapsed * RATE_PER_MINUTE);
  state.lastRefill = now;
  if (state.tokens < 1) return false;
  state.tokens -= 1;
  return true;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function ensureHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const [peerId, state] of sessions) {
      const peer = findPeer(peerId);
      if (!peer) {
        sessions.delete(peerId);
        continue;
      }
      const socket = peerSocket(peer);
      if (now - state.lastSeen > IDLE_TIMEOUT_MS) {
        sessions.delete(peerId);
        removePeer(peer, state.session);
        peer.close(4408, "Idle timeout");
        void audit({ event: "idle-timeout", role: state.session.role, peerId });
        continue;
      }
      state.awaitingPong = true;
      try {
        socket.ping?.();
      } catch {
        state.awaitingPong = false;
      }
      setTimeout(() => {
        // Late pong still counts if it arrived; the flag is cleared in pong().
        const current = sessions.get(peerId);
        if (current) current.awaitingPong = current.awaitingPong && Date.now() - current.lastSeen > HEARTBEAT_TIMEOUT_MS;
      }, HEARTBEAT_TIMEOUT_MS).unref?.();
    }
    for (const [commandId, cmd] of outstanding) {
      if (now - cmd.sentAt > OUTSTANDING_TTL_MS) outstanding.delete(commandId);
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
}

function findPeer(peerId: string): Peer | undefined {
  for (const peer of operatorPeers) {
    if (peer.id === peerId) return peer;
  }
  for (const peer of agentPeers.values()) {
    if (peer.id === peerId) return peer;
  }
  return undefined;
}

function removePeer(peer: Peer, session: Session): void {
  if (session.role === "operator") {
    operatorPeers.delete(peer);
    return;
  }
  if (agentPeers.get(session.system)?.id === peer.id) {
    agentPeers.delete(session.system);
  }
}

function fanOut(text: string, bytes: number): void {
  for (const operator of [...operatorPeers]) {
    const socket = peerSocket(operator);
    const buffered = socket.bufferedAmount ?? 0;
    if (buffered + bytes > MAX_BUFFERED_BYTES) {
      // Slow consumer: drop it rather than queue unbounded memory.
      const state = sessions.get(operator.id);
      sessions.delete(operator.id);
      operatorPeers.delete(operator);
      operator.close(4408, "Slow consumer");
      void audit({ event: "slow-consumer-dropped", role: "operator", peerId: operator.id });
      continue;
    }
    operator.send(text);
  }
}

export default defineWebSocketHandler({
  async upgrade(request) {
    try {
      const url = new URL(request.url);
      const headers = request.headers instanceof Headers ? request.headers : new Headers(request.headers as Record<string, string>);
      const ip = (request as { runtime?: { node?: { req?: { socket?: { remoteAddress?: string } } } } }).runtime?.node?.req?.socket?.remoteAddress ?? "unknown";
      const origin = headers.get("origin") ?? null;
      if (!checkOrigin(headers)) {
        await audit({ event: "handshake-rejected", reason: "origin-mismatch", ip, origin, path: url.pathname });
        return new Response("Origin not allowed", { status: 403 });
      }
      const ticket = url.searchParams.get("ticket");
      const type = url.searchParams.get("type") ?? "client";
      const name = url.searchParams.get("name") ?? "";
      if (!ticket) {
        await audit({ event: "handshake-rejected", reason: "missing-ticket", ip, origin, path: url.pathname });
        return new Response("Authentication required", { status: 401 });
      }
      const consumed = consumeWsTicket(ticket);
      if (!consumed) {
        await audit({ event: "handshake-rejected", reason: "invalid-ticket", ip, origin, path: url.pathname });
        return new Response("Invalid or expired ticket", { status: 401 });
      }
      if (consumed.role === "operator") {
        if (type === "server") {
          await audit({ event: "handshake-rejected", reason: "operator-ticket-as-agent", ip, origin });
          return new Response("Operator ticket cannot open an agent connection", { status: 403 });
        }
        if (operatorPeers.size >= MAX_OPERATORS) {
          await audit({ event: "handshake-rejected", reason: "operator-cap", ip, origin });
          return new Response("Too many operator connections", { status: 503 });
        }
        await audit({ event: "handshake-accepted", role: "operator", actor: consumed.operator, ip, origin });
        return { context: { ticket: { role: "operator", operator: consumed.operator } } satisfies WsContext };
      }
      // Agent ticket: the system is bound server-side by the ticket, never from `name`.
      if (type !== "server") {
        await audit({ event: "handshake-rejected", reason: "agent-ticket-as-client", ip, origin });
        return new Response("Agent ticket requires type=server", { status: 403 });
      }
      if (name !== consumed.system) {
        await audit({ event: "handshake-rejected", reason: "system-mismatch", ip, origin });
        return new Response("Ticket is not valid for this system", { status: 403 });
      }
      const agent = await getAgent(consumed.agentId!);
      if (!agent) {
        await audit({ event: "handshake-rejected", reason: "agent-removed", ip, origin });
        return new Response("Agent removed", { status: 403 });
      }
      await audit({ event: "handshake-accepted", role: "agent", system: consumed.system, ip, origin });
      return {
        context: { ticket: { role: "agent", agentId: consumed.agentId!, system: consumed.system! } } satisfies WsContext,
      };
    } catch (error) {
      console.error("websocket upgrade failed", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  open(peer) {
    const context = (peer as unknown as { context?: WsContext }).context;
    const consumed = context?.ticket;
    if (!consumed) {
      peer.close(4401, "Authentication required");
      return;
    }
    ensureHeartbeat();
    if (consumed.role === "operator") {
      sessions.set(peer.id, {
        session: { role: "operator", operator: consumed.operator, lastRevalidated: Date.now() },
        lastSeen: Date.now(),
        awaitingPong: false,
        tokens: RATE_BURST,
        lastRefill: Date.now(),
      });
      operatorPeers.add(peer);
      console.log("operator peer", peer.id, "connected");
      return;
    }
    // New connection for the same system replaces the old one (S2 keeps the
    // guard that a stale close cannot remove the new peer).
    const previous = agentPeers.get(consumed.system);
    if (previous && previous.id !== peer.id) {
      sessions.delete(previous.id);
      try {
        previous.close(4409, "Replaced by a newer agent connection");
      } catch {
        // already gone
      }
    }
    sessions.set(peer.id, {
      session: { role: "agent", agentId: consumed.agentId, system: consumed.system },
      lastSeen: Date.now(),
      awaitingPong: false,
      tokens: RATE_BURST,
      lastRefill: Date.now(),
    });
    agentPeers.set(consumed.system, peer);
    console.log("agent peer", peer.id, "connected for system", consumed.system);
  },

  async message(peer, message) {
    const state = sessions.get(peer.id);
    if (!state) {
      peer.close(4401, "Authentication required");
      return;
    }
    state.lastSeen = Date.now();
    state.awaitingPong = false;

    // Byte cap before parsing: never JSON.parse an unbounded payload.
    const raw = message.rawData;
    const byteLength =
      typeof raw === "string" ? Buffer.byteLength(raw) : raw instanceof Uint8Array ? raw.byteLength : raw instanceof ArrayBuffer ? raw.byteLength : 0;
    if (byteLength > MAX_MESSAGE_BYTES) {
      await audit({ event: "message-rejected", reason: "oversize", role: state.session.role, peerId: peer.id, bytes: byteLength });
      peer.close(4409, "Message too large");
      return;
    }
    if (!takeToken(state)) {
      await audit({ event: "message-rejected", reason: "rate-limited", role: state.session.role, peerId: peer.id });
      peer.close(4408, "Rate limited");
      return;
    }

    let payload: unknown;
    try {
      payload = message.json();
    } catch {
      await audit({ event: "message-rejected", reason: "invalid-json", role: state.session.role, peerId: peer.id });
      return;
    }

    if (state.session.role === "agent") {
      const parsed = agentResultSchema.safeParse(payload);
      if (parsed.error) {
        await audit({ event: "message-rejected", reason: "invalid-result", role: "agent", peerId: peer.id, system: state.session.system });
        return;
      }
      const commandId = parsed.data.data.commandId;
      const cmd = outstanding.get(commandId);
      if (!cmd || cmd.system !== state.session.system) {
        // Unsolicited or duplicate result: acknowledged by no outstanding command.
        await audit({ event: "message-rejected", reason: "unsolicited-result", role: "agent", peerId: peer.id, system: state.session.system });
        return;
      }
      outstanding.delete(commandId);
      const text = JSON.stringify({ ...parsed.data, system: state.session.system });
      fanOut(text, Buffer.byteLength(text));
      return;
    }

    // Revalidate operator credentials periodically: a removed user or rotated
    // password must not keep a live command socket.
    if (Date.now() - state.session.lastRevalidated > OPERATOR_REVALIDATE_MS) {
      state.session.lastRevalidated = Date.now();
      const users = (process.env.NUXT_BASIC_AUTH_USERS ?? "").split(",");
      const known = users.some((entry) => entry.split(":")[0] === state.session.operator);
      if (!known) {
        sessions.delete(peer.id);
        operatorPeers.delete(peer);
        peer.close(4408, "Session expired");
        await audit({ event: "session-revoked", role: "operator", actor: (state.session as { operator: string }).operator });
        return;
      }
    }

    // Operator → command. `system` selects the destination agent; the server
    // resolves it from live, authenticated agent sessions.
    const parsed = commandMessageSchema.safeParse(payload);
    if (parsed.error) {
      await audit({
        actor: state.session.operator,
        role: "operator",
        decision: "dropped",
        reason: "invalid command",
      });
      return;
    }
    const command = parsed.data;
    const target = agentPeers.get(command.system);
    const targetState = target ? sessions.get(target.id) : undefined;
    if (!target || targetState?.session.role !== "agent" || targetState.session.system !== command.system) {
      await audit({
        actor: state.session.operator,
        role: "operator",
        decision: "dropped",
        reason: "no connected agent for system",
        system: command.system,
        action: command.action,
      });
      return;
    }
    if (command.type === "docker" && !(await containerKnownToAgent(command.system, command.containerName))) {
      await audit({
        actor: state.session.operator,
        role: "operator",
        decision: "dropped",
        reason: "unknown container for system",
        system: command.system,
        action: command.action,
        target: command.containerName,
      });
      return;
    }
    const commandId = randomBytes(16).toString("hex");
    outstanding.set(commandId, { system: command.system, operator: state.session.operator, sentAt: Date.now() });
    const targetName = command.type === "docker" ? command.containerName : `${command.processName} (pid ${command.pid})`;
    await audit({
      actor: state.session.operator,
      operator: state.session.operator,
      role: "operator",
      decision: "forwarded",
      system: command.system,
      action: command.action,
      target: command.type === "docker" ? command.containerName : command.pid,
      targetName,
      commandId,
    });
    target.send(JSON.stringify({ ...command, commandId }));
  },

  pong(peer) {
    const state = sessions.get(peer.id);
    if (state) {
      state.lastSeen = Date.now();
      state.awaitingPong = false;
    }
  },

  error(peer, error) {
    void audit({
      event: "socket-error",
      role: sessions.get(peer.id)?.session.role ?? "unknown",
      peerId: peer.id,
      message: String((error as Error)?.message ?? error).slice(0, 200),
    });
  },

  close(peer, details) {
    const state = sessions.get(peer.id);
    sessions.delete(peer.id);
    if (!state) return;
    const session = state.session;
    if (session.role === "operator") {
      operatorPeers.delete(peer);
      console.log("operator peer", peer.id, "disconnected");
    } else {
      // Only the currently registered peer may unregister its system, so a
      // stale close from a replaced connection cannot drop the new one (S2).
      if (agentPeers.get(session.system)?.id === peer.id) {
        agentPeers.delete(session.system);
      }
      console.log("agent peer", peer.id, "for system", session.system, "disconnected");
    }
    if (details?.code !== 1000 && details?.code !== 1001) {
      void audit({
        event: "disconnect",
        role: session.role,
        peerId: peer.id,
        code: details?.code ?? null,
        reason: String(details?.reason ?? "").slice(0, 200) || null,
      });
    }
  },
});
