// S1 regression suite — Servomon operator/control-plane authentication.
//
// Contract under test:
// - Every /api route denies anonymous callers (HTTP 401), except the public
//   enrollment request + poll endpoints.
// - Operator routes require HTTP Basic credentials from NUXT_BASIC_AUTH_USERS.
//   Unsafe operator methods additionally require a same-origin request
//   (matching Origin) or, without Origin, a JSON body (403 otherwise).
// - Agents onboard via POST /api/enroll/request (with a device-only collector
//   secret) → operator approves from the dashboard → agent polls
//   GET /api/enroll/:code, proving the collector secret to collect its token.
//   Pairing code alone never yields the token. Pending names are reserved;
//   approvals serialize so concurrent approves issue at most one enrollment.
// - POST /api/metrics requires the enrolled agent's Bearer token; body.name
//   must match the token's bound system (403 otherwise).
// - /api/ws requires a single-use ticket from POST /api/ws-ticket (?ticket=...).
//   Tickets bind role (operator|agent) and, for agents, the system name.
//   A present Origin must match the host (403 otherwise); upgrades to any
//   other path are rejected at the transport layer (HTTP 401).
// - Operators may send commands only to connected agents; commands carry a
//   server-generated commandId. Agents can only return results matching an
//   outstanding commandId; anything else is dropped. Messages over 64 KiB or
//   past the per-connection rate limit close the socket.
// - Decisions (forwarded/dropped), handshake accepts/rejects, violations, and
//   abnormal disconnects append to the audit store; secrets are never logged.
// - Removing an agent revokes its token and closes its sockets immediately.
//
// Modes:
// - Local (default): requires `pnpm build` first. Spawns the production server on
//   a random port with an isolated temp data dir and test credentials, runs the
//   full suite serially in file order (some tests depend on earlier ones), then
//   kills the server.
// - Remote: SERVOMON_TEST_URL=https://... runs the read-only anonymous subset
//   (safe against production; never sends state-changing requests).
//
// S1_DEBUG=1 streams server output.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const REMOTE = process.env.SERVOMON_TEST_URL?.replace(/\/$/, "");
const LOCAL = !REMOTE;
// `ws` client for tests needing custom handshake headers (Origin). Local only.
const RawWebSocket = LOCAL ? require("ws") : null;

const OPERATOR = { user: "testop", pass: "t3st-op-secret" };
const SYS_A = "sys-a";
const SYS_B = "sys-b";
const SYS_C = "sys-c";

const BASIC = "Basic " + Buffer.from(`${OPERATOR.user}:${OPERATOR.pass}`).toString("base64");
const BAD_BASIC = "Basic " + Buffer.from(`${OPERATOR.user}:wrong`).toString("base64");
const bearer = (t) => `Bearer ${t}`;

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..");

let base = REMOTE ?? "";
let child = null;
let childExit = null;
let dataDir = "";
const sockets = new Set();
const wsBase = () => base.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function track(ws) {
  sockets.add(ws);
  ws.addEventListener("close", () => sockets.delete(ws));
  ws.addEventListener("error", () => {});
  return ws;
}

function closeWs(ws) {
  try {
    ws.close();
  } catch {
    // already closed
  }
  sockets.delete(ws);
}

// Resolves { opened, ws }. Never rejects on server refusal.
function tryConnect(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const ws = track(new WebSocket(url));
    const timer = setTimeout(() => resolve({ opened: false, ws, reason: "timeout" }), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve({ opened: true, ws });
    });
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      resolve({ opened: false, ws, reason: "closed" });
    });
  });
}
// Raw connect via `ws` with custom handshake headers. Resolves
// { opened, status, ws }. Local only.
function tryConnectRaw(url, headers = {}, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const ws = new RawWebSocket(url, { headers });
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      resolve({ opened: false, status: null, ws, reason: "timeout" });
    }, timeoutMs);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve({ opened: true, status: 101, ws });
    });
    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      res.resume();
      resolve({ opened: false, status: res.statusCode, ws });
    });
    ws.on("error", () => {});
  });
}

function closeRaw(ws) {
  try { ws.terminate(); } catch {}
}

function collect(ws) {
  const messages = [];
  ws.addEventListener("message", (ev) => messages.push(String(ev.data)));
  return messages;
}

