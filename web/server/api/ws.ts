type Peer = Parameters<
  NonNullable<Parameters<typeof defineWebSocketHandler>[0]["open"]>
>[0];

let serverPeer: Peer | undefined;
let clients: Peer[] = [];

export default defineWebSocketHandler({
  open(peer) {
    const url = new URL(peer.request?.url || "");
    const type = url.searchParams.get("type") ?? "client";

    if (type === "server") {
      serverPeer = peer;

      console.log("adding server Peer", serverPeer?.id);
    } else {
      clients.push(peer);
    }

    console.log("peer ", peer.id, " connected");
  },

  message(peer, message) {
    console.log(peer.id, " sent message ", message.json());
    if (!serverPeer) {
      console.log("no server connected");
      return;
    }

    if (peer.id !== serverPeer.id) {
      serverPeer.send(JSON.stringify(message.json()));
    } else {
      clients.forEach((client) => client.send(JSON.stringify(message.json())));
    }
  },

  close(peer) {
    console.log(peer.id, " got disconnected");

    if (peer.id === serverPeer?.id) {
      console.log("disconnecting server peer ", serverPeer.id);
      serverPeer = undefined;
    }

    clients = clients.filter((c) => !c.id);
  },
});
