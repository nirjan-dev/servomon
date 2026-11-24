import { assert, assertEquals } from "@std/assert";
import { startMetricsPusher } from "./metricsPusher.ts";
import { configureLogging } from "../../shared/lib/log.ts";

type Connection = { id: number; requests: number; dead: boolean };

// Minimal keep-alive HTTP/1.1 server whose existing connections can be made
// to silently stop answering, like a pooled connection dropped by a NAT.
function startServer() {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const connections: Connection[] = [];
  const sockets: Deno.Conn[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  async function serve(socket: Deno.Conn, connection: Connection) {
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(64 * 1024);
    let pending = "";
    try {
      while (true) {
        const read = await socket.read(buffer);
        if (read === null) return;
        pending += decoder.decode(buffer.subarray(0, read));
        while (true) {
          const headerEnd = pending.indexOf("\r\n\r\n");
          if (headerEnd === -1) break;
          const length = Number(/content-length:\s*(\d+)/i.exec(pending.slice(0, headerEnd))?.[1] ?? 0);
          if (pending.length < headerEnd + 4 + length) break;
          pending = pending.slice(headerEnd + 4 + length);
          connection.requests++;
          if (connection.dead) continue;
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          const body = '{"statusCode":201}';
          await socket.write(new TextEncoder().encode(
            `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\nconnection: keep-alive\r\n\r\n${body}`,
          ));
          inFlight--;
        }
      }
    } catch {
      // Client closed or reset the connection.
    }
  }

  (async () => {
    for await (const socket of listener) {
      const connection = { id: connections.length, requests: 0, dead: false };
      connections.push(connection);
      sockets.push(socket);
      void serve(socket, connection);
    }
  })().catch(() => {});

  return {
    url: `http://127.0.0.1:${(listener.addr as Deno.NetAddr).port}/api/metrics`,
    connections,
    killExisting() {
      for (const connection of connections) connection.dead = true;
    },
    answered: () => connections.reduce((sum, c) => sum + (c.dead ? 0 : c.requests), 0),
    maxInFlight: () => maxInFlight,
    close() {
      listener.close();
      for (const socket of sockets) {
        try {
          socket.close();
        } catch {
          // Already closed.
        }
      }
    },
  };
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 10);
    await promise;
  }
  return condition();
}

Deno.test("metrics pushes recover after a pooled connection silently dies", async () => {
  configureLogging("error");
  const server = startServer();
  const pusher = startMetricsPusher({
    url: server.url,
    token: "test",
    intervalMs: 50,
    timeoutMs: 300,
    collect: () => Promise.resolve({ ok: true }),
  });
  try {
    assert(await waitFor(() => server.answered() >= 1, 2000), "first push never arrived");
    const deadConnection = server.connections.length - 1;
    server.killExisting();

    // The stalled request must time out and the next push must dial a new
    // connection, well before a kernel TCP timeout would have fired.
    assert(
      await waitFor(() => server.connections.length > deadConnection + 1 && server.answered() >= 1, 2000),
      "pushes did not resume on a fresh connection",
    );
    assertEquals(server.connections[deadConnection].requests >= 2, true, "dead connection was not reused first");
    assertEquals(server.maxInFlight(), 1, "pushes overlapped");
  } finally {
    await pusher.stop();
    server.close();
  }
});