async function waitFor(cond, timeoutMs, message) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new assert.AssertionError({ message });
    await sleep(50);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitForBoot(url, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${url}/api/sytems`);
      await res.text().catch(() => {});
      return; // any HTTP status means the server is up
    } catch {
      if (childExit) throw new Error(`server exited during boot: ${JSON.stringify(childExit)}`);
      if (Date.now() - start > timeoutMs) throw new Error(`server did not boot within ${timeoutMs}ms`);
      await sleep(500);
    }
  }
}

function metricsFixture(name, timestamp = Date.now()) {
  return {
    timestamp,
    name,
    memory: { total: 8000, free: 3000, used: 5000, usedPercentage: 62 },
    cpu: { cores: 4, used: 12, available: 88 },
    processes: [{ app: "init", pid: 1, cpuPercent: "0.1", memoryPercent: "0.2" }],
    disk: [{ device: "/dev/sda1", mountPoint: "/", total: 100000, free: 60000, used: 40000, usedPercentage: 40 }],
    battery: { charge: 90 },
    containersInfo: [],
    networkInfo: {
      downloadDrops: "0",
      downloadErrors: "0",
      downloadPerSecond: "10k",
      uploadDrops: "0",
      uploadErrors: "0",
      uploadPerSecond: "5k",
    },
    systemInfo: { os: "linux", kernel: "6.8", device: "test-box" },
  };
}

const enrolledCreds = new Map();

async function enrollAgent(system, agentId) {
  const id = agentId ?? `test-${system}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const collectorSecret = `test-collector-secret-${id}`;
  const req = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system, agentId: id, fingerprint: `fp-${id}`, collectorSecret }),
  });
  assert.equal(req.status, 200, `enroll request for ${system} must be public`);
  const { code } = await req.json();
  const approve = await fetch(`${base}/api/enroll/approve`, {
    method: "POST",
    headers: { authorization: BASIC, "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  assert.equal(approve.status, 200, `operator must approve ${system}`);
  const poll = await fetch(`${base}/api/enroll/${code}`, {
    headers: { authorization: bearer(collectorSecret) },
  });
  assert.equal(poll.status, 200, `agent ${system} must collect its token`);
  return poll.json();
}
// Memoized enrollment for the suite's long-lived agents (sys-a, sys-b).
async function enrolled(system) {
  if (!enrolledCreds.has(system)) {
    enrolledCreds.set(system, await enrollAgent(system));
  }
  return enrolledCreds.get(system);
}

async function postTicket({ basic, token } = {}) {
  const headers = { "content-type": "application/json" };
  if (basic) headers.authorization = basic;
  if (token) headers.authorization = bearer(token);
  const res = await fetch(`${base}/api/ws-ticket`, { method: "POST", headers, body: "{}" });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON (e.g. pre-fix 404 page)
  }
  return { status: res.status, body };
}

async function postMetrics(token, name, timestamp = Date.now()) {
  const res = await fetch(`${base}/api/metrics`, {
    method: "POST",
    headers: { authorization: bearer(token), "content-type": "application/json" },
    body: JSON.stringify(metricsFixture(name, timestamp)),
  });
  await res.text().catch(() => {});
  return res.status;
}

before(async () => {
  if (!LOCAL) return;
  const entry = join(webDir, ".output", "server", "index.mjs");
  try {
    await access(entry);
  } catch {
    throw new Error(`built server not found at ${entry} — run 'pnpm build' first`);
  }
  dataDir = await mkdtemp(join(tmpdir(), "servomon-s1-"));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [entry], {
    cwd: dataDir,
    env: {
      ...process.env,
      PORT: String(port),
      NITRO_PORT: String(port),
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      NUXT_BASIC_AUTH_ENABLED: "true",
      NUXT_BASIC_AUTH_USERS: `${OPERATOR.user}:${OPERATOR.pass}`,
      NUXT_WS_TICKET_TTL_SECONDS: "2",
      SERVOMON_DATA_DIR: join(dataDir, "data"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (process.env.S1_DEBUG) {
    child.stdout.on("data", (d) => process.stdout.write(`[srv:out] ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`[srv:err] ${d}`));
  }
  child.on("exit", (code, signal) => {
    childExit = { code, signal };
  });
  await waitForBoot(base);
});

after(async () => {
  for (const ws of [...sockets]) closeWs(ws);
  if (child) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
      child.on("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
    child = null;
  }
});

// ---------- sanity: pages (green before and after the fix) ----------

test("pages still require login", async () => {
  const res = await fetch(`${base}/`);
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

// ---------- anonymous denial (red pre-fix) ----------

test("anon cannot list systems", async () => {
  const res = await fetch(`${base}/api/sytems`);
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("anon cannot read metrics", async () => {
  const res = await fetch(`${base}/api/metrics?system=${SYS_A}`);
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("anon cannot open metrics stream", async () => {
  const c = new AbortController();
  try {
    const res = await fetch(`${base}/api/metrics-stream?name=${SYS_A}`, { signal: c.signal });
    assert.equal(res.status, 401);
    await res.text().catch(() => {});
  } finally {
    c.abort();
  }
});

test("anon cannot read system config", async () => {
  const res = await fetch(`${base}/api/system-config?system=${SYS_A}`);
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("anon cannot list system configs", async () => {
  const res = await fetch(`${base}/api/system-configs`);
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("anon cannot update system config", { skip: !LOCAL && "state-changing: local only" }, async () => {
  const res = await fetch(`${base}/api/system-config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: SYS_A, enableAlerts: false }),
  });
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("anon cannot delete metrics", { skip: !LOCAL && "state-changing: local only" }, async () => {
  const res = await fetch(`${base}/api/metrics`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: SYS_A, timestamp: 1 }),
  });
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("anon cannot list push subscriptions", async () => {
  const res = await fetch(`${base}/api/subscriptions`);
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("anon cannot add push subscription", { skip: !LOCAL && "state-changing: local only" }, async () => {
  const res = await fetch(`${base}/api/subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: "https://example.com/poc" }),
  });
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("anon cannot check subscription", async () => {
  const res = await fetch(`${base}/api/check-subscription?endpoint=https://example.com/poc`);
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("wrong operator password is rejected on the API", async () => {
  const res = await fetch(`${base}/api/sytems`, { headers: { authorization: BAD_BASIC } });
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("anon cannot mint a WS ticket", async () => {
  const { status } = await postTicket({});
  assert.equal(status, 401);
});

test("anon WS handshake is rejected at HTTP layer", async () => {
  const res = await fetch(`${base}/api/ws`);
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("anon dashboard socket is rejected", async () => {
  const { opened, ws } = await tryConnect(`${wsBase()}/api/ws`);
  closeWs(ws);
  assert.equal(opened, false, "anonymous dashboard socket must not open");
});

test("anon agent socket is rejected", async () => {
  const { opened, ws } = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_A}`);
  closeWs(ws);
  assert.equal(opened, false, "anonymous agent socket must not open");
});

test("anon client cannot forward commands to an agent (S1 PoC)", async () => {
  const fake = `poc-fake-${Date.now()}`;
  const agent = await tryConnect(`${wsBase()}/api/ws?type=server&name=${fake}`, 4000);
  const agentMsgs = agent.opened ? collect(agent.ws) : [];
  const client = await tryConnect(`${wsBase()}/api/ws`, 4000);
  try {
    if (client.opened) {
      client.ws.send(
        JSON.stringify({ system: fake, type: "docker", action: "stop", containerName: "poc-nonexistent" }),
      );
      await sleep(1200);
    }
    assert.equal(client.opened, false, "anonymous client socket must not open");
    assert.equal(agent.opened, false, "anonymous agent socket must not open");
    assert.deepEqual(agentMsgs, [], "no command may reach the fake agent");
  } finally {
    closeWs(agent.ws);
    closeWs(client.ws);
  }
});

// ---------- legitimate paths ----------

test("operator can list systems", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const res = await fetch(`${base}/api/sytems`, { headers: { authorization: BASIC } });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
});

test("operator can update and read system config", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const put = await fetch(`${base}/api/system-config`, {
    method: "PUT",
    headers: { authorization: BASIC, "content-type": "application/json" },
    body: JSON.stringify({ system: SYS_A, enableAlerts: true }),
  });
  assert.equal(put.status, 200);
  await put.text().catch(() => {});
  const get = await fetch(`${base}/api/system-config?system=${SYS_A}`, {
    headers: { authorization: BASIC },
  });
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { enableAlerts: true });
});

test("agent posts metrics and operator reads them", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const ts = Date.now();
  assert.equal(await postMetrics((await enrolled(SYS_A)).token, SYS_A, ts), 200);
  const get = await fetch(`${base}/api/metrics?system=${SYS_A}`, { headers: { authorization: BASIC } });
  assert.equal(get.status, 200);
  const body = await get.json();
  assert.ok(body.metrics.some((m) => m.timestamp === ts && m.name === SYS_A));
});

test("agent B posts as itself (per-agent tokens)", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  assert.equal(await postMetrics((await enrolled(SYS_B)).token, SYS_B), 200);
});

test("agent A cannot post metrics as agent B", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  assert.equal(await postMetrics((await enrolled(SYS_A)).token, SYS_B), 403);
});

test("wrong agent token is rejected", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  assert.ok([401, 403].includes(await postMetrics("wrong-token", SYS_A)));
});

test("operator can delete a metric", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const ts = Date.now();
  assert.equal(await postMetrics((await enrolled(SYS_A)).token, SYS_A, ts), 200);
  const del = await fetch(`${base}/api/metrics`, {
    method: "DELETE",
    headers: { authorization: BASIC, "content-type": "application/json" },
    body: JSON.stringify({ system: SYS_A, timestamp: ts }),
  });
  assert.equal(del.status, 200);
  await del.text().catch(() => {});
  const get = await fetch(`${base}/api/metrics?system=${SYS_A}`, { headers: { authorization: BASIC } });
  assert.equal(get.status, 200);
  const body = await get.json();
  assert.ok(!body.metrics.some((m) => m.timestamp === ts));
});

test("operator can manage push subscriptions", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const sub = { endpoint: "https://example.com/push/test-endpoint", keys: { p256dh: "x", auth: "y" } };
  const post = await fetch(`${base}/api/subscriptions`, {
    method: "POST",
    headers: { authorization: BASIC, "content-type": "application/json" },
    body: JSON.stringify(sub),
  });
  assert.equal(post.status, 200);
  await post.text().catch(() => {});
  const get = await fetch(`${base}/api/subscriptions`, { headers: { authorization: BASIC } });
  assert.equal(get.status, 200);
  const body = await get.json();
  assert.ok(body.subs.some((s) => s.endpoint === sub.endpoint));
  const check = await fetch(`${base}/api/check-subscription?endpoint=${encodeURIComponent(sub.endpoint)}`, {
    headers: { authorization: BASIC },
  });
  assert.equal(check.status, 200);
  assert.equal((await check.json()).isSubscribed, true);
});

test("operator can open metrics stream", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const c = new AbortController();
  const timeout = setTimeout(() => c.abort(), 9000);
  try {
    const res = await fetch(`${base}/api/metrics-stream?name=${SYS_A}`, {
      headers: { authorization: BASIC },
      signal: c.signal,
    });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    try {
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
        const m = text.match(/data: (.*)/);
        if (m) {
          assert.ok(Array.isArray(JSON.parse(m[1])));
          break;
        }
        if (text.length > 100000) throw new Error("stream sent unexpected data");
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } finally {
    clearTimeout(timeout);
    c.abort();
  }
});

// ---------- WS tickets ----------

test("operator can mint a WS ticket", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const { status, body } = await postTicket({ basic: BASIC });
  assert.equal(status, 200);
  assert.equal(typeof body?.ticket, "string");
  assert.ok(body.ticket.length >= 32);
});

test("agent can mint a WS ticket bound to its system", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const { status, body } = await postTicket({ token: (await enrolled(SYS_A)).token });
  assert.equal(status, 200);
  assert.equal(body?.role, "agent");
  assert.equal(body?.system, SYS_A);
});

test("WS ticket with wrong operator password is rejected", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const { status } = await postTicket({ basic: BAD_BASIC });
  assert.equal(status, 401);
});

test("WS ticket with wrong agent token is rejected", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const { status } = await postTicket({ token: "nope" });
  assert.ok([401, 403].includes(status));
});

test("operator command reaches its agent and the result comes back", { skip: !LOCAL && "needs tickets: local only" }, async () => {
  const creds = await enrolled(SYS_A);
  // The agent must have reported the container, otherwise the server drops it as unknown.
  const fixture = metricsFixture(SYS_A);
  fixture.containersInfo = [{ memoryUsedPercent: "10", memoryUsed: "100MB", cpuUsed: "5", name: "poc-container", id: "abc", state: "running" }];
  const posted = await fetch(`${base}/api/metrics`, {
    method: "POST",
    headers: { authorization: bearer(creds.token), "content-type": "application/json" },
    body: JSON.stringify(fixture),
  });
  assert.equal(posted.status, 200);
  const agentTicket = (await postTicket({ token: creds.token })).body?.ticket;
  const opTicket = (await postTicket({ basic: BASIC })).body?.ticket;
  assert.ok(agentTicket && opTicket, "tickets required");
  const agent = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_A}&ticket=${agentTicket}`);
  assert.equal(agent.opened, true, "agent socket must open with valid ticket");
  const agentMsgs = collect(agent.ws);
  const op = await tryConnect(`${wsBase()}/api/ws?ticket=${opTicket}`);
  assert.equal(op.opened, true, "operator socket must open with valid ticket");
  const opMsgs = collect(op.ws);
  try {
    const cmd = { system: SYS_A, type: "docker", action: "stop", containerName: "poc-container" };
    op.ws.send(JSON.stringify(cmd));
    await waitFor(() => agentMsgs.length > 0, 3000, "agent never received the command");
    const forwarded = JSON.parse(agentMsgs[0]);
    assert.equal(typeof forwarded.commandId, "string");
    assert.ok(forwarded.commandId.length > 0);
    assert.deepEqual({ ...forwarded, commandId: undefined }, { ...cmd, commandId: undefined });
    const result = { type: "docker", data: { success: true, timestamp: Date.now(), containerName: "poc-container", commandId: forwarded.commandId } };
    agent.ws.send(JSON.stringify(result));
    await waitFor(() => opMsgs.length > 0, 3000, "operator never received the result");
    assert.deepEqual(JSON.parse(opMsgs[0]), { ...result, system: SYS_A });
  } finally {
    closeWs(agent.ws);
    closeWs(op.ws);
  }
});

test("command for an unreported container is dropped", { skip: !LOCAL && "needs tickets: local only" }, async () => {
  const creds = await enrolled(SYS_A);
  const agentTicket = (await postTicket({ token: creds.token })).body?.ticket;
  const opTicket = (await postTicket({ basic: BASIC })).body?.ticket;
  assert.ok(agentTicket && opTicket, "tickets required");
  const agent = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_A}&ticket=${agentTicket}`);
  assert.equal(agent.opened, true);
  const agentMsgs = collect(agent.ws);
  const op = await tryConnect(`${wsBase()}/api/ws?ticket=${opTicket}`);
  assert.equal(op.opened, true);
  try {
    op.ws.send(JSON.stringify({ system: SYS_A, type: "docker", action: "stop", containerName: "poc-never-reported" }));
    await sleep(1200);
    assert.deepEqual(agentMsgs, [], "unknown-container command must be dropped");
  } finally {
    closeWs(agent.ws);
    closeWs(op.ws);
  }
});

test("WS ticket is single-use", { skip: !LOCAL && "needs tickets: local only" }, async () => {
  const { body } = await postTicket({ basic: BASIC });
  assert.ok(body?.ticket, "ticket required");
  const first = await tryConnect(`${wsBase()}/api/ws?ticket=${body.ticket}`);
  assert.equal(first.opened, true);
  closeWs(first.ws);
  await sleep(200);
  const second = await tryConnect(`${wsBase()}/api/ws?ticket=${body.ticket}`);
  closeWs(second.ws);
  assert.equal(second.opened, false, "reused ticket must be rejected");
});

test("expired WS ticket is rejected", { skip: !LOCAL && "needs tickets: local only" }, async () => {
  const { body } = await postTicket({ basic: BASIC });
  assert.ok(body?.ticket, "ticket required");
  await sleep(2500); // TTL is 2s in this suite (NUXT_WS_TICKET_TTL_SECONDS)
  const conn = await tryConnect(`${wsBase()}/api/ws?ticket=${body.ticket}`);
  closeWs(conn.ws);
  assert.equal(conn.opened, false, "expired ticket must be rejected");
});

test("agent ticket cannot connect as another system", { skip: !LOCAL && "needs tickets: local only" }, async () => {
  const { body } = await postTicket({ token: (await enrolled(SYS_A)).token });
  assert.ok(body?.ticket, "ticket required");
  const conn = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_B}&ticket=${body.ticket}`);
  closeWs(conn.ws);
  assert.equal(conn.opened, false, "cross-system agent connect must be rejected");
});

test("operator ticket cannot connect as an agent", { skip: !LOCAL && "needs tickets: local only" }, async () => {
  const { body } = await postTicket({ basic: BASIC });
  assert.ok(body?.ticket, "ticket required");
  const conn = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_A}&ticket=${body.ticket}`);
  closeWs(conn.ws);
  assert.equal(conn.opened, false, "operator-as-agent connect must be rejected");
});

test("kill with invalid pid is not forwarded", { skip: !LOCAL && "needs tickets: local only" }, async () => {
  const agentTicket = (await postTicket({ token: (await enrolled(SYS_A)).token })).body?.ticket;
  const opTicket = (await postTicket({ basic: BASIC })).body?.ticket;
  assert.ok(agentTicket && opTicket, "tickets required");
  const agent = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_A}&ticket=${agentTicket}`);
  assert.equal(agent.opened, true);
  const agentMsgs = collect(agent.ws);
  const op = await tryConnect(`${wsBase()}/api/ws?ticket=${opTicket}`);
  assert.equal(op.opened, true);
  try {
    for (const pid of ["0", "-1", "abc", "12;rm"]) {
      op.ws.send(JSON.stringify({ system: SYS_A, type: "process", action: "kill", pid, processName: "poc" }));
    }
    await sleep(1500);
    assert.deepEqual(agentMsgs, [], `invalid kills must be dropped, agent got: ${JSON.stringify(agentMsgs)}`);
  } finally {
    closeWs(agent.ws);
    closeWs(op.ws);
  }
});

test("agent cannot send commands to another agent", { skip: !LOCAL && "needs tickets: local only" }, async () => {
  const tixA = (await postTicket({ token: (await enrolled(SYS_A)).token })).body?.ticket;
  const tixB = (await postTicket({ token: (await enrolled(SYS_B)).token })).body?.ticket;
  assert.ok(tixA && tixB, "tickets required");
  const a = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_A}&ticket=${tixA}`);
  const b = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_B}&ticket=${tixB}`);
  assert.equal(a.opened, true);
  assert.equal(b.opened, true);
  const bMsgs = collect(b.ws);
  try {
    a.ws.send(JSON.stringify({ system: SYS_B, type: "docker", action: "stop", containerName: "poc" }));
    await sleep(1200);
    assert.deepEqual(bMsgs, [], "agent-to-agent command must not be delivered");
  } finally {
    closeWs(a.ws);
    closeWs(b.ws);
  }
});

test("forwarded commands are audit-logged", { skip: !LOCAL && "needs tickets: local only" }, async () => {
  // Depends on "operator command reaches its agent" having run above (tests run in file order).
  const auditDir = join(dataDir, "data", "audit");
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(auditDir);
  const entries = [];
  for (const file of files) {
    entries.push(JSON.parse(await readFile(join(auditDir, file), "utf8")));
  }
  const entry = entries.find((e) => e.system === SYS_A && e.action === "stop" && e.decision === "forwarded");
  assert.ok(entry, `expected forwarded-command audit entry in ${auditDir}`);
  assert.equal(entry.operator, OPERATOR.user);
  assert.equal(entry.target, "poc-container");
  assert.ok(typeof entry.timestamp === "number" && entry.timestamp > 0);
});
// ---------- enrollment lifecycle ----------

test("anon cannot approve enrollments or list agents", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  for (const [method, path] of [
    ["GET", "/api/enroll/pending"],
    ["POST", "/api/enroll/approve"],
    ["POST", "/api/enroll/deny"],
    ["GET", "/api/agents"],
  ]) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify({ code: "NOPE" }) : undefined,
    });
    await res.text().catch(() => {});
    assert.equal(res.status, 401, `${method} ${path} must deny anonymous callers`);
  }
});

test("duplicate system name cannot enroll twice", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const dup = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: SYS_A, agentId: `dup-${Date.now()}`, fingerprint: "fp-dup-test", collectorSecret: "test-collector-secret-dup-000000000000" }),
  });
  await dup.text().catch(() => {});
  assert.equal(dup.status, 409);
});

