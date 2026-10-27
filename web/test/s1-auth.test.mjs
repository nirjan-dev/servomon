// S1 regression suite — Servomon operator/control-plane authentication gap.
//
// Contract under test (post-fix behavior):
// - Every /api route denies anonymous callers (HTTP 401), except the public
//   enrollment request + poll endpoints.
// - Operator routes require HTTP Basic credentials from NUXT_BASIC_AUTH_USERS.
// - Agents onboard via POST /api/enroll/request → operator approves from the
//   dashboard → agent polls GET /api/enroll/:code for its one-time token.
// - POST /api/metrics requires the enrolled agent's Bearer token; body.name
//   must match the token's bound system (403 otherwise).
// - /api/ws requires a single-use ticket from POST /api/ws-ticket (?ticket=...).
//   Tickets bind role (operator|agent) and, for agents, the system name.
// - Operators may send commands only to connected agents; agents can only return
//   results; invalid commands are dropped; commands append to ./data/audit/audit.log.
// - Removing an agent revokes its token and closes its sockets immediately.
//
// Modes:
// - Local (default): requires `pnpm build` first. Spawns the production server on
//   a random port with an isolated temp data dir and test credentials, runs the
//   full suite, then kills the server.
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

const REMOTE = process.env.SERVOMON_TEST_URL?.replace(/\/$/, "");
const LOCAL = !REMOTE;

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
  const req = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system, agentId: id, fingerprint: `fp-${id}` }),
  });
  assert.equal(req.status, 200, `enroll request for ${system} must be public`);
  const { code } = await req.json();
  const approve = await fetch(`${base}/api/enroll/approve`, {
    method: "POST",
    headers: { authorization: BASIC, "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  assert.equal(approve.status, 200, `operator must approve ${system}`);
  const poll = await fetch(`${base}/api/enroll/${code}`);
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
    assert.deepEqual(JSON.parse(agentMsgs[0]), cmd);
    const result = { type: "docker", data: { success: true, timestamp: Date.now(), containerName: "poc-container" } };
    agent.ws.send(JSON.stringify(result));
    await waitFor(() => opMsgs.length > 0, 3000, "operator never received the result");
    assert.deepEqual(JSON.parse(opMsgs[0]), result);
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
    body: JSON.stringify({ system: SYS_A, agentId: `dup-${Date.now()}`, fingerprint: "fp-dup-test" }),
  });
  await dup.text().catch(() => {});
  assert.equal(dup.status, 409);
});

test("denied enrollment yields no token", { skip: !LOCAL && "needs credentials: local only" }, async () => {
  const req = await fetch(`${base}/api/enroll/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: "sys-deny", agentId: `deny-${Date.now()}`, fingerprint: "fp-deny-test" }),
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
