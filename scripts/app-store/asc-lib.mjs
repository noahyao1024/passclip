// Shared App Store Connect API helper (ES256 JWT from the .p8 key). Never prints the key or token.
import { createPrivateKey, sign } from "node:crypto"; import { readFileSync } from "node:fs";
const keyId = process.env.ASC_KEY_ID, issuer = process.env.ASC_ISSUER_ID;
const b = (x) => Buffer.from(x).toString("base64url");
function token() {
  const t = Math.floor(Date.now() / 1000);
  const h = b(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })), p = b(JSON.stringify({ iss: issuer, iat: t, exp: t + 600, aud: "appstoreconnect-v1" }));
  const s = sign("sha256", Buffer.from(`${h}.${p}`), { key: createPrivateKey(readFileSync(`${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`)), dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${b(s)}`;
}
export async function api(method, path, body) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!r.ok) { const e = new Error(`${method} ${path} -> ${r.status}: ${(json.errors ?? []).map((x) => `${x.code} ${x.detail ?? x.title}`).join("; ") || text.slice(0, 300)}`); e.status = r.status; e.json = json; throw e; }
  return json;
}