test("denied enrollment yields no token", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const req = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: "sys-deny", agentId: `deny-${Date.now()}`, fingerprint: "fp-deny-test", collectorSecret: "test-collector-secret-deny-00000000000" }),
  });
  assert.equal(req.status, 200);
  const { code } = await req.json();
  const denyRes = await fetch(`${base}/api/enroll/deny`, {
    method: "POST",
    headers: { authorization: BASIC, "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  assert.equal(denyRes.status, 200);
  const poll = await fetch(`${base}/api/enroll/${code}`);
  await poll.text().catch(() => {});
  assert.equal(poll.status, 410);
});

test("removed agent loses token and socket immediately", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const creds = await enrollAgent(SYS_C);
  const ticket = (await postTicket({ token: creds.token })).body?.ticket;
  assert.ok(ticket, "ticket required");
  const agent = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_C}&ticket=${ticket}`);
  assert.equal(agent.opened, true, "agent socket must open before removal");
  let closed = false;
  agent.ws.addEventListener("close", () => {
    closed = true;
  });
  const del = await fetch(`${base}/api/agents/${creds.agentId}`, {
    method: "DELETE",
    headers: { authorization: BASIC },
  });
  assert.equal(del.status, 200);
  await waitFor(() => closed, 3000, "agent socket must close on removal");
  closeWs(agent.ws);
  assert.equal(await postMetrics(creds.token, SYS_C), 401);
  const { status } = await postTicket({ token: creds.token });
  assert.equal(status, 401);
});

test("operator can list enrolled agents", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const res = await fetch(`${base}/api/agents`, { headers: { authorization: BASIC } });
  assert.equal(res.status, 200);
  const agents = await res.json();
  const systems = agents.map((a) => a.system);
  assert.ok(systems.includes(SYS_A) && systems.includes(SYS_B), `expected sys-a and sys-b in ${JSON.stringify(systems)}`);
  assert.ok(!systems.includes(SYS_C), "removed agent must not be listed");
  assert.ok(agents.every((a) => !("tokenHash" in a) && !("token" in a)), "agent list must not leak secrets");
});
// ---------- system deletion ----------

test("anon cannot delete a system", async () => {
  const res = await fetch(`${base}/api/systems/${SYS_A}`, { method: "DELETE" });
  await res.text().catch(() => {});
  assert.equal(res.status, 401);
});

test("operator deleting a system purges metrics, config, and enrollment", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const target = "sys-purge";
  const creds = await enrollAgent(target);
  const ts = Date.now();
  assert.equal(await postMetrics(creds.token, target, ts), 200);
  const put = await fetch(`${base}/api/system-config`, {
    method: "PUT",
    headers: { authorization: BASIC, "content-type": "application/json" },
    body: JSON.stringify({ system: target, enableAlerts: true }),
  });
  assert.equal(put.status, 200);
  await put.text().catch(() => {});

  const del = await fetch(`${base}/api/systems/${target}`, {
    method: "DELETE",
    headers: { authorization: BASIC },
  });
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { status: "deleted", system: target, agentRemoved: true });

  const systems = await (await fetch(`${base}/api/sytems`, { headers: { authorization: BASIC } })).json();
  assert.ok(!systems.includes(target), "purged system must leave the systems list");
  const metrics = await (await fetch(`${base}/api/metrics?system=${target}`, { headers: { authorization: BASIC } })).json();
  assert.deepEqual(metrics.metrics, []);
  const configRes = await fetch(`${base}/api/system-config?system=${target}`, { headers: { authorization: BASIC } });
  assert.equal(configRes.status, 204, "purged system must have no config");
  assert.equal(await configRes.text(), "");
  const agents = await (await fetch(`${base}/api/agents`, { headers: { authorization: BASIC } })).json();
  assert.ok(!agents.some((a) => a.system === target), "purged system must lose its enrollment");
  assert.equal(await postMetrics(creds.token, target), 401);
  const { status } = await postTicket({ token: creds.token });
  assert.equal(status, 401);
});

test("deleting an unknown system is a clean no-op", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const del = await fetch(`${base}/api/systems/sys-never-existed`, {
    method: "DELETE",
    headers: { authorization: BASIC },
  });
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { status: "deleted", system: "sys-never-existed", agentRemoved: false });
});

test("system delete rejects traversal names", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  for (const name of ["a%2Fb", "%2E%2E"]) {
    const del = await fetch(`${base}/api/systems/${name}`, {
      method: "DELETE",
      headers: { authorization: BASIC },
    });
    const body = await del.text();
    // Either the route regex rejects it (400) or the router never matches and
    // the SPA fallback answers (200 HTML). Neither may report a deletion.
    assert.ok(!body.includes('"status":"deleted"'), `${name} must not purge`);
    if (del.status === 400) continue;
    assert.equal(del.status, 200);
    assert.ok(body.includes("<!DOCTYPE html>"), `${name} must fall through to the SPA shell`);
  }
});
// ---------- enrollment hardening ----------

test("operator approve rejects forged form posts (CSRF)", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const target = `sys-csrf-${Date.now()}`;
  const req = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: target, agentId: `csrf-${Date.now()}`, fingerprint: "fp-csrf-test", collectorSecret: "test-collector-secret-csrf-00000000000" }),
  });
  assert.equal(req.status, 200);
  const { code } = await req.json();
  // A cross-site HTML form can attach Basic credentials but can only send
  // urlencoded bodies; the JSON content-type rule must reject it.
  const forged = await fetch(`${base}/api/enroll/approve`, {
    method: "POST",
    headers: { authorization: BASIC, "content-type": "application/x-www-form-urlencoded" },
    body: `code=${code}`,
  });
  await forged.text().catch(() => {});
  assert.equal(forged.status, 403);
  // The request must still be pending, not approved.
  const pending = await (await fetch(`${base}/api/enroll/pending`, { headers: { authorization: BASIC } })).json();
  assert.ok(pending.some((p) => p.code === code), "forged approve must not consume the request");
});

test("operator approve rejects foreign Origin", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const res = await fetch(`${base}/api/enroll/approve`, {
    method: "POST",
    headers: { authorization: BASIC, "content-type": "application/json", origin: "https://evil.example.invalid" },
    body: JSON.stringify({ code: "NOPE" }),
  });
  await res.text().catch(() => {});
  assert.equal(res.status, 403);
});

test("operator unsafe methods reject foreign Origin", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  for (const [method, path, body] of [
    ["PUT", "/api/system-config", { system: SYS_A, enableAlerts: true }],
    ["DELETE", "/api/metrics", { system: SYS_A, timestamp: 1 }],
    ["POST", "/api/subscriptions", { endpoint: "https://example.com/poc" }],
    ["DELETE", `/api/systems/${SYS_A}`, undefined],
  ]) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: BASIC, "content-type": "application/json", origin: "https://evil.example.invalid" },
      body: body ? JSON.stringify(body) : undefined,
    });
    await res.text().catch(() => {});
    assert.equal(res.status, 403, `${method} ${path} must reject foreign Origin`);
  }
});

test("collection without the device secret is denied", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const target = `sys-nosecret-${Date.now()}`;
  const req = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: target, agentId: `nosecret-${Date.now()}`, fingerprint: "fp-nosecret-test", collectorSecret: "test-collector-secret-real-00000000000" }),
  });
  assert.equal(req.status, 200);
  const { code } = await req.json();
  const approve = await fetch(`${base}/api/enroll/approve`, {
    method: "POST",
    headers: { authorization: BASIC, "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  assert.equal(approve.status, 200);
  // Knowing the public pairing code alone must not yield the token.
  const anon = await fetch(`${base}/api/enroll/${code}`);
  await anon.text().catch(() => {});
  assert.equal(anon.status, 401);
  const wrong = await fetch(`${base}/api/enroll/${code}`, {
    headers: { authorization: bearer("test-collector-secret-wrong-0000000000") },
  });
  await wrong.text().catch(() => {});
  assert.equal(wrong.status, 401);
  // The legitimate collector still succeeds afterward.
  const legit = await fetch(`${base}/api/enroll/${code}`, {
    headers: { authorization: bearer("test-collector-secret-real-00000000000") },
  });
  assert.equal(legit.status, 200);
  assert.equal(legit.headers.get("cache-control"), "no-store");
  const body = await legit.json();
  assert.equal(body.system, target);
  assert.ok(typeof body.token === "string" && body.token.length > 0);
});

test("re-requesting metadata does not disclose collection", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const target = `sys-rereq-${Date.now()}`;
  const agentId = `rereq-${Date.now()}`;
  const first = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: target, agentId, fingerprint: "fp-rereq-test", collectorSecret: "test-collector-secret-first-0000000000" }),
  });
  assert.equal(first.status, 200);
  const { code } = await first.json();
  // Same public metadata, different secret: returns the same code but the
  // attacker's secret is NOT bound, so they still cannot collect.
  const replay = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: target, agentId, fingerprint: "fp-rereq-test", collectorSecret: "test-collector-secret-evil-000000000000" }),
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).code, code);
  const approve = await fetch(`${base}/api/enroll/approve`, {
    method: "POST",
    headers: { authorization: BASIC, "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  assert.equal(approve.status, 200);
  const evil = await fetch(`${base}/api/enroll/${code}`, {
    headers: { authorization: bearer("test-collector-secret-evil-000000000000") },
  });
  await evil.text().catch(() => {});
  assert.equal(evil.status, 401);
  const legit = await fetch(`${base}/api/enroll/${code}`, {
    headers: { authorization: bearer("test-collector-secret-first-0000000000") },
  });
  assert.equal(legit.status, 200);
  await legit.text().catch(() => {});
});

test("duplicate pending system name is rejected", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const target = `sys-penddup-${Date.now()}`;
  const first = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: target, agentId: `penddup-a-${Date.now()}`, fingerprint: "fp-penddup-a", collectorSecret: "test-collector-secret-pend-a-00000000" }),
  });
  assert.equal(first.status, 200);
  const second = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: target, agentId: `penddup-b-${Date.now()}`, fingerprint: "fp-penddup-b", collectorSecret: "test-collector-secret-pend-b-00000000" }),
  });
  await second.text().catch(() => {});
  assert.equal(second.status, 409);
});

test("enrolled agent id cannot be reused", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const existing = await enrolled(SYS_A);
  const req = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: `sys-idreuse-${Date.now()}`, agentId: existing.agentId, fingerprint: "fp-idreuse-test", collectorSecret: "test-collector-secret-reuse-000000000" }),
  });
  await req.text().catch(() => {});
  assert.equal(req.status, 409);
});

test("concurrent approvals issue at most one enrollment", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const req = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: `sys-race-${Date.now()}`, agentId: `race-${Date.now()}`, fingerprint: "fp-race-test", collectorSecret: "test-collector-secret-race-00000000000" }),
  });
  assert.equal(req.status, 200);
  const { code } = await req.json();
  const approve = () =>
    fetch(`${base}/api/enroll/approve`, {
      method: "POST",
      headers: { authorization: BASIC, "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
  const [a1, a2] = await Promise.all([approve(), approve()]);
  const statuses = [a1.status, a2.status].sort();
  await a1.text().catch(() => {});
  await a2.text().catch(() => {});
  assert.deepEqual(statuses, [200, 410]);
});
// ---------- websocket hardening ----------

test("upgrade on non-command paths is rejected", { skip: !LOCAL && "local only" }, async () => {
  for (const path of ["/no-such-socket", "/", "/api/other-socket"]) {
    const conn = await tryConnectRaw(`${wsBase()}${path}`);
    closeRaw(conn.ws);
    assert.equal(conn.opened, false, `${path} must not open a socket`);
    assert.ok(conn.status === 401 || conn.status === 404, `${path} got HTTP ${conn.status}`);
  }
});

test("handshake with foreign Origin is rejected", { skip: !LOCAL && "local only" }, async () => {
  const { body } = await postTicket({ basic: BASIC });
  assert.ok(body?.ticket, "ticket required");
  const conn = await tryConnectRaw(`${wsBase()}/api/ws?ticket=${body.ticket}`, {
    Origin: "https://evil.example.invalid",
  });
  closeRaw(conn.ws);
  assert.equal(conn.opened, false, "foreign Origin must not open");
  assert.equal(conn.status, 403);
});

test("handshake with matching Origin is accepted", { skip: !LOCAL && "local only" }, async () => {
  const { body } = await postTicket({ basic: BASIC });
  assert.ok(body?.ticket, "ticket required");
  const origin = base.replace("http://", "http://");
  const conn = await tryConnectRaw(`${wsBase()}/api/ws?ticket=${body.ticket}`, { Origin: origin });
  closeRaw(conn.ws);
  assert.equal(conn.opened, true, "matching Origin must open");
});

test("handshake without Origin is accepted (non-browser clients)", { skip: !LOCAL && "local only" }, async () => {
  const creds = await enrolled(SYS_A);
  const ticket = (await postTicket({ token: creds.token })).body?.ticket;
  assert.ok(ticket, "ticket required");
  const conn = await tryConnectRaw(`${wsBase()}/api/ws?type=server&name=${SYS_A}&ticket=${ticket}`);
  closeRaw(conn.ws);
  assert.equal(conn.opened, true, "agent without Origin must open");
});

test("oversize message is rejected and socket closed", { skip: !LOCAL && "local only" }, async () => {
  const opTicket = (await postTicket({ basic: BASIC })).body?.ticket;
  assert.ok(opTicket, "ticket required");
  const ws = new RawWebSocket(`${wsBase()}/api/ws?ticket=${opTicket}`);
  const closed = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.on("error", () => {});
  });
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  ws.send(JSON.stringify({ system: SYS_A, type: "docker", action: "stop", containerName: "x".repeat(70 * 1024) }));
  const code = await closed;
  closeRaw(ws);
  assert.ok(code === 4409 || code === 1009, `oversize message must close the socket, got ${code}`);
});

test("message flood is rate limited", { skip: !LOCAL && "local only" }, async () => {
  const opTicket = (await postTicket({ basic: BASIC })).body?.ticket;
  assert.ok(opTicket, "ticket required");
  const ws = new RawWebSocket(`${wsBase()}/api/ws?ticket=${opTicket}`);
  const closed = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.on("error", () => {});
  });
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  for (let i = 0; i < 60; i++) {
    ws.send(JSON.stringify({ ping: i }));
    await sleep(20);
  }
  const code = await closed;
  closeRaw(ws);
  assert.equal(code, 4408, `flood must close the socket with 4408, got ${code}`);
});

test("unsolicited agent result is dropped", { skip: !LOCAL && "local only" }, async () => {
  const creds = await enrolled(SYS_A);
  const agentTicket = (await postTicket({ token: creds.token })).body?.ticket;
  const opTicket = (await postTicket({ basic: BASIC })).body?.ticket;
  assert.ok(agentTicket && opTicket, "tickets required");
  const agent = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_A}&ticket=${agentTicket}`);
  assert.equal(agent.opened, true);
  const op = await tryConnect(`${wsBase()}/api/ws?ticket=${opTicket}`);
  assert.equal(op.opened, true);
  const opMsgs = collect(op.ws);
  try {
    agent.ws.send(JSON.stringify({ type: "docker", data: { success: true, timestamp: Date.now(), containerName: "poc-container", commandId: "never-issued-by-server" } }));
    await sleep(1200);
    assert.deepEqual(opMsgs, [], "unsolicited result must not fan out");
  } finally {
    closeWs(agent.ws);
    closeWs(op.ws);
  }
});

