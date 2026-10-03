import { createPrivateKey, X509Certificate, type KeyObject } from "node:crypto";

// Pass signing settings. They come only from env vars (CLAUDE.md rule 1); see docs/SPEC.md §6.
// Uses node:crypto, so only server code and scripts may import this file.

export const REQUIRED_SIGNING_VARS = [
  "PASS_TYPE_IDENTIFIER",
  "APPLE_TEAM_ID",
  "PASS_SIGNER_CERT_PEM_BASE64",
  "PASS_SIGNER_KEY_PEM_BASE64",
  "APPLE_WWDR_CERT_PEM_BASE64",
] as const;

export type Env = Readonly<Record<string, string | undefined>>;

export interface SigningConfig {
  passTypeIdentifier: string;
  teamIdentifier: string;
  signerCertPem: string;
  signerKeyPem: string;
  /** Only needed when the key is encrypted. */
  signerKeyPassphrase?: string;
  wwdrCertPem: string;
}

export type SigningConfigResult =
  | { ok: true; config: SigningConfig }
  | { ok: false; missing: string[]; problems: string[] };

export interface SigningInspection {
  problems: string[];
  notes: string[];
}

const CERTIFICATE_HEADER = "-----BEGIN CERTIFICATE-----";
const PRIVATE_KEY_HEADER = /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ENCODE_HINT = "Encode the PEM file on one line: base64 < file.pem | tr -d '\\n'";
const EXPIRY_WARNING_MS = 30 * 24 * 60 * 60 * 1000;

/** Reads and decodes the signing settings. Any missing setting means preview-only mode. */
export function readSigningConfig(env: Env): SigningConfigResult {
  const missing = REQUIRED_SIGNING_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) return { ok: false, missing, problems: [] };

  const read = (name: (typeof REQUIRED_SIGNING_VARS)[number]) => env[name]?.trim() ?? "";
  const problems: string[] = [];

  const passTypeIdentifier = read("PASS_TYPE_IDENTIFIER");
  if (!passTypeIdentifier.startsWith("pass.")) {
    problems.push('PASS_TYPE_IDENTIFIER must start with "pass.", like pass.com.yourdomain.passclip.');
  }
  const teamIdentifier = read("APPLE_TEAM_ID");
  if (!/^[A-Z0-9]{10}$/.test(teamIdentifier)) {
    problems.push("APPLE_TEAM_ID must be your 10-character Apple team ID, like ABCDE12345.");
  }

  const signerCertPem = decodePem("PASS_SIGNER_CERT_PEM_BASE64", read("PASS_SIGNER_CERT_PEM_BASE64"), "certificate", problems);
  const signerKeyPem = decodePem("PASS_SIGNER_KEY_PEM_BASE64", read("PASS_SIGNER_KEY_PEM_BASE64"), "key", problems);
  const wwdrCertPem = decodePem("APPLE_WWDR_CERT_PEM_BASE64", read("APPLE_WWDR_CERT_PEM_BASE64"), "certificate", problems);

  // Passphrases aren't trimmed: spaces can be part of them.
  const signerKeyPassphrase = env.PASS_SIGNER_KEY_PASSPHRASE || undefined;
  if (signerKeyPem.includes("ENCRYPTED") && !signerKeyPassphrase) {
    problems.push("PASS_SIGNER_KEY_PEM_BASE64 is encrypted, so PASS_SIGNER_KEY_PASSPHRASE needs its passphrase.");
  }

  if (problems.length > 0) return { ok: false, missing: [], problems };
  return {
    ok: true,
    config: { passTypeIdentifier, teamIdentifier, signerCertPem, signerKeyPem, signerKeyPassphrase, wwdrCertPem },
  };
}

function decodePem(name: string, value: string, kind: "certificate" | "key", problems: string[]): string {
  if (value.includes("-----BEGIN")) {
    problems.push(`${name} contains a PEM file as-is. ${ENCODE_HINT}`);
    return "";
  }
  if (!BASE64.test(value.replace(/\s/g, ""))) {
    problems.push(`${name} isn't valid base64. ${ENCODE_HINT}`);
    return "";
  }
  const pem = Buffer.from(value, "base64").toString("utf8");
  if (kind === "certificate" && !pem.includes(CERTIFICATE_HEADER)) {
    problems.push(
      `${name} doesn't contain a PEM certificate. If you have a .cer file, convert it first: openssl x509 -inform der -in file.cer -out file.pem`,
    );
    return "";
  }
  if (kind === "key" && !PRIVATE_KEY_HEADER.test(pem)) {
    problems.push(`${name} doesn't contain a PEM private key. Export it from your .p12 file as described in docs/SPEC.md §6.`);
    return "";
  }
  return pem;
}

