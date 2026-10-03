import { describe, expect, it } from "vitest";
import type { StorageConfig } from "../storage/config";
import { presignUrl } from "../storage/sigv4";
import { readDeleteFragment } from "./rules";
import { deleteUrlFor, folderFor, newDeleteToken, planUpload } from "./storage";

const config: StorageConfig = {
  endpoint: "https://abcd.storage.supabase.co/storage/v1/s3",
  region: "eu-central-1",
  bucket: "passclip-files",
  accessKeyId: "access-key-id",
  secretAccessKey: "secret-access-key",
  publicUrl: "https://abcd.supabase.co/storage/v1/object/public/passclip-files",
};
const now = new Date("2026-10-03T12:00:00Z");
const token = "q2vXo8n0Jk3m4P5r6S7t8U9v0W1x2Y3z4A5b6C7d8E9";

describe("planUpload", () => {
  const result = planUpload(config, { name: "Venue map.pdf", type: "application/pdf", size: 4321 }, { now, token });
  if (!result.ok) throw new Error(result.message);
  const { plan } = result;
  const folder = folderFor(token);

  it("signs a 10-minute upload of exactly this file's type and size", () => {
    const url = new URL(plan.upload.url);
    expect(`${url.origin}${url.pathname}`).toBe(`https://abcd.storage.supabase.co/storage/v1/s3/passclip-files/${folder}/Venue-map.pdf`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("access-key-id/20261003/eu-central-1/s3/aws4_request");
    expect(plan.upload).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/pdf" } });
    expect(plan.upload.url).toBe(presignUrl({
      method: "PUT",
      url: `${config.endpoint}/${config.bucket}/${folder}/Venue-map.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&x-id=PutObject`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: config.region },
      expiresInSeconds: 600, now, headers: { "content-type": "application/pdf", "content-length": "4321" },
    }));
  });

  it("links the pass to the public copy, in a folder that doesn't reveal the delete token", () => {
    expect(plan.attachment).toEqual({ title: "Venue map", url: `${config.publicUrl}/${folder}/Venue-map.pdf`, kind: "pdf" });
    expect(folder).toMatch(/^[0-9a-f]{32}$/);
    expect(plan.attachment.url).not.toContain(token);
  });

  it("gives a delete link that carries the token after the #", () => {
    expect(plan.deletePath).toBe(`/delete-file#${token}/Venue-map.pdf`);
    expect(readDeleteFragment(new URL(plan.deletePath, "https://passclip.example").hash)).toEqual({ token, fileName: "Venue-map.pdf" });
  });

  it("refuses files the browser shouldn't have offered", () => {
    expect(planUpload(config, { name: "x.exe", type: "application/octet-stream", size: 10 })).toEqual({ ok: false, message: "Choose a PDF, JPEG, PNG or HEIC file." });
  });
});

describe("delete tokens", () => {
  it("are random, 256-bit and URL-safe", () => {
    const tokens = new Set(Array.from({ length: 50 }, newDeleteToken));
    expect(tokens.size).toBe(50);
    for (const value of tokens) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("find the same file again", () => {
    const url = new URL(deleteUrlFor(config, token, "Venue-map.pdf", now));
    expect(url.pathname).toBe(`/storage/v1/s3/passclip-files/${folderFor(token)}/Venue-map.pdf`);
    expect(url.searchParams.get("x-id")).toBe("DeleteObject");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
  });
});
