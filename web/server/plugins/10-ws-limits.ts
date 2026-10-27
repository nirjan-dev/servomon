import type { IncomingMessage } from "node:http";

// S1 hardening: transport-level limits for the WebSocket server.
//
// Nitro constructs the crossws node adapter as `wsAdapter(nitroApp.h3App.websocket)`
// (nitropack node-server preset), and the adapter spreads `options.serverOptions`
// into `new WebSocketServer({ noServer: true, ...serverOptions })`.
// This plugin mutates that cached object before the adapter is constructed.
//
// - maxPayload: 64 KiB inbound per message (OWASP starting point). The ws
//   default is 100 MiB; command/result messages are far below 64 KiB.
// - verifyClient: rejects upgrade paths other than /api/ws. Without this,
//   crossws accepts upgrades on ANY path with an empty hook set — no ticket
//   check, no app logic, sockets held forever. Runs after our upgrade hook,
//   so a ticket presented on a wrong path is already consumed (client re-mints).
export default defineNitroPlugin((nitroApp) => {
  // Unchecked cast: h3App.websocket is intentionally untyped; verified against
  // h3 websocketOptions() + the nitropack node-server preset, which passes
  // this object to wsAdapter() as adapter options.
  const h3App = nitroApp.h3App as unknown as { websocket: Record<string, unknown> };
  Object.assign(h3App.websocket, {
    serverOptions: {
      maxPayload: 64 * 1024,
      perMessageDeflate: false,
      verifyClient: ({ req }: { req: IncomingMessage }) => {
        const url = req.url ?? "";
        const pathname = url.split("?", 1)[0];
        return pathname === "/api/ws";
      },
    },
  });
});
