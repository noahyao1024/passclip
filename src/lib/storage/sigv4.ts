import { createHash, createHmac } from "node:crypto";

// Presigned S3 URLs (AWS Signature Version 4, query-string form). Any S3-compatible storage
// accepts them: Supabase Storage, Cloudflare R2, AWS S3. Checked against the worked example in
// AWS's "Authenticating Requests: Using Query Parameters" (sigv4.test.ts, docs/DECISIONS.md D19).

export interface StorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface PresignOptions {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  /** The object's full URL, path-style or virtual-hosted. */
  url: string;
  credentials: StorageCredentials;
  expiresInSeconds: number;
  now: Date;
  /** Headers the request must send exactly (besides host), like content-type. */
  headers?: Record<string, string>;
}

const hash = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 encoding, as SigV4 needs: everything but A-Z a-z 0-9 - _ . ~ */
const encode = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/** Encodes each path segment once, keeping the slashes. */
const canonicalPath = (pathname: string) => pathname.split("/").map((segment) => encode(decodeURIComponent(segment))).join("/");

/** "20130524T000000Z" */
const amzDate = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function presignUrl({ method, url, credentials, expiresInSeconds, now, headers = {} }: PresignOptions): string {
  const target = new URL(url);
  const timestamp = amzDate(now);
  const day = timestamp.slice(0, 8);
  const scope = `${day}/${credentials.region}/s3/aws4_request`;

  const signed = new Map<string, string>([["host", target.host]]);
  for (const [name, value] of Object.entries(headers)) signed.set(name.toLowerCase(), value.trim().replace(/\s+/g, " "));
  const names = [...signed.keys()].sort();
  const signedHeaders = names.join(";");

  const query: [string, string][] = [
    ...[...target.searchParams.entries()],
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", timestamp],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  const canonicalQuery = query
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([a, aValue], [b, bValue]) => (a < b ? -1 : a > b ? 1 : aValue < bValue ? -1 : aValue > bValue ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const canonicalRequest = [
    method,
    canonicalPath(target.pathname),
    canonicalQuery,
    names.map((name) => `${name}:${signed.get(name)}\n`).join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, hash(canonicalRequest)].join("\n");

  const key = ["s3", "aws4_request"].reduce(
    (current, part) => hmac(current, part),
    hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region),
  );
  const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");

  return `${target.origin}${canonicalPath(target.pathname)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
