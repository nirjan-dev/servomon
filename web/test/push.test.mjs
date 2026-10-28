import test from "node:test";
import assert from "node:assert/strict";
import webpush from "web-push";
import { generateVapidKeys } from "../scripts/generate-vapid-keys.mjs";

const config = { public: { pushPublicKey: "" }, pushPrivateKey: "" };
let stored;
let writes = 0;
globalThis.useRuntimeConfig = () => config;
globalThis.useStorage = () => ({
  getItem: async () => stored,
  setItem: async (_key, value) => { writes++; stored = value; },
});
const { resolveVapidKeys } = await import("../server/utils/vapidKeys.ts");

test("VAPID generation uses web-push compatible P-256 keys", () => {
  const keys = generateVapidKeys();
  assert.equal(Buffer.from(keys.publicKey, "base64url").length, 65);
  assert.equal(Buffer.from(keys.privateKey, "base64url").length, 32);
  webpush.setVapidDetails("https://servomon.nirjan.dev", keys.publicKey, keys.privateKey);
  const request = webpush.generateRequestDetails({ endpoint: "https://push.example.test/send", keys: {} });
  assert.match(request.headers.Authorization, /^vapid /);
});

test("first calls persist once, explicit pairs win, partial pairs disable push", async () => {
  const [a, b] = await Promise.all([resolveVapidKeys(), resolveVapidKeys()]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, stored);
  assert.equal(writes, 1);
  const explicit = generateVapidKeys();
  config.public.pushPublicKey = explicit.publicKey;
  config.pushPrivateKey = explicit.privateKey;
  assert.deepEqual(await resolveVapidKeys(), explicit);
  config.pushPrivateKey = "";
  assert.equal(await resolveVapidKeys(), null);
  config.public.pushPublicKey = "";
  assert.deepEqual(await resolveVapidKeys(), a);
});
