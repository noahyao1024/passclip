import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PKPass } from "passkit-generator";
import type { NormalizedPass } from "../import/normalize";
import type { Source } from "../import/types";
import { mapToPassJson } from "./map";
import { inspectSigningConfig, readSigningConfig, type Env, type SigningConfig } from "./signing";

export function signingAvailable(env: Env): boolean {
  const result = readSigningConfig(env);
  return result.ok && inspectSigningConfig(result.config).problems.length === 0;
}
export function requireSigning(env: Env): SigningConfig {
  const result = readSigningConfig(env);
  if (!result.ok || inspectSigningConfig(result.config).problems.length > 0) throw new Error("Pass signing isn't set up yet.");
  return result.config;
}
export async function buildPass(pass: NormalizedPass, config: SigningConfig, options: { source?: Source; publicBaseUrl?: string } = {}) {
  const json = mapToPassJson(pass, { ...options, passTypeIdentifier: config.passTypeIdentifier, teamIdentifier: config.teamIdentifier, serialNumber: randomUUID() });
  const files: Record<string, Buffer> = { "pass.json": Buffer.from(JSON.stringify(json)) };
  for (const name of ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "logo@3x.png"]) {
    files[name] = await readFile(path.join(process.cwd(), "pass-models/default.pass", name));
  }
  const pkpass = new PKPass(files, {
    signerCert: config.signerCertPem, signerKey: config.signerKeyPem,
    signerKeyPassphrase: config.signerKeyPassphrase, wwdr: config.wwdrCertPem,
  });
  return pkpass.getAsBuffer();
}
