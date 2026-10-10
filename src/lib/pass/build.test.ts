import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processImport } from "../import/process";
import { artworkSpec } from "./artwork";
import { buildPass } from "./build";
import { mapToPassJson } from "./map";
import type { SigningConfig } from "./signing";

// Ephemeral test certificates prove packaging and cryptography, not Apple's trust.
describe("signed pass package", () => {
  let dir: string; let signing: SigningConfig;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "passclip-build-"));
    const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=Test CA");
    openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "signer.key", "-out", "signer.csr", "-subj", "/UID=pass.com.example.test/OU=ABCDE12345/CN=Test signer");
    openssl("x509", "-req", "-in", "signer.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "signer.pem", "-days", "1");
    signing = { passTypeIdentifier: "pass.com.example.test", teamIdentifier: "ABCDE12345", signerCertPem: readFileSync(path.join(dir, "signer.pem"), "utf8"), signerKeyPem: readFileSync(path.join(dir, "signer.key"), "utf8"), wwdrCertPem: readFileSync(path.join(dir, "ca.pem"), "utf8") };
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it.each(["event-tickets", "flight", "train-local-time", "loyalty-card", "coupon", "gym-membership", "grocery-card"])("packages %s and verifies every manifest hash and detached signature", async (name) => {
    const result = processImport(readFileSync(`examples/${name}.json`, "utf8"), { fallbackTimeZone: "Asia/Tokyo" });
    if (!result.ok) throw new Error("Invalid fixture");
    const buffer = await buildPass(result.value.passes[0], signing, { source: result.value.source });
    const target = path.join(dir, name); writeFileSync(target + ".zip", buffer);
    execFileSync("python3", ["-c", "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", target + ".zip", target]);
    const manifest = JSON.parse(readFileSync(path.join(target, "manifest.json"), "utf8"));
    for (const [file, digest] of Object.entries(manifest)) expect(createHash("sha1").update(readFileSync(path.join(target, file))).digest("hex")).toBe(digest);
    const pass = JSON.parse(readFileSync(path.join(target, "pass.json"), "utf8"));
    expect(pass).toHaveProperty(result.value.passes[0].type);
    expect(pass.serialNumber).toMatch(/^[0-9a-f-]{36}$/);
    const expected = mapToPassJson(result.value.passes[0], {
      passTypeIdentifier: signing.passTypeIdentifier, teamIdentifier: signing.teamIdentifier,
      serialNumber: pass.serialNumber, source: result.value.source,
    });
    // The library converts relevance/expiry metadata to UTC and adds an empty
    // enhanced event row. Display field dates and barcode messages must stay exact.
    for (const key of ["relevantDate", "expirationDate"] as const) {
      if (expected[key]) expected[key] = new Date(expected[key]).toISOString();
    }
    if (expected.relevantDates) expected.relevantDates = expected.relevantDates.map(({ startDate, endDate }) => ({ startDate: new Date(startDate).toISOString(), endDate: new Date(endDate).toISOString() }));
    expect(pass).toEqual({ ...expected, ...(expected.eventTicket ? { eventTicket: { ...expected.eventTicket, additionalInfoFields: [] } } : {}) });
    expect(manifest).toHaveProperty("icon@3x.png");
    // An event ticket on a dark color gets a picture behind the card and the ticket emblem as its logo.
    const picture = result.value.passes[0].type === "eventTicket" && artworkSpec(result.value.passes[0].style) !== undefined;
    for (const file of ["background.png", "background@2x.png", "background@3x.png"]) expect(manifest.hasOwnProperty(file)).toBe(picture);
    expect(manifest).not.toHaveProperty("strip.png");
    // Every pass has a logo: the neutral one, or the ticket emblem on a picture.
    for (const file of ["logo.png", "logo@2x.png", "logo@3x.png"]) expect(manifest).toHaveProperty(file);
    if (picture) expect(readFileSync(path.join(target, "logo@2x.png")).equals(readFileSync("pass-models/default.pass/logo@2x.png"))).toBe(false);
    execFileSync("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-in", path.join(target, "signature"), "-content", path.join(target, "manifest.json"), "-CAfile", path.join(dir, "ca.pem"), "-purpose", "any", "-out", path.join(target, "verified.json")], { stdio: "pipe" });
    // The test checks our synthetic CA separately; it is never an Apple certificate.
    execFileSync("openssl", ["verify", "-CAfile", path.join(dir, "ca.pem"), path.join(dir, "signer.pem")], { stdio: "pipe" });
    expect(readFileSync(path.join(target, "verified.json"))).toEqual(readFileSync(path.join(target, "manifest.json")));
  });
});
