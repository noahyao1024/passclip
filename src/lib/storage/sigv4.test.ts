import { describe, expect, it } from "vitest";
import { presignUrl } from "./sigv4";

// The worked example from AWS's S3 docs, "Authenticating Requests: Using Query Parameters
// (AWS Signature Version 4)": a GET of test.txt, valid for 86400 seconds.
const awsExample = {
  credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" },
  now: new Date("2013-05-24T00:00:00Z"),
};

describe("presignUrl", () => {
  it("matches AWS's documented example signature", () => {
    const url = presignUrl({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", expiresInSeconds: 86400, ...awsExample });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  // Signatures made by AWS's own SDK (@aws-sdk/s3-request-presigner 3.1146.0, forcePathStyle,
  // signableHeaders content-type and content-length) for the same requests, on 2026-10-03.
  const sdk = {
    credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" },
    now: new Date("2026-10-03T11:22:33Z"),
    key: "passclip/9f86d081884c7d659a2feaa0c55ad015/My-ticket_1.pdf",
  };
  it.each([
    ["https://abcd.storage.supabase.co/storage/v1/s3", "ap-northeast-1", "705fd640a48e8734b4afca8c8c1df66c301d5734a8ccff4ebc254c5ca4caa205", "96ae704dbb4004d6ba09b05271e3bae8fc2b6df822beeb7a10bc54d6b6e8729a"],
    ["https://0123456789abcdef.r2.cloudflarestorage.com", "auto", "9a9a549486aade1cbe3c74e46392683fbb4b4f3b625c1cfcc1a1f1c5908c6c28", "d68d1cb0cb0ee82cd88fb83e0b6075c0364e5a473901bd007b61dc9ce1f5d968"],
    ["http://127.0.0.1:54321/storage/v1/s3", "local", "133ca544cdadcac939e0f9ac7de101ad0dce4a7c8d92ab6b2b7f260304082da9", "9b6595ba901fdc08729c29a0a90db71f1b26e682c5cce9f8b10076d6f54c7551"],
  ])("matches the AWS SDK for %s", (endpoint, region, putSignature, deleteSignature) => {
    const credentials = { ...sdk.credentials, region };
    const signature = (url: string) => new URL(url).searchParams.get("X-Amz-Signature");
    expect(signature(presignUrl({
      method: "PUT", url: `${endpoint}/${sdk.key}?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&x-id=PutObject`, credentials, expiresInSeconds: 600, now: sdk.now,
      headers: { "Content-Type": "application/pdf", "Content-Length": "123456" },
    }))).toBe(putSignature);
    expect(signature(presignUrl({
      method: "DELETE", url: `${endpoint}/${sdk.key}?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&x-id=DeleteObject`, credentials, expiresInSeconds: 60, now: sdk.now,
    }))).toBe(deleteSignature);
  });

  it("signs extra headers in sorted order and keeps path-style URLs", () => {
    const url = new URL(presignUrl({
      method: "PUT",
      url: "https://abc.storage.supabase.co/storage/v1/s3/passclip/4f2a/ticket.pdf",
      expiresInSeconds: 600,
      headers: { "Content-Type": "application/pdf", "Content-Length": "1234" },
      ...awsExample,
    }));
    expect(url.pathname).toBe("/storage/v1/s3/passclip/4f2a/ticket.pdf");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives a different signature when a signed header changes", () => {
    const sign = (length: string) => new URL(presignUrl({ method: "PUT", url: "https://example.com/bucket/a.pdf", expiresInSeconds: 600, headers: { "content-length": length }, ...awsExample })).searchParams.get("X-Amz-Signature");
    expect(sign("10")).not.toBe(sign("11"));
  });

  it("includes a non-default port in the signed host", () => {
    const url = presignUrl({ method: "DELETE", url: "http://127.0.0.1:9000/bucket/a.pdf", expiresInSeconds: 60, ...awsExample });
    expect(url.startsWith("http://127.0.0.1:9000/bucket/a.pdf?")).toBe(true);
  });
});
