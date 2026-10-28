import { generateVapidKeys } from "../../scripts/generate-vapid-keys.mjs";

type VapidKeys = { publicKey: string; privateKey: string };
let pending: Promise<VapidKeys> | undefined;

export async function resolveVapidKeys(): Promise<VapidKeys | null> {
  const config = useRuntimeConfig();
  const publicKey = config.public.pushPublicKey;
  const privateKey = config.pushPrivateKey;
  if (publicKey && privateKey) return { publicKey, privateKey };
  if (publicKey || privateKey) {
    console.error("[push] Set both NUXT_PUBLIC_PUSH_PUBLIC_KEY and NUXT_PUSH_PRIVATE_KEY, or neither. Push notifications are disabled.");
    return null;
  }
  if (!pending) {
    pending = (async () => {
      const storage = useStorage("serverState");
      const stored = await storage.getItem<VapidKeys>("vapid-keys");
      if (stored) return stored;
      const keys = generateVapidKeys();
      await storage.setItem("vapid-keys", keys);
      return keys;
    })();
    // Do not retain a rejected promise after a temporary storage failure.
    void pending.catch(() => { pending = undefined; });
  }
  return pending;
}
