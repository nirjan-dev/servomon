# S2 case study: isolated disconnections and honest freshness

## The problem, in one screen

Before this change, every system card on the Servomon dashboard looked equally
healthy. A dead agent's card showed its last metrics with a "Last Update"
timestamp buried in a row of stats — nothing told the operator the data was
frozen. Worse, the command socket had a real bug: when *any* dashboard
disconnected, `clients.filter(c => !c.id)` wiped the entire client list,
because every peer has a truthy id. The remaining dashboards stayed connected
but silently stopped receiving command results. Buttons appeared to do nothing
until you refreshed the page.

Two failures, one theme: the UI couldn't tell you what it didn't know.

## What changed

**1. Disconnection isolation (server).** Sessions are now a `Map` keyed by peer
id (`web/server/api/ws.ts`). Closing a socket removes exactly that socket's
entry; a stale agent close can't unregister its replacement (the close guard
checks `agentPeers.get(system)?.id === peer.id` before deleting). This half of
S2 actually landed during the S1 rewrite — the session map replaced the broken
filter structurally. S2's job was to prove it with regression tests rather
than re-implement it.

**2. Freshness states (client).** A shared composable,
`web/composables/useFreshness.ts`, derives a state from the newest metric
timestamp in each SSE push:

| State | Meaning | Threshold |
|---|---|---|
| Live (green) | Data is current | newest sample < 60s old |
| Stale (amber) | Data shown but old | 60s – 3min |
| Offline (red) | Agent presumably down | > 3min, matching the server healthcheck |
| Unknown (gray) | No samples yet | — |

No new endpoint was needed: the SSE stream already delivers timestamps every
2 seconds, and a 10-second UI ticker recomputes ages. States recover the
instant fresh data arrives — there is no separate "reconnect" action to take.
Future timestamps (clock skew) count as live, never offline. The 60s stale
threshold is ~10 missed posts at the default agent rate: tolerant of one slow
interval without flapping.

Both the index cards and the system detail header show a dot + label
("Live · 7s ago", "Stale · 2m ago", "Offline · last update 4m ago").

**3. Stream leak fix (client).** The detail page never closed its `EventSource`
on navigation; it does now (the index page already did).

## What the tests prove — and don't

Two regression tests in `web/test/s1-auth.test.mjs`, section "S2:
disconnection isolation", run against the real production build:

- `disconnecting one dashboard does not stop the other's results`: two
  operator sockets + one agent; op1 commands, op1 disconnects, op2 commands
  and gets its result back. Also asserts each forward carries a fresh
  `commandId`. This is the exact scenario the old `filter` bug broke.
- `agent reconnect cannot be dropped by the stale connection`: old agent
  socket replaced by a new one for the same system; closing the stale socket
  must not unregister the new one; commands still route to the new socket.

What they don't prove: the freshness UI itself (client-side Vue, verified by
the screenshots and recording below, not by assertions), heartbeat/idle
timeouts (30s/10min — no clock injection), or behavior under real network
partitions (tests use clean closes, not half-open TCP).

## Evidence

- Recording (`assets/s2-stale-offline-recovery.webm`): a system aging from
  stale to offline in real time as its agent stays silent.
- Screenshot (`assets/s2-freshness-states.webp`): all three states at once —
  a live system with fresh data, a stale one, and an offline one.
- Suite: `pnpm test:s1` → 67/67 green (was 65 before S2).

## Identity and state ownership

The case study the backlog asked for boils down to this table:

| Question | Answer | Owner |
|---|---|---|
| Which dashboard is which? | Peer id, assigned at socket open | Server session map |
| Which agent serves a system? | The currently registered peer for that system name; replacement closes the old socket with 4409 | Server `agentPeers` map |
| Is this data current? | Newest sample timestamp vs. wall clock | Client composable (display only; server never trusts it) |
| Is this agent alive? | Fresh metrics within 3 min | Server healthcheck (alerts) + client freshness (display) |

The server owns connection identity; the client owns display freshness. Neither
trusts the other for its own decisions: commands route by server-side session,
and the UI never asks the server "is this stale?" when it already holds the
timestamps to answer itself.
