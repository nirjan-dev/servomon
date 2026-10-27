import { commandResultSchema } from "~/shared/schemas.zod";
import { z } from "zod";
import { getAgent } from "../utils/agentStore";
import { consumeWsTicket, type WsTicket } from "../utils/ticketStore";

// S1: authenticated command bus. Entry is gated by the `upgrade` hook — a
// single-use ticket from POST /api/ws-ticket (?ticket=...) must be consumed
// before the handshake completes, otherwise the connection is rejected with
// HTTP 401 and no socket resources are allocated.
// Roles are assigned at upgrade and fixed for the connection:
// - operators send validated commands to the owning agent only;
// - agents return results, which are fanned out to operators;
// - agents cannot command each other; every decision is audit-logged.

type Peer = Parameters<NonNullable<Parameters<typeof defineWebSocketHandler>[0]["open"]>>[0];

type Session =
  | { role: "operator"; operator: string }
  | { role: "agent"; agentId: string; system: string };

const sessions = new Map<string, Session>();
const agentPeers = new Map<string, Peer>();
const operatorPeers = new Set<Peer>();

const pendingTickets = new Map<string, WsTicket>();

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
  for (const [peerId, session] of sessions) {
    if (session.role !== "agent" || session.agentId !== agentId) continue;
    sessions.delete(peerId);
    const peer = agentPeers.get(session.system);
    if (peer?.id === peerId) agentPeers.delete(session.system);
    peer?.close(4403, "Agent removed");
  }
}

const commandMessageSchema = z.union([
  z.object({
    type: z.literal("process"),
    action: z.literal("kill"),
    pid: z.string().regex(/^[1-9][0-9]{0,6}$/),
    processName: z.string().max(256),
    system: z.string().min(1),
  }),
  z.object({
    type: z.literal("docker"),
    action: z.union([z.literal("stop"), z.literal("pause"), z.literal("unpause")]),
    containerName: z.string().min(1).max(256),
    system: z.string().min(1),
  }),
]);

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

export default defineWebSocketHandler({
  async upgrade(request) {
    const url = new URL(request.url);
    const ticket = url.searchParams.get("ticket");
    const type = url.searchParams.get("type") ?? "client";
    const name = url.searchParams.get("name") ?? "";
    if (!ticket) {
      return new Response("Authentication required", { status: 401 });
    }
    const consumed = consumeWsTicket(ticket);
    if (!consumed) {
      return new Response("Invalid or expired ticket", { status: 401 });
    }
    if (consumed.role === "operator") {
      if (type === "server") {
        return new Response("Operator ticket cannot open an agent connection", { status: 403 });
      }
      // Peer id is not available at upgrade time; stash the ticket keyed by
      // the raw ticket so open() can bind it once the peer exists.
      pendingTickets.set(ticket, consumed);
      return;
    }
    // Agent ticket: the system is bound server-side by the ticket, never from `name`.
    if (type !== "server") {
      return new Response("Agent ticket requires type=server", { status: 403 });
    }
    if (name !== consumed.system) {
      return new Response("Ticket is not valid for this system", { status: 403 });
    }
    const agent = await getAgent(consumed.agentId!);
    if (!agent) {
      return new Response("Agent removed", { status: 403 });
    }
    pendingTickets.set(ticket, consumed);
  },

  open(peer) {
    const url = new URL(peer.request?.url || "");
    const ticket = url.searchParams.get("ticket") ?? "";
    const consumed = pendingTickets.get(ticket);
    pendingTickets.delete(ticket);
    if (!consumed) {
      peer.close(4401, "Authentication required");
      return;
    }
    if (consumed.role === "operator") {
      sessions.set(peer.id, { role: "operator", operator: consumed.operator! });
      operatorPeers.add(peer);
      console.log("operator peer", peer.id, "connected");
      return;
    }
    // New connection for the same system replaces the old one (S2 keeps the
    // guard that a stale close cannot remove the new peer).
    const previous = agentPeers.get(consumed.system!);
    if (previous && previous.id !== peer.id) {
      sessions.delete(previous.id);
      try {
        previous.close(4409, "Replaced by a newer agent connection");
      } catch {
        // already gone
      }
    }
    sessions.set(peer.id, { role: "agent", agentId: consumed.agentId!, system: consumed.system! });
    agentPeers.set(consumed.system!, peer);
    console.log("agent peer", peer.id, "connected for system", consumed.system);
  },

  async message(peer, message) {
    const session = sessions.get(peer.id);
    if (!session) {
      peer.close(4401, "Authentication required");
      return;
    }
    let payload: unknown;
    try {
      payload = message.json();
    } catch {
      return;
    }

    if (session.role === "agent") {
      const parsed = commandResultSchema.safeParse(payload);
      if (parsed.error) return;
      const text = JSON.stringify(parsed.data);
      for (const operator of operatorPeers) {
        operator.send(text);
      }
      return;
    }

    // Operator → command. `system` selects the destination agent; the server
    // resolves it from live, authenticated agent sessions.
    const parsed = commandMessageSchema.safeParse(payload);
    if (parsed.error) {
      await audit({
        actor: session.operator,
        role: "operator",
        decision: "dropped",
        reason: "invalid command",
      });
      return;
    }
    const command = parsed.data;
    const target = agentPeers.get(command.system);
    const targetSession = target ? sessions.get(target.id) : undefined;
    if (!target || targetSession?.role !== "agent" || targetSession.system !== command.system) {
      await audit({
        actor: session.operator,
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
        actor: session.operator,
        role: "operator",
        decision: "dropped",
        reason: "unknown container for system",
        system: command.system,
        action: command.action,
        target: command.containerName,
      });
      return;
    }
    const targetName = command.type === "docker" ? command.containerName : `${command.processName} (pid ${command.pid})`;
    await audit({
      actor: session.operator,
      operator: session.operator,
      role: "operator",
      decision: "forwarded",
      system: command.system,
      action: command.action,
      target: command.type === "docker" ? command.containerName : command.pid,
      targetName,
    });
    target.send(JSON.stringify(command));
  },

  close(peer) {
    const session = sessions.get(peer.id);
    sessions.delete(peer.id);
    if (!session) return;
    if (session.role === "operator") {
      operatorPeers.delete(peer);
      console.log("operator peer", peer.id, "disconnected");
      return;
    }
    // Only the currently registered peer may unregister its system, so a
    // stale close from a replaced connection cannot drop the new one (S2).
    if (agentPeers.get(session.system)?.id === peer.id) {
      agentPeers.delete(session.system);
    }
    console.log("agent peer", peer.id, "for system", session.system, "disconnected");
  },
});
