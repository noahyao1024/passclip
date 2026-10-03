import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { chromium } from "@playwright/test";

// Exercises real production HTTP and browser downloads with disposable test certificates.
// These certificates are not issued by Apple and must never be used for genuine Wallet passes.
const directory = mkdtempSync(path.join(tmpdir(), "passclip-http-"));
const base = "http://127.0.0.1:3101";
let server, browser;
try {
  await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once("error", reject); probe.listen(3101, "127.0.0.1", () => probe.close(resolve)); });
  const openssl = (...args) => execFileSync("openssl", args, { cwd: directory, stdio: "pipe" });
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=Test CA");
  openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "signer.key", "-out", "signer.csr", "-subj", "/UID=pass.com.example.smoke/OU=ABCDE12345/CN=Test signer");
  openssl("x509", "-req", "-in", "signer.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "signer.pem", "-days", "1");
  const file = (name) => readFileSync(path.join(directory, name)).toString("base64");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3101"], {
    detached: true, stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", PASS_TYPE_IDENTIFIER: "pass.com.example.smoke", APPLE_TEAM_ID: "ABCDE12345", PASS_SIGNER_CERT_PEM_BASE64: file("signer.pem"), PASS_SIGNER_KEY_PEM_BASE64: file("signer.key"), PASS_SIGNER_KEY_PASSPHRASE: "", APPLE_WWDR_CERT_PEM_BASE64: file("ca.pem"), PUBLIC_BASE_URL: base },
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("The test server stopped before startup.");
    try { ready = (await fetch(base)).ok; if (ready) break; } catch { /* Startup hasn't completed. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, "The test server did not become ready.");
  // Every valid example, so new fixtures are covered automatically.
  const names = readdirSync("examples").filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
  for (const name of names) {
    const text = readFileSync(`examples/${name}.json`, "utf8");
    const imported = await fetch(base + "/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, fallbackTimeZone: "Asia/Tokyo" }) });
    assert.equal(imported.status, 200); const result = await imported.json();
    assert.equal(result.signingAvailable, true); assert.equal(result.layouts.length, result.value.passes.length);
    const signed = await fetch(base + "/api/pass", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, fallbackTimeZone: "Asia/Tokyo" }) });
    assert.equal(signed.status, 200); assert.equal(signed.headers.get("content-type"), "application/vnd.apple.pkpass");
    assert.equal(signed.headers.get("cache-control"), "no-store"); assert.match(signed.headers.get("content-disposition"), /^attachment; filename="[a-zA-Z0-9-]+\.pkpass"$/);
    const bytes = new Uint8Array(await signed.arrayBuffer()); assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
  }
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync(chromium.executablePath()) ? undefined : ["/usr/bin/chromium", "/opt/pw-browsers/chromium"].find((path) => existsSync(path))) });
  const page = await browser.newPage(); const errors = [];
  page.on("pageerror", () => errors.push("Page error"));
  page.on("console", (message) => { if (message.type() === "error") errors.push("Browser error"); });
  await page.goto(base); await page.getByRole("button", { name: "Try an example" }).click();
  await page.locator(".pass-result").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Add to Apple Wallet" }).first().isEnabled(), true);
  const download = page.waitForEvent("download").catch(() => null);
  const response = page.waitForResponse((response) => response.url().endsWith("/api/pass") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Add to Apple Wallet" }).first().click();
  const formResponse = await response;
  assert.equal(formResponse.status(), 200, `Browser form returned HTTP ${formResponse.status()}`);
  const fileDownload = await download; assert(fileDownload, "The browser did not download a pass."); assert.match(fileDownload.suggestedFilename(), /\.pkpass$/);
  assert.equal(await fileDownload.failure(), null); assert.equal(errors.length, 0);
  console.log(`Signing smoke passed: ${names.length} native preview/sign requests and one real browser form download; temporary test certificates only.`);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    process.kill(-server.pid, "SIGTERM");
    await stopped;
  }
  rmSync(directory, { recursive: true, force: true });
}
