import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { folderFor } from "@/lib/attachments/storage";
import { POST } from "./route";

const storageEnv = {
  STORAGE_ENDPOINT: "https://abcd.storage.supabase.co/storage/v1/s3",
  STORAGE_REGION: "eu-central-1",
  STORAGE_BUCKET: "passclip-files",
  STORAGE_ACCESS_KEY_ID: "access-key-id",
  STORAGE_SECRET_ACCESS_KEY: "secret-access-key",
  STORAGE_PUBLIC_URL: "https://abcd.supabase.co/storage/v1/object/public/passclip-files",
};
const token = "q2vXo8n0Jk3m4P5r6S7t8U9v0W1x2Y3z4A5b6C7d8E9";

const form = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request("https://passclip.example/api/attachments/delete", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin", Origin: "null", ...headers },
    body: new URLSearchParams(fields).toString(),
  });

/** The error page's text, with HTML escapes undone. */
const pageText = async (response: Response) => (await response.text()).replace(/&#39;/g, "'");

const storage = vi.fn<typeof fetch>();
beforeEach(() => {
  for (const [name, value] of Object.entries(storageEnv)) vi.stubEnv(name, value);
  storage.mockReset();
  vi.stubGlobal("fetch", storage);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/attachments/delete", () => {
  it("deletes the file the token points to, then shows the delete page's confirmation", async () => {
    storage.mockResolvedValue(new Response(null, { status: 204 }));
    const response = await POST(form({ token, file: "Venue-map.pdf" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/delete-file?deleted=1");
    expect(storage).toHaveBeenCalledOnce();
    const [url, init] = storage.mock.calls[0];
    expect(init?.method).toBe("DELETE");
    const target = new URL(String(url));
    expect(target.pathname).toBe(`/storage/v1/s3/passclip-files/${folderFor(token)}/Venue-map.pdf`);
    expect(target.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("explains an incomplete link on a page, without asking storage", async () => {
    for (const fields of [{ token: token.slice(2), file: "a.pdf" }, { token, file: "../a.pdf" }, { token, file: "" }]) {
      const response = await POST(form(fields));
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toContain("This delete link is incomplete. Copy the whole link and open it again.");
    }
    expect(storage).not.toHaveBeenCalled();
  });

  it("says when storage refuses or can't be reached", async () => {
    storage.mockResolvedValueOnce(new Response("<Error/>", { status: 403 }));
    const refused = await POST(form({ token, file: "a.pdf" }));
    expect(refused.status).toBe(502);
    expect(await pageText(refused)).toContain("Couldn't delete the file. Try again in a moment.");

    storage.mockRejectedValueOnce(new TypeError("fetch failed"));
    const unreachable = await POST(form({ token, file: "a.pdf" }));
    expect(unreachable.status).toBe(502);
    expect(await pageText(unreachable)).toContain("Couldn't reach file storage. Try again in a moment.");
  });

  it("refuses other websites and requests that aren't the delete form", async () => {
    const crossSite = await POST(form({ token, file: "a.pdf" }, { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" }));
    expect(crossSite.status).toBe(403);
    const json = await POST(new Request("https://passclip.example/api/attachments/delete", { method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: "{}" }));
    expect(json.status).toBe(415);
    expect(storage).not.toHaveBeenCalled();
  });

  it("says so when uploads aren't set up", async () => {
    vi.stubEnv("STORAGE_ENDPOINT", "");
    const response = await POST(form({ token, file: "a.pdf" }));
    expect(response.status).toBe(503);
    expect(await pageText(response)).toContain("File uploads aren't set up on this site");
  });
});