test("duplicate result delivery is dropped", { skip: !LOCAL && "local only" }, async () => {
  const creds = await enrolled(SYS_A);
  const fixture = metricsFixture(SYS_A);
  fixture.containersInfo = [{ memoryUsedPercent: "10", memoryUsed: "100MB", cpuUsed: "5", name: "poc-container", id: "abc", state: "running" }];
  const posted = await fetch(`${base}/api/metrics`, {
    method: "POST",
    headers: { authorization: bearer(creds.token), "content-type": "application/json" },
    body: JSON.stringify(fixture),
  });
  assert.equal(posted.status, 200);
  const agentTicket = (await postTicket({ token: creds.token })).body?.ticket;
  const opTicket = (await postTicket({ basic: BASIC })).body?.ticket;
  assert.ok(agentTicket && opTicket, "tickets required");
  const agent = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_A}&ticket=${agentTicket}`);
  assert.equal(agent.opened, true);
  const agentMsgs = collect(agent.ws);
  const op = await tryConnect(`${wsBase()}/api/ws?ticket=${opTicket}`);
  assert.equal(op.opened, true);
  const opMsgs = collect(op.ws);
  try {
    op.ws.send(JSON.stringify({ system: SYS_A, type: "docker", action: "stop", containerName: "poc-container" }));
    await waitFor(() => agentMsgs.length > 0, 3000, "agent never received the command");
    const commandId = JSON.parse(agentMsgs[0]).commandId;
    assert.ok(commandId, "forwarded command must carry commandId");
    const result = JSON.stringify({ type: "docker", data: { success: true, timestamp: Date.now(), containerName: "poc-container", commandId } });
    agent.ws.send(result);
    await waitFor(() => opMsgs.length > 0, 3000, "operator never received the result");
    agent.ws.send(result);
    await sleep(1000);
    assert.equal(opMsgs.length, 1, "duplicate result must not fan out twice");
  } finally {
    closeWs(agent.ws);
    closeWs(op.ws);
  }
});

test("handshake decisions are audit-logged without secrets", { skip: !LOCAL && "local only" }, async () => {
  const { body } = await postTicket({ basic: BASIC });
  assert.ok(body?.ticket, "ticket required");
  const ok = await tryConnectRaw(`${wsBase()}/api/ws?ticket=${body.ticket}`, { Origin: base });
  closeRaw(ok.ws);
  assert.equal(ok.opened, true);
  const bad = await tryConnectRaw(`${wsBase()}/api/ws`);
  closeRaw(bad.ws);
  assert.equal(bad.opened, false);
  const { readdir } = await import("node:fs/promises");
  const auditDir = join(dataDir, "data", "audit");
  const files = await readdir(auditDir);
  const entries = [];
  for (const file of files) {
    entries.push(JSON.parse(await readFile(join(auditDir, file), "utf8")));
  }
  const accepted = entries.filter((e) => e.event === "handshake-accepted");
  const rejected = entries.filter((e) => e.event === "handshake-rejected");
  assert.ok(accepted.length > 0, "expected handshake-accepted audit entries");
  assert.ok(rejected.length > 0, "expected handshake-rejected audit entries");
  assert.ok(accepted.every((e) => e.role && ("ip" in e)), "accepted entries need role + ip");
  assert.ok(rejected.every((e) => e.reason && ("ip" in e)), "rejected entries need reason + ip");
  const serialized = JSON.stringify(entries);
  assert.ok(!serialized.includes(body.ticket), "audit log must not contain ticket values");
  assert.ok(!serialized.includes(OPERATOR.pass), "audit log must not contain passwords");
});
// ---------- S2: disconnection isolation ----------

test("disconnecting one dashboard does not stop the other's results", { skip: !LOCAL && "local only" }, async () => {
  const creds = await enrolled(SYS_A);
  const fixture = metricsFixture(SYS_A);
  fixture.containersInfo = [{ memoryUsedPercent: "10", memoryUsed: "100MB", cpuUsed: "5", name: "poc-container", id: "abc", state: "running" }];
  const posted = await fetch(`${base}/api/metrics`, {
    method: "POST",
    headers: { authorization: bearer(creds.token), "content-type": "application/json" },
    body: JSON.stringify(fixture),
  });
  assert.equal(posted.status, 200);
  const agentTicket = (await postTicket({ token: creds.token })).body?.ticket;
  const opTicket1 = (await postTicket({ basic: BASIC })).body?.ticket;
  const opTicket2 = (await postTicket({ basic: BASIC })).body?.ticket;
  assert.ok(agentTicket && opTicket1 && opTicket2, "tickets required");
  const agent = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_A}&ticket=${agentTicket}`);
  assert.equal(agent.opened, true);
  const agentMsgs = collect(agent.ws);
  const op1 = await tryConnect(`${wsBase()}/api/ws?ticket=${opTicket1}`);
  assert.equal(op1.opened, true);
  const op2 = await tryConnect(`${wsBase()}/api/ws?ticket=${opTicket2}`);
  assert.equal(op2.opened, true);
  const op2Msgs = collect(op2.ws);
  try {
    // First command reaches the agent while both dashboards are connected.
    op1.ws.send(JSON.stringify({ system: SYS_A, type: "docker", action: "stop", containerName: "poc-container" }));
    await waitFor(() => agentMsgs.length > 0, 3000, "agent never received the first command");
    const commandId1 = JSON.parse(agentMsgs[0]).commandId;
    assert.ok(commandId1, "forwarded command must carry commandId");
    // Disconnect the first dashboard. The pre-S2 bug wiped the whole client
    // list here, silently cutting off every other dashboard.
    closeWs(op1.ws);
    await sleep(500);
    // Second command from the surviving dashboard: agent gets it, result
    // comes back to the survivor.
    op2.ws.send(JSON.stringify({ system: SYS_A, type: "docker", action: "stop", containerName: "poc-container" }));
    await waitFor(() => agentMsgs.length > 1, 3000, "agent never received the second command");
    const commandId2 = JSON.parse(agentMsgs[1]).commandId;
    assert.ok(commandId2 && commandId2 !== commandId1, "each forward must carry a fresh commandId");
    agent.ws.send(JSON.stringify({ type: "docker", data: { success: true, timestamp: Date.now(), containerName: "poc-container", commandId: commandId2 } }));
    await waitFor(() => op2Msgs.length > 0, 3000, "surviving dashboard never received the result");
    assert.equal(JSON.parse(op2Msgs[0]).data.commandId, commandId2);
  } finally {
    closeWs(agent.ws);
    closeWs(op1.ws);
    closeWs(op2.ws);
  }
});