/**
 * Opens the certificates and the key and checks that they fit together: the certificate matches
 * PASS_TYPE_IDENTIFIER and APPLE_TEAM_ID, the key belongs to it, the WWDR certificate issued it,
 * and nothing has expired.
 */
export function inspectSigningConfig(config: SigningConfig, now = new Date()): SigningInspection {
  const problems: string[] = [];
  const notes: string[] = [];

  const signer = openCertificate(config.signerCertPem, "PASS_SIGNER_CERT_PEM_BASE64", problems);
  const wwdr = openCertificate(config.wwdrCertPem, "APPLE_WWDR_CERT_PEM_BASE64", problems);
  const key = openPrivateKey(config, problems);

  if (signer) {
    // Apple's service certificates usually carry the identifier in UID and the team ID in OU
    // (not yet confirmed in Apple's docs, see docs/DECISIONS.md), so only a mismatch fails.
    const subject = parseDistinguishedName(signer.subject);
    if (subject.UID === undefined || subject.OU === undefined) {
      notes.push(
        "The pass certificate doesn't show a pass type ID and team ID in the usual fields, so they weren't compared with PASS_TYPE_IDENTIFIER and APPLE_TEAM_ID.",
      );
    }
    if (subject.UID !== undefined && subject.UID !== config.passTypeIdentifier) {
      problems.push(
        `The pass certificate is for ${subject.UID}, but PASS_TYPE_IDENTIFIER is ${config.passTypeIdentifier}.`,
      );
    }
    if (subject.OU !== undefined && subject.OU !== config.teamIdentifier) {
      problems.push(`The pass certificate belongs to team ${subject.OU}, but APPLE_TEAM_ID is ${config.teamIdentifier}.`);
    }
    if (key && !signer.checkPrivateKey(key)) {
      problems.push(
        "The private key doesn't belong to the pass certificate. Export the certificate and its key together from Keychain Access again.",
      );
    }
    checkValidity(signer, "The pass certificate", now, problems, notes);
  }

  if (wwdr) {
    if (signer && !(signer.checkIssued(wwdr) && signer.verify(wwdr.publicKey))) {
      const generation = parseDistinguishedName(signer.issuer).OU;
      problems.push(
        `The WWDR certificate didn't issue the pass certificate. Download the WWDR certificate${generation ? ` (${generation})` : ""} from Apple's certificate authority page.`,
      );
    }
    checkValidity(wwdr, "The WWDR certificate", now, problems, notes);
  }

  return { problems, notes };
}

function openCertificate(pem: string, name: string, problems: string[]): X509Certificate | undefined {
  try {
    return new X509Certificate(pem);
  } catch {
    problems.push(`${name} has a certificate that can't be read. Export it again as described in docs/SPEC.md §6.`);
    return undefined;
  }
}

function openPrivateKey(config: SigningConfig, problems: string[]): KeyObject | undefined {
  try {
    return createPrivateKey({ key: config.signerKeyPem, passphrase: config.signerKeyPassphrase });
  } catch {
    problems.push("The private key can't be opened. Check that PASS_SIGNER_KEY_PASSPHRASE is the passphrase you chose.");
    return undefined;
  }
}

/** Node prints names one attribute per line, like "UID=pass.com.example\nOU=ABCDE12345". */
function parseDistinguishedName(name: string): Partial<Record<string, string>> {
  const fields: Partial<Record<string, string>> = {};
  for (const line of name.split("\n")) {
    const at = line.indexOf("=");
    const key = line.slice(0, at);
    if (at > 0 && !(key in fields)) fields[key] = line.slice(at + 1);
  }
  return fields;
}

function checkValidity(cert: X509Certificate, name: string, now: Date, problems: string[], notes: string[]) {
  const until = formatDate(cert.validToDate);
  if (now < cert.validFromDate) {
    problems.push(`${name} isn't valid until ${formatDate(cert.validFromDate)}.`);
  } else if (now > cert.validToDate) {
    problems.push(`${name} expired on ${until}. Create a new one in your Apple Developer account.`);
  } else if (cert.validToDate.getTime() - now.getTime() < EXPIRY_WARNING_MS) {
    notes.push(`${name} expires on ${until}. Renew it before then.`);
  } else {
    notes.push(`${name} is valid until ${until}.`);
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
