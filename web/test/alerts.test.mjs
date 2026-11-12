import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const basic = `Basic ${Buffer.from("testop:test-secret").toString("base64")}`;
const systems = ["alert-alpha", "alert-beta", "alert-gamma"];
const disabled = "alert-disabled";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function fixture(name) {
  const disk = (mountPoint) => ({ device: mountPoint, mountPoint, total: 100, free: 10, used: 90, usedPercentage: 90 });
  return {
    timestamp: Date.now(), name,
    memory: { total: 8000, free: 3000, used: 5000, usedPercentage: 62 },
    cpu: { cores: 4, used: 12, available: 88 },
    processes: [{ app: "init", pid: 1, cpuPercent: "0.1", memoryPercent: "0.2" }],
    disk: [disk(`/${name}-one`), disk(`/${name}-two`)],
    battery: { charge: 20 }, containersInfo: [],
    networkInfo: { downloadDrops: "0", downloadErrors: "0", downloadPerSecond: "10k", uploadDrops: "0", uploadErrors: "0", uploadPerSecond: "5k" },
    systemInfo: { os: "linux", kernel: "6.8", device: "test-box" },
  };
}

test("simultaneous task alerts reach Discord independently and respect opt-out", { timeout: 180000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "servomon-alerts-"));
  let child;
  let childExit;
  let output = "";
  let webhook;
  const pending = new Set();
  let childFailure;
  const messages = [];

  t.after(async () => {
    for (const response of pending) response.end();
    if (child?.pid) {
      // Detached process group includes corepack, pnpm, Nuxt and their children.
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      await Promise.race([childExit, sleep(5000)]);
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      await childExit;
    }
    if (webhook?.listening) await new Promise((resolve) => webhook.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  // Separate source tree keeps Nuxt's generated files and all storage out of
  // the checkout. No .env or existing data is copied into the test server.
  const copy = join(root, "web");
  const excluded = new Set(["node_modules", ".nuxt", ".output", ".data", "data", "test"]);
  await cp(webDir, copy, {
    recursive: true,
    filter: (source) => {
      const relative = source.slice(webDir.length + 1);
      const first = relative.split("/")[0];
      return !excluded.has(first) && !first.startsWith(".env");
    },
  });
  await cp(join(webDir, "..", "shared"), join(root, "shared"), { recursive: true });
  await symlink(join(webDir, "node_modules"), join(copy, "node_modules"), "dir");
  // Scheduled checks would race the explicit task requests at minute boundaries.
  const configPath = join(copy, "nuxt.config.ts");
  const config = await readFile(configPath, "utf8");
  const schedule = /    scheduledTasks: \{[\s\S]*?\n    \},/;
  assert.match(config, schedule);
  await writeFile(configPath, config.replace(schedule, "    scheduledTasks: {},"));

  webhook = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try { messages.push({ method: request.method, body: JSON.parse(body) }); }
      catch { messages.push({ method: request.method, body }); }
      pending.add(response);
      response.on("close", () => pending.delete(response));
    });
  });
  await new Promise((resolve, reject) => {
    webhook.once("error", reject);
    webhook.listen(0, "127.0.0.1", resolve);
  });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NUXT_|NITRO_|SERVOMON_)/.test(key)));
  Object.assign(env, {
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    NUXT_BASIC_AUTH_ENABLED: "true",
    NUXT_BASIC_AUTH_USERS: "testop:test-secret",
    NUXT_DISCORD_WEBHOOK_URL: `http://127.0.0.1:${webhook.address().port}/webhook`,
    NUXT_PUBLIC_ENABLE_DISCORD_ALERTS: "true",
    SERVOMON_DATA_DIR: join(root, "data"),
  });
  child = spawn("corepack", ["pnpm", "exec", "nuxt", "dev", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: copy, env, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
  childExit = new Promise((resolve) => {
    child.once("error", (error) => { childFailure = error; resolve({ error: String(error) }); });
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const deadline = Date.now() + 90000;
  let readiness = "no response";
  while (true) {
    try {
      const response = await fetch(`${base}/api/sytems`, { headers: { authorization: basic }, signal: AbortSignal.timeout(1000) });
      const body = await response.text();
      readiness = `HTTP ${response.status}`;
      if (response.ok) {
        try {
          if (Array.isArray(JSON.parse(body))) break;
          readiness += " (unexpected response body)";
        } catch {
          readiness += " (invalid JSON)";
        }
      }
    } catch (error) {
      readiness = String(error);
    }
    if (childFailure || child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
      throw new Error(`Nuxt did not start: ${childFailure ?? readiness} ${output}`);
    }
    await sleep(100);
  }

  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { authorization: basic, "content-type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    assert.ok(response.ok, `${path}: ${response.status} ${text}`);
    return text;
  }
  await request("/api/system-config", { method: "PUT", body: JSON.stringify({ system: disabled, enableAlerts: false }) });
  const freshMetrics = new Map();
  for (const system of [...systems, disabled]) {
    const metric = fixture(system);
    freshMetrics.set(system, metric);
    await request("/api/metrics", { method: "POST", body: JSON.stringify(metric) });
  }

  async function checkTask(task, expected) {
    messages.length = 0;
    let settled = false;
    const running = request(`/_nitro/tasks/${task}`).finally(() => { settled = true; });
    // Attach a rejection handler immediately even if arrival times out.
    running.catch(() => {});
    try {
      const until = Date.now() + 15000;
      while (messages.length < expected.length && !settled && Date.now() < until) await sleep(20);
      assert.equal(messages.length, expected.length, `${task}: all webhooks must arrive before task completes`);
      assert.equal(settled, false, `${task}: task must await webhook responses`);
    } finally {
      for (const response of pending) response.end();
    }
    await running;
    assert.deepEqual(messages.map(({ method, body }) => ({ method, body })).sort((a, b) => String(a.body.content).localeCompare(String(b.body.content))),
      expected.map((content) => ({ method: "POST", body: { content } })).sort((a, b) => a.body.content.localeCompare(b.body.content)));
  }

  await checkTask("metrics:battery", systems.map((system) => `Warning: Battery % lower than 50% for ${system}`));
  await checkTask("metrics:healthcheck", systems.map((system) => `Metrics coming in again, ${system} might be up again`));
  await checkTask("metrics:storage", systems.flatMap((system) => ["one", "two"].map((disk) => `Warning: Disk used % greater than 80% for /${system}-${disk}`)));
  for (const [system, metric] of freshMetrics) {
    await request("/api/metrics", {
      method: "POST",
      body: JSON.stringify({ ...metric, timestamp: metric.timestamp - 10 * 60 * 1000 }),
    });
    await request("/api/metrics", {
      method: "DELETE",
      body: JSON.stringify({ system, timestamp: metric.timestamp }),
    });
  }
  await checkTask("metrics:healthcheck", systems.map((system) => `No new metrics found, ${system} might be down`));
});