test("agent reconnect cannot be dropped by the stale connection", { skip: !LOCAL && "local only" }, async () => {
  const creds = await enrolled(SYS_B);
  const fixture = metricsFixture(SYS_B);
  fixture.containersInfo = [{ memoryUsedPercent: "10", memoryUsed: "100MB", cpuUsed: "5", name: "poc-container", id: "abc", state: "running" }];
  const posted = await fetch(`${base}/api/metrics`, {
    method: "POST",
    headers: { authorization: bearer(creds.token), "content-type": "application/json" },
    body: JSON.stringify(fixture),
  });
  assert.equal(posted.status, 200);
  const tixOld = (await postTicket({ token: creds.token })).body?.ticket;
  const tixNew = (await postTicket({ token: creds.token })).body?.ticket;
  const opTicket = (await postTicket({ basic: BASIC })).body?.ticket;
  assert.ok(tixOld && tixNew && opTicket, "tickets required");
  const oldAgent = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_B}&ticket=${tixOld}`);
  assert.equal(oldAgent.opened, true, "old agent socket must open");
  // Reconnect: the new socket replaces the old one for the same system.
  const newAgent = await tryConnect(`${wsBase()}/api/ws?type=server&name=${SYS_B}&ticket=${tixNew}`);
  assert.equal(newAgent.opened, true, "new agent socket must open");
  const newMsgs = collect(newAgent.ws);
  const oldClosed = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    oldAgent.ws.addEventListener("close", (ev) => {
      clearTimeout(timer);
      resolve(ev.code);
    });
  });
  // Now close the stale socket. The close guard must not unregister the new one.
  closeWs(oldAgent.ws);
  const oldCode = await oldClosed;
  assert.ok(oldCode === 4409 || oldCode === 1005, `stale socket must close, got ${oldCode}`);
  await sleep(500);
  const op = await tryConnect(`${wsBase()}/api/ws?ticket=${opTicket}`);
  assert.equal(op.opened, true);
  try {
    op.ws.send(JSON.stringify({ system: SYS_B, type: "docker", action: "stop", containerName: "poc-container" }));
    await waitFor(() => newMsgs.length > 0, 3000, "reconnected agent never received the command");
    assert.equal(JSON.parse(newMsgs[0]).system, SYS_B);
  } finally {
    closeWs(newAgent.ws);
    closeWs(oldAgent.ws);
    closeWs(op.ws);
  }
});
