import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PKPass } from "passkit-generator";
import type { NormalizedPass } from "../import/normalize";
import type { Source } from "../import/types";
import { artworkFiles, ticketLogoFiles } from "./artwork";
import { mapToPassJson } from "./map";
import type { ThumbnailFiles } from "./thumbnail";
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
export async function buildPass(pass: NormalizedPass, config: SigningConfig, options: { source?: Source; publicBaseUrl?: string; thumbnail?: ThumbnailFiles } = {}) {
  const json = mapToPassJson(pass, { ...options, passTypeIdentifier: config.passTypeIdentifier, teamIdentifier: config.teamIdentifier, serialNumber: randomUUID() });
  const files: Record<string, Buffer> = { "pass.json": Buffer.from(JSON.stringify(json)) };
  // An event ticket gets a picture behind the whole card, drawn from its colors, and a small ticket
  // emblem in place of the neutral ring logo, which would have nothing to say on top of the picture.
  const artwork = pass.type === "eventTicket" ? artworkFiles(pass.style) : undefined;
  const names = ["icon.png", "icon@2x.png", "icon@3x.png", ...(artwork ? [] : ["logo.png", "logo@2x.png", "logo@3x.png"])];
  for (const name of names) {
    files[name] = await readFile(path.join(process.cwd(), "pass-models/default.pass", name));
  }
  if (artwork) Object.assign(files, artwork, ticketLogoFiles(pass.style));
  // The person's event picture, already checked; Wallet shows thumbnails on event tickets and generic passes.
  if (options.thumbnail && (pass.type === "eventTicket" || pass.type === "generic")) Object.assign(files, options.thumbnail);
  const pkpass = new PKPass(files, {
    signerCert: config.signerCertPem, signerKey: config.signerKeyPem,
    signerKeyPassphrase: config.signerKeyPassphrase, wwdr: config.wwdrCertPem,
  });
  return pkpass.getAsBuffer();
}
