// S1: agent onboarding. First run (no AGENT_TOKEN) generates a stable agent id
// + keypair, prints a pairing code, and polls until the operator approves it
// from the dashboard. The issued token is saved back to the agent's .env.
//
// Token collection is bound to this device: the request submits a random
// collector secret (never displayed), and collection requires proving
// knowledge of it. Knowing the public pairing code alone is not enough.

export type EnrolledCredentials = { agentId: string; system: string; token: string };

type StoredIdentity = { agentId: string; privateKey: string; publicKey: string; collectorSecret?: string };

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadOrCreateIdentity(dir: string): Promise<StoredIdentity> {
  const path = `${dir}/.servomon-identity.json`;
  try {
    const raw = await Deno.readTextFile(path);
    const parsed = JSON.parse(raw) as Partial<StoredIdentity>;
    if (parsed.agentId && parsed.privateKey && parsed.publicKey) {
      return parsed as StoredIdentity;
    }
  } catch {
    // missing or corrupt: create fresh below
  }
  const agentId = `agent-${crypto.randomUUID()}`;
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateKey = JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.privateKey));
  const publicKey = JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.publicKey));
  const identity = { agentId, privateKey, publicKey };
  await Deno.writeTextFile(path, JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}

async function saveIdentity(dir: string, identity: StoredIdentity): Promise<void> {
  const path = `${dir}/.servomon-identity.json`;
  const tmpPath = `${path}.tmp`;
  await Deno.writeTextFile(tmpPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
  await Deno.rename(tmpPath, path);
  await Deno.chmod(path, 0o600);
}

function upsertEnvFile(dir: string, updates: Record<string, string>): Promise<void> {
  const path = `${dir}/.env`;
  return Deno.readTextFile(path)
    .catch(() => "")
    .then(async (raw) => {
      const lines = raw.split("\n");
      for (const [key, value] of Object.entries(updates)) {
        const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
        const line = `${key}=${value}`;
        if (idx >= 0) lines[idx] = line;
        else lines.push(line);
      }
      // Atomic write: a crash mid-save must not leave a truncated token.
      const tmpPath = `${path}.tmp`;
      await Deno.writeTextFile(tmpPath, lines.join("\n"), { mode: 0o600 });
      await Deno.rename(tmpPath, path);
      await Deno.chmod(path, 0o600);
    });
}

export async function enrollAgent(serverUrl: string, system: string, dir: string): Promise<EnrolledCredentials> {
  const identity = await loadOrCreateIdentity(dir);
  const fingerprint = await sha256Hex(identity.publicKey);
  if (!identity.collectorSecret) {
    identity.collectorSecret = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await saveIdentity(dir, identity);
  }
  const collectorSecret = identity.collectorSecret;

  const requestRes = await fetch(`${serverUrl}/api/enroll/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, agentId: identity.agentId, fingerprint, collectorSecret }),
  });
  if (requestRes.status === 409) {
    throw new Error("System name already enrolled or pending — pick a different NAME.");
  }
  if (!requestRes.ok) {
    throw new Error(`Enrollment request failed with HTTP ${requestRes.status}`);
  }
  const { code, expiresAt } = (await requestRes.json()) as { code: string; expiresAt: number };

  console.log(`\nEnrollment code: ${code}`);
  console.log(`Fingerprint:     ${fingerprint.slice(0, 19)}…`);
  console.log("Approve this agent from the Servomon dashboard (Agents section).");
  console.log(`Code expires at: ${new Date(expiresAt).toLocaleString()}\n`);
  console.log("Waiting for approval…");

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error("Enrollment timed out waiting for approval.");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`${serverUrl}/api/enroll/${code}`, {
      headers: { Authorization: `Bearer ${collectorSecret}` },
    });
    if (pollRes.status === 202) continue;
    if (pollRes.status === 410) throw new Error("Enrollment was denied or expired.");
    if (!pollRes.ok) throw new Error(`Enrollment poll failed with HTTP ${pollRes.status}`);
    const approved = (await pollRes.json()) as EnrolledCredentials;
    await upsertEnvFile(dir, { AGENT_ID: approved.agentId, AGENT_TOKEN: approved.token });
    console.log(`Enrolled as "${approved.system}". Token saved to ${dir}/.env — keep it secret.`);
    return approved;
  }
}
