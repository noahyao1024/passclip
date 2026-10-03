import { describe, expect, it } from "vitest";
import { readStorageConfig, uploadsAvailable } from "./config";

const env = {
  STORAGE_ENDPOINT: "https://abcd.storage.supabase.co/storage/v1/s3/",
  STORAGE_REGION: "eu-central-1",
  STORAGE_BUCKET: "passclip-files",
  STORAGE_ACCESS_KEY_ID: "access-key-id",
  STORAGE_SECRET_ACCESS_KEY: "do-not-print-this-secret",
  STORAGE_PUBLIC_URL: "https://abcd.supabase.co/storage/v1/object/public/passclip-files/",
};

describe("readStorageConfig", () => {
  it("reads complete settings and drops trailing slashes", () => {
    expect(readStorageConfig(env)).toEqual({
      ok: true,
      config: {
        endpoint: "https://abcd.storage.supabase.co/storage/v1/s3",
        region: "eu-central-1",
        bucket: "passclip-files",
        accessKeyId: "access-key-id",
        secretAccessKey: "do-not-print-this-secret",
        publicUrl: "https://abcd.supabase.co/storage/v1/object/public/passclip-files",
      },
    });
    expect(uploadsAvailable(env)).toBe(true);
  });

  it("is off, with the missing names listed, until every setting is there", () => {
    expect(readStorageConfig({})).toMatchObject({ ok: false, missing: expect.arrayContaining(["STORAGE_ENDPOINT", "STORAGE_PUBLIC_URL"]) });
    expect(readStorageConfig({ ...env, STORAGE_REGION: " " })).toEqual({ ok: false, missing: ["STORAGE_REGION"], problems: [] });
    expect(uploadsAvailable({ ...env, STORAGE_BUCKET: "" })).toBe(false);
  });

  it("allows plain http only for storage on this computer", () => {
    expect(readStorageConfig({ ...env, STORAGE_ENDPOINT: "http://127.0.0.1:54321/storage/v1/s3" }).ok).toBe(true);
    expect(readStorageConfig({ ...env, STORAGE_ENDPOINT: "http://storage.example.com" })).toMatchObject({ ok: false, problems: ["STORAGE_ENDPOINT must be the storage's S3 address, starting with https://."] });
  });

  it("needs an https public address, because pass links must be https", () => {
    expect(readStorageConfig({ ...env, STORAGE_PUBLIC_URL: "http://127.0.0.1:54321/storage/v1/object/public/b" })).toMatchObject({ ok: false, problems: ["STORAGE_PUBLIC_URL must be the https:// address where the bucket's files can be read."] });
  });

  it("explains a bad bucket name or region without printing secrets", () => {
    const result = readStorageConfig({ ...env, STORAGE_BUCKET: "Passclip Files", STORAGE_REGION: "EU Central" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(2);
    expect(result.problems.join(" ")).not.toContain(env.STORAGE_SECRET_ACCESS_KEY);
  });
});
