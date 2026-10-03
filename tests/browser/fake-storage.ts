import { createServer } from "node:http";
import { presignUrl } from "../../src/lib/storage/sigv4";
import { FAKE_STORAGE } from "./fake-storage-settings";

// A stand-in S3 bucket for the browser tests (port 3102). It checks each presigned request the
// way real storage does: the signature must match the method, path, query and the headers the
// browser actually sent (so a wrong type or size is refused), and the link must not have expired.
// GET /__objects lists what's stored, for the tests to check.

const objects = new Map<string, { type: string; size: number }>();

function verify(method: "PUT" | "DELETE", url: URL, headers: Record<string, string | string[] | undefined>): boolean {
  const query = url.searchParams;
  const date = query.get("X-Amz-Date") ?? "";
  const now = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
  const expires = Number(query.get("X-Amz-Expires"));
  if (Number.isNaN(now.getTime()) || !(expires > 0) || Date.now() > now.getTime() + expires * 1000) return false;

  const unsigned = new URL(url.pathname, url.origin);
  for (const [key, value] of query) if (!/^X-Amz-(Algorithm|Credential|Date|Expires|SignedHeaders|Signature)$/.test(key)) unsigned.searchParams.append(key, value);
  const signedHeaders: Record<string, string> = {};
  for (const name of (query.get("X-Amz-SignedHeaders") ?? "").split(";")) {
    if (name === "host") continue;
    const value = headers[name];
    if (typeof value !== "string") return false;
    signedHeaders[name] = value;
  }
  const expected = new URL(presignUrl({
    method,
    url: unsigned.toString(),
    credentials: FAKE_STORAGE,
    expiresInSeconds: expires,
    now,
    headers: signedHeaders,
  })).searchParams.get("X-Amz-Signature");
  return query.get("X-Amz-Credential")?.startsWith(`${FAKE_STORAGE.accessKeyId}/`) === true && expected === query.get("X-Amz-Signature");
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${FAKE_STORAGE.port}`);
  const cors = request.headers.origin === FAKE_STORAGE.siteOrigin
    ? { "Access-Control-Allow-Origin": FAKE_STORAGE.siteOrigin, "Access-Control-Allow-Methods": "PUT", "Access-Control-Allow-Headers": "content-type", "Vary": "Origin" }
    : {};
  const key = url.pathname.slice(`/${FAKE_STORAGE.bucket}/`.length);

  if (request.method === "GET" && url.pathname === "/__objects") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(Object.fromEntries(objects)));
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(cors["Access-Control-Allow-Origin"] ? 204 : 403, cors).end();
    return;
  }
  if (!url.pathname.startsWith(`/${FAKE_STORAGE.bucket}/`) || (request.method !== "PUT" && request.method !== "DELETE")) {
    response.writeHead(404, cors).end();
    return;
  }
  if (!verify(request.method, url, request.headers)) {
    request.resume();
    response.writeHead(403, cors).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
    return;
  }
  if (request.method === "DELETE") {
    objects.delete(key);
    response.writeHead(204, cors).end();
    return;
  }
  let size = 0;
  request.on("data", (chunk: Buffer) => { size += chunk.length; });
  request.on("end", () => {
    if (size !== Number(request.headers["content-length"])) {
      response.writeHead(400, cors).end();
      return;
    }
    objects.set(key, { type: String(request.headers["content-type"]), size });
    response.writeHead(200, cors).end();
  });
});

server.listen(FAKE_STORAGE.port, "127.0.0.1");
