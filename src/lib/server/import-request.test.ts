import { describe, expect, it, vi } from "vitest";
import { readImportRequest, allowRequest } from "./import-request";
import { POST as passPost } from "../../app/api/pass/route";
import { POST as importPost } from "../../app/api/import/route";
const text = JSON.stringify({ schemaVersion: "1.0", passes: [{ type: "generic", title: "Test" }] });
const request = (body: string, headers: Record<string, string> = { "Content-Type": "application/json" }) => new Request("https://passclip.example/api/pass", { method: "POST", headers, body });
describe("server request validation", () => {
  it("accepts the configured public origin when Next sees an internal proxy URL", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://passclip.example");
    try {
      const proxyRequest = new Request("http://internal:3000/api/pass", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://passclip.example" }, body: JSON.stringify({ text }) });
      expect((await readImportRequest(proxyRequest)).result.ok).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });
  it("runs the same pipeline for native JSON and browser forms", async () => {
    const native = await readImportRequest(request(JSON.stringify({ text })));
    const web = await readImportRequest(request(new URLSearchParams({ import: text }).toString(), { "Content-Type": "application/x-www-form-urlencoded" }));
    expect(native).toEqual(web);
    expect(native.result.ok).toBe(true);
  });
  it("accepts a no-referrer form only with browser-controlled same-origin metadata", async () => {
    const body = new URLSearchParams({ import: text }).toString();
    const headers = { "Content-Type": "application/x-www-form-urlencoded", Origin: "null" };
    expect((await readImportRequest(request(body, { ...headers, "Sec-Fetch-Site": "same-origin" }))).result.ok).toBe(true);
    for (const site of [undefined, "cross-site", "same-site", "none"]) {
      await expect(readImportRequest(request(body, { ...headers, ...(site ? { "Sec-Fetch-Site": site } : {}) }))).rejects.toMatchObject({ status: 403 });
    }
    await expect(readImportRequest(request(body, { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "cross-site" }))).rejects.toMatchObject({ status: 403 });
  });
  it("rejects cross-origin, unsupported types, invalid indices and streamed oversize bodies", async () => {
    await expect(readImportRequest(request(JSON.stringify({ text }), { "Content-Type": "application/json", Origin: "https://other.example" }))).rejects.toMatchObject({ status: 403 });
    await expect(readImportRequest(request(text, { "Content-Type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
    await expect(readImportRequest(request(JSON.stringify({ text, index: -1 })))).rejects.toMatchObject({ status: 400 });
    await expect(readImportRequest(request("x".repeat(256 * 1024 + 1)))).rejects.toMatchObject({ status: 413 });
  });
  it("refuses invalid imports and unavailable signing without reflecting credentials", async () => {
    const invalid = await passPost(request(JSON.stringify({ text: '{"passes":[{"type":"generic"}]}' })));
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain("needs a title");
    const response = await passPost(request(JSON.stringify({ text })));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toContain("Pass signing isn't set up yet");
  });
  it("returns native layouts and warnings without storing or caching the import", async () => {
    const response = await importPost(request(JSON.stringify({ text })));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.value.passes[0].title).toBe("Test");
    expect(data.layouts[0].primaryFields[0].value).toBe("Test");
    expect(data.signingAvailable).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("caps the process limiter and resets its window without trusting forwarding headers", () => {
    const now = Date.now() + 60000;
    for (let i = 0; i < 30; i++) expect(allowRequest(request(text), now)).toBe(true);
    expect(allowRequest(request(text), now)).toBe(false);
    expect(allowRequest(request(text), now + 60001)).toBe(true);
  });
});
