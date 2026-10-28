import { generateKeyPairSync } from "node:crypto";
import { pathToFileURL } from "node:url";

export function generateVapidKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const { x, y, d } = privateKey.export({ format: "jwk" });
  return {
    publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(x, "base64url"), Buffer.from(y, "base64url")]).toString("base64url"),
    privateKey: d,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { publicKey, privateKey } = generateVapidKeys();
  console.log(`NUXT_PUBLIC_PUSH_PUBLIC_KEY=${publicKey}`);
  console.log(`NUXT_PUSH_PRIVATE_KEY=${privateKey}`);
}
