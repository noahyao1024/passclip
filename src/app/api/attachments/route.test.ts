import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const storageEnv = {
  STORAGE_ENDPOINT: "https://abcd.storage.supabase.co/storage/v1/s3",
  STORAGE_REGION: "eu-central-1",
  STORAGE_BUCKET: "passclip-files",
  STORAGE_ACCESS_KEY_ID: "access-key-id",
  STORAGE_SECRET_ACCESS_KEY: "secret-access-key",
  STORAGE_PUBLIC_URL: "https://abcd.supabase.co/storage/v1/object/public/passclip-files",
};

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://passclip.example/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", Origin: "https://passclip.example", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  for (const [name, value] of Object.entries(storageEnv)) vi.stubEnv(name, value);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/attachments", () => {
  it("signs an upload link and returns the pass link and a one-time delete link", async () => {
    const response = await POST(request({ name: "Venue map.pdf", type: "application/pdf", size: 2048 }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const plan = await response.json();
    expect(plan.upload.method).toBe("PUT");
    expect(plan.upload.url).toMatch(/^https:\/\/abcd\.storage\.supabase\.co\/storage\/v1\/s3\/passclip-files\/[0-9a-f]{32}\/Venue-map\.pdf\?/);
    expect(plan.upload.headers).toEqual({ "Content-Type": "application/pdf" });
    expect(plan.attachment).toEqual({ title: "Venue map", url: expect.stringMatching(/^https:\/\/abcd\.supabase\.co\/storage\/v1\/object\/public\/passclip-files\/[0-9a-f]{32}\/Venue-map\.pdf$/), kind: "pdf" });
    expect(plan.deletePath).toMatch(/^\/delete-file#[A-Za-z0-9_-]{43}\/Venue-map\.pdf$/);
  });

  it("gives every upload its own folder", async () => {
    const first = await (await POST(request({ name: "a.png", type: "image/png", size: 10 }))).json();
    const second = await (await POST(request({ name: "a.png", type: "image/png", size: 10 }))).json();
    expect(first.attachment.url).not.toBe(second.attachment.url);
  });

  it("explains a file it won't take", async () => {
    const response = await POST(request({ name: "big.pdf", type: "application/pdf", size: 20 * 1024 * 1024 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ errors: [{ message: "This file is over 10 MB. Choose a smaller file, or add a link to it in your JSON instead." }] });
  });

  it("refuses requests that aren't the file's facts", async () => {
    for (const body of ["not json", { name: "a.pdf" }, { name: "a.pdf", type: "application/pdf", size: "10" }, { name: "x".repeat(300), type: "application/pdf", size: 10 }]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect((await response.json()).errors[0].message).toBe("Send the file's name, type and size as JSON.");
    }
    const huge = await POST(request({ name: "a.pdf", type: "application/pdf", size: 10, padding: "x".repeat(4000) }));
    expect(huge.status).toBe(413);
  });

  it("refuses other websites", async () => {
    const response = await POST(request({ name: "a.pdf", type: "application/pdf", size: 10 }, { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ errors: [{ message: "Open Passclip to attach a file." }] });
  });

  it("says so when uploads aren't set up", async () => {
    vi.stubEnv("STORAGE_SECRET_ACCESS_KEY", "");
    const response = await POST(request({ name: "a.pdf", type: "application/pdf", size: 10 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ errors: [{ message: "File uploads aren't set up yet." }] });
  });
});
