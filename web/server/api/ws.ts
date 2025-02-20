type Peer = Parameters<
  NonNullable<Parameters<typeof defineWebSocketHandler>[0]["open"]>
>[0];

let serverPeers: Map<string, Peer | undefined> = new Map();
let clients: Peer[] = [];

export default defineWebSocketHandler({
  open(peer) {
    const url = new URL(peer.request?.url || "");
    const type = url.searchParams.get("type") ?? "client";
    const name = url.searchParams.get("name") ?? "unknown server";

    if (type === "server") {
      serverPeers.set(name, peer);
      console.log("adding server Peer", peer.id);
    } else {
      clients.push(peer);
    }

    console.log("peer ", peer.id, " connected");
  },

  message(peer, message) {
    const messageJSON = message.json<{ system?: string }>();
    console.log(peer.id, " sent message ", messageJSON);
    const serverPeerName = messageJSON.system;

    const serverPeer = serverPeers.get(serverPeerName ?? "");

    if (peer.id !== serverPeer?.id) {
      serverPeer?.send(JSON.stringify(message.json()));
    } else {
      clients.forEach((client) => client.send(JSON.stringify(message.json())));
    }
  },

  close(peer) {
    console.log(peer.id, " got disconnected");

    for (const [serverPeerName, serverPeer] of serverPeers) {
      if (peer.id === serverPeer?.id) {
        console.log("disconnecting server peer ", serverPeer.id);
        serverPeers.delete(serverPeerName);
      }
    }

    clients = clients.filter((c) => !c.id);
  },
});
