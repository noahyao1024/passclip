import { MAX_INPUT_BYTES } from "../import/parse";
import { processImport } from "../import/process";
import type { ProcessResult } from "../import/process";

export class RequestProblem extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
async function limitedText(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_INPUT_BYTES) throw new RequestProblem("This import is over 256 KB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestProblem("Send the JSON from your AI reply.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_INPUT_BYTES) { await reader.cancel(); throw new RequestProblem("This import is over 256 KB.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(joined);
}
export async function readImportRequest(request: Request): Promise<{ result: ProcessResult; index: number }> {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const allowedOrigins = new Set([new URL(request.url).origin]);
  // Next may construct an internal request URL behind a proxy. The configured
  // public address is authoritative; never trust a caller's forwarding headers.
  if (process.env.PUBLIC_BASE_URL) {
    try { allowedOrigins.add(new URL(process.env.PUBLIC_BASE_URL).origin); } catch { /* Invalid optional configuration isn't a new allowed origin. */ }
  }
  // Referrer-Policy: no-referrer makes Chromium serialize a form POST's Origin
  // as "null". Accept that only with the browser-controlled same-origin metadata;
  // cross-site forms and opaque origins without that evidence still fail.
  const opaqueSameOrigin = origin === "null" && fetchSite === "same-origin";
  if ((fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")
    || (origin && !allowedOrigins.has(origin) && !opaqueSameOrigin)) {
    throw new RequestProblem("Open Passclip to send this import.", 403);
  }
  const body = await limitedText(request);
  const type = request.headers.get("content-type")?.split(";")[0].trim();
  let text: string, fallbackTimeZone = "UTC", index = 0;
  if (type === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(body);
    text = form.get("import") ?? "";
    fallbackTimeZone = form.get("fallbackTimeZone") ?? "UTC";
    index = Number(form.get("index") ?? 0);
  } else if (type === "application/json") {
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { throw new RequestProblem("Send a valid JSON request."); }
    if (!payload || typeof payload !== "object" || !("text" in payload) || typeof payload.text !== "string") throw new RequestProblem("Send the AI reply in the text field.");
    text = payload.text;
    if ("fallbackTimeZone" in payload && typeof payload.fallbackTimeZone === "string") fallbackTimeZone = payload.fallbackTimeZone;
    if ("index" in payload) index = Number(payload.index);
  } else throw new RequestProblem("Use JSON or a form to send this import.", 415);
  if (!Number.isInteger(index) || index < 0) throw new RequestProblem("Choose a valid pass number.");
  const result = processImport(text, { fallbackTimeZone });
  return { result, index };
}

// Bounded process-local guard for development/single-instance hosting. Deployment must
// enforce a shared IP limit at its trusted ingress for multiple workers/instances.
const windows = new Map<string, { count: number; expires: number }>();
export function allowRequest(request: Request, now = Date.now()): boolean {
  // Client-supplied forwarding headers aren't authenticated here. One process-wide
  // bucket can't be bypassed by spoofing an IP; use a trusted ingress for per-IP limits.
  void request;
  const key = "generation";
  let window = windows.get(key);
  if (!window || now >= window.expires) { window = { count: 0, expires: now + 60_000 }; windows.set(key, window); }
  return ++window.count <= 30;
}
export function apiError(error: unknown): Response {
  const problem = error instanceof RequestProblem ? error : new RequestProblem("Couldn't make this pass. Check the signing setup and try again.", 500);
  return Response.json({ errors: [{ message: problem.message }] }, { status: problem.status, headers: { "Cache-Control": "no-store" } });
}
