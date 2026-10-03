import { describe, expect, it } from "vitest";
import type { StorageConfig } from "../../src/lib/storage/config";
import { runStorageCheck } from "./storage-check";

const config: StorageConfig = {
  endpoint: "https://abcd.storage.supabase.co/storage/v1/s3",
  region: "eu-central-1",
  bucket: "passclip-files",
  accessKeyId: "access-key-id",
  secretAccessKey: "very-secret-value",
  publicUrl: "https://abcd.supabase.co/storage/v1/object/public/passclip-files",
};
const site = "https://passclip.example";

/** An in-memory bucket. `broken` turns one behavior off. */
function bucket(broken?: "cors" | "auth" | "private" | "cache") {
  const files = new Map<string, Buffer>();
  const keyOf = (url: URL) => url.pathname.split("/").slice(-2).join("/");
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: broken === "cors" ? {} : { "Access-Control-Allow-Origin": site } });
    if (method === "PUT") {
      if (broken === "auth") return new Response("<Error><Code>SignatureDoesNotMatch</Code></Error>", { status: 403 });
      files.set(keyOf(url), Buffer.from(init?.body as Buffer));
      return new Response(null, { status: 200 });
    }
    if (method === "DELETE") {
      if (broken !== "cache") files.delete(keyOf(url));
      return new Response(null, { status: 204 });
    }
    const file = files.get(keyOf(url));
    return broken === "private" || !file ? new Response(null, { status: 400 }) : new Response(new Uint8Array(file));
  };
  return fetcher as typeof fetch;
}

describe("runStorageCheck", () => {
  it("passes every step on a working bucket", async () => {
    const lines = await runStorageCheck(config, site, bucket());
    expect(lines).toEqual([
      { ok: true, message: "Browsers on https://passclip.example may upload to the bucket." },
      { ok: true, message: "Uploaded a test image with a signed link." },
      { ok: true, message: "Read it back from STORAGE_PUBLIC_URL." },
      { ok: true, message: "Deleted it again." },
    ]);
  });

  it("explains each kind of problem, without printing secrets", async () => {
    const cors = await runStorageCheck(config, site, bucket("cors"));
    expect(cors[0]).toMatchObject({ ok: false, message: expect.stringContaining("Add a CORS rule") });

    const auth = await runStorageCheck(config, site, bucket("auth"));
    expect(auth.at(-1)).toEqual({ ok: false, message: "Storage refused the upload (403 SignatureDoesNotMatch). Check STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_REGION and STORAGE_BUCKET." });

    const hidden = await runStorageCheck(config, site, bucket("private"));
    expect(hidden).toContainEqual({ ok: false, message: "Couldn't read the test image at STORAGE_PUBLIC_URL (400). Make the bucket public, and check that the address ends with the bucket's name." });

    const cached = await runStorageCheck(config, site, bucket("cache"));
    expect(cached.at(-1)).toMatchObject({ ok: "note" });

    for (const lines of [cors, auth, hidden, cached]) expect(JSON.stringify(lines)).not.toContain(config.secretAccessKey);
  });

  it("says when storage can't be reached at all", async () => {
    const offline = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    expect((await runStorageCheck(config, site, offline)).at(-1)).toEqual({ ok: false, message: "Couldn't reach STORAGE_ENDPOINT. Check the address and your connection." });
  });
});
