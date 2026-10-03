import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectSigningConfig, readSigningConfig, REQUIRED_SIGNING_VARS, type Env } from "./signing";

const base64 = (text: string) => Buffer.from(text).toString("base64");

describe("readSigningConfig", () => {
  it("lists every missing setting", () => {
    expect(readSigningConfig({ PASS_TYPE_IDENTIFIER: "  " })).toEqual({
      ok: false,
      missing: [...REQUIRED_SIGNING_VARS],
      problems: [],
    });
  });

  it("explains settings in the wrong format", () => {
    const result = readSigningConfig({
      PASS_TYPE_IDENTIFIER: "com.example.passclip",
      APPLE_TEAM_ID: "abcde",
      PASS_SIGNER_CERT_PEM_BASE64: "-----BEGIN CERTIFICATE-----\nMIIB",
      PASS_SIGNER_KEY_PEM_BASE64: "not base64!",
      APPLE_WWDR_CERT_PEM_BASE64: base64("0\u0082 a DER file, not PEM"),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems).toEqual([
      expect.stringContaining('must start with "pass."'),
      expect.stringContaining("10-character Apple team ID"),
      expect.stringContaining("PASS_SIGNER_CERT_PEM_BASE64 contains a PEM file as-is"),
      expect.stringContaining("PASS_SIGNER_KEY_PEM_BASE64 isn't valid base64"),
      expect.stringContaining("openssl x509 -inform der"),
    ]);
  });

  it("asks for the passphrase of an encrypted key", () => {
    const result = readSigningConfig({
      PASS_TYPE_IDENTIFIER: "pass.com.example.passclip",
      APPLE_TEAM_ID: "ABCDE12345",
      PASS_SIGNER_CERT_PEM_BASE64: base64("-----BEGIN CERTIFICATE-----\n"),
      PASS_SIGNER_KEY_PEM_BASE64: base64("-----BEGIN ENCRYPTED PRIVATE KEY-----\n"),
      APPLE_WWDR_CERT_PEM_BASE64: base64("-----BEGIN CERTIFICATE-----\n"),
    });
    expect(result.ok ? [] : result.problems).toEqual([expect.stringContaining("PASS_SIGNER_KEY_PASSPHRASE")]);
  });
});

function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Throwaway certificates shaped like Apple's: a CA standing in for WWDR, a pass certificate it
// issued (UID = pass type ID, OU = team ID) with an encrypted key, and an unrelated CA.
describe.skipIf(!hasOpenssl())("inspectSigningConfig", () => {
  const passphrase = "test passphrase";
  let dir = "";
  let env: Env = {};

  const file = (name: string) => base64(readFileSync(path.join(dir, name), "utf8"));
  const inspect = (overrides: Env = {}, now?: Date) => {
    const result = readSigningConfig({ ...env, ...overrides });
    if (!result.ok) throw new Error(`Test settings should be readable: ${[...result.missing, ...result.problems]}`);
    return inspectSigningConfig(result.config, now);
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "passclip-signing-"));
    const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
    const newCa = (name: string, subject: string) =>
      openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.pem`, "-days", "730", "-subj", subject);
    newCa("wwdr", "/CN=Test Worldwide Developer Relations/OU=G4/O=Test/C=US");
    newCa("other-ca", "/CN=Other CA/OU=G3/O=Test/C=US");
    newCa("plain", "/CN=No pass type ID or team/O=Test/C=US");
    openssl(
      "req", "-new", "-newkey", "rsa:2048", "-keyout", "signer.key", "-passout", `pass:${passphrase}`, "-out", "signer.csr",
      "-subj", "/UID=pass.com.example.passclip/CN=Pass Type ID: pass.com.example.passclip/OU=ABCDE12345/O=Example/C=US",
    );
    openssl("x509", "-req", "-in", "signer.csr", "-CA", "wwdr.pem", "-CAkey", "wwdr.key", "-CAcreateserial", "-out", "signer.pem", "-days", "365");

    env = {
      PASS_TYPE_IDENTIFIER: "pass.com.example.passclip",
      APPLE_TEAM_ID: "ABCDE12345",
      PASS_SIGNER_CERT_PEM_BASE64: file("signer.pem"),
      PASS_SIGNER_KEY_PEM_BASE64: file("signer.key"),
      PASS_SIGNER_KEY_PASSPHRASE: passphrase,
      APPLE_WWDR_CERT_PEM_BASE64: file("wwdr.pem"),
    };
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a certificate, key and WWDR certificate that fit together", () => {
    const { problems, notes } = inspect();
    expect(problems).toEqual([]);
    expect(notes).toEqual([
      expect.stringMatching(/^The pass certificate is valid until \d{4}-\d{2}-\d{2}\.$/),
      expect.stringMatching(/^The WWDR certificate is valid until \d{4}-\d{2}-\d{2}\.$/),
    ]);
  });

  it("catches a pass type ID or team ID that doesn't match the certificate", () => {
    expect(inspect({ PASS_TYPE_IDENTIFIER: "pass.com.example.other", APPLE_TEAM_ID: "ZZZZZ99999" }).problems).toEqual([
      "The pass certificate is for pass.com.example.passclip, but PASS_TYPE_IDENTIFIER is pass.com.example.other.",
      "The pass certificate belongs to team ABCDE12345, but APPLE_TEAM_ID is ZZZZZ99999.",
    ]);
  });

  it("doesn't fail a certificate that lacks the usual pass type ID and team fields, but says so", () => {
    const { problems, notes } = inspect({
      PASS_SIGNER_CERT_PEM_BASE64: file("plain.pem"),
      PASS_SIGNER_KEY_PEM_BASE64: file("plain.key"),
      APPLE_WWDR_CERT_PEM_BASE64: file("plain.pem"), // self-signed, so it issued itself
    });
    expect(problems).toEqual([]);
    expect(notes[0]).toContain("weren't compared with PASS_TYPE_IDENTIFIER and APPLE_TEAM_ID");
  });

  it("catches a wrong passphrase", () => {
    expect(inspect({ PASS_SIGNER_KEY_PASSPHRASE: "wrong" }).problems).toEqual([
      expect.stringContaining("The private key can't be opened"),
    ]);
  });

  it("catches a key that doesn't belong to the certificate", () => {
    expect(inspect({ PASS_SIGNER_KEY_PEM_BASE64: file("other-ca.key") }).problems).toEqual([
      expect.stringContaining("The private key doesn't belong to the pass certificate"),
    ]);
  });

  it("catches a WWDR certificate that didn't issue the pass certificate, and names the right one", () => {
    expect(inspect({ APPLE_WWDR_CERT_PEM_BASE64: file("other-ca.pem") }).problems).toEqual([
      "The WWDR certificate didn't issue the pass certificate. Download the WWDR certificate (G4) from Apple's certificate authority page.",
    ]);
  });

  it("warns 30 days before the pass certificate expires and fails once it has", () => {
    const soon = new Date(Date.now() + 350 * 24 * 60 * 60 * 1000);
    expect(inspect({}, soon).notes[0]).toMatch(/^The pass certificate expires on .+\. Renew it before then\.$/);

    const later = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    expect(inspect({}, later).problems).toEqual([expect.stringMatching(/^The pass certificate expired on /)]);
  });
});
