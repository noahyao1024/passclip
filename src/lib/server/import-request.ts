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

// Rate limit for pass, calendar and import requests: 30 a minute per visitor (docs/SPEC.md §11).
// A visitor's IP comes only from a header the host sets and visitors can't fake: on Vercel,
// x-vercel-forwarded-for (Vercel overwrites client-sent values, checked 2026-10-03, D18), or the
// header named in RATE_LIMIT_IP_HEADER elsewhere. Without one, everyone shares one budget, since
// any other header could be spoofed. Counts live in each server instance's memory; for one shared
// limit across instances, add a rate-limit rule at the host (on Vercel, a Firewall rule).
const LIMIT_PER_MINUTE = 30;
const MAX_TRACKED = 10_000;
const windows = new Map<string, { count: number; expires: number }>();

function trustedIpHeader(env: Readonly<Record<string, string | undefined>>): string | undefined {
  if (env.RATE_LIMIT_IP_HEADER?.trim()) return env.RATE_LIMIT_IP_HEADER.trim().toLowerCase();
  return env.VERCEL === "1" ? "x-vercel-forwarded-for" : undefined;
}

export function allowRequest(request: Request, now = Date.now(), env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const header = trustedIpHeader(env);
  const ip = header ? request.headers.get(header)?.split(",")[0]?.trim() : undefined;
  const key = ip ? `ip:${ip}` : "everyone";
  if (windows.size > MAX_TRACKED) {
    for (const [known, window] of windows) if (now >= window.expires) windows.delete(known);
  }
  let window = windows.get(key);
  if (!window || now >= window.expires) {
    window = { count: 0, expires: now + 60_000 };
    windows.set(key, window);
  }
  return ++window.count <= LIMIT_PER_MINUTE;
}

/** Browser forms navigate to the response, so they get a readable page; the iOS app gets JSON. */
function isFormRequest(request?: Request) {
  return request?.headers.get("content-type")?.split(";")[0].trim() === "application/x-www-form-urlencoded";
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function errorPage(errors: { message: string }[]): string {
  const items = errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join("");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fix this, then try again · Passclip</title></head>
<body>
<main>
<h1>Fix this, then try again</h1>
<ul>${items}</ul>
<p>Use your browser’s Back button to return to your passes, or <a href="/">start again on Passclip</a>.</p>
</main>
</body>
</html>
`;
}

/** Errors as JSON for the app, or as a plain page for browser forms. Never includes request content. */
export function errorResponse(request: Request | undefined, errors: { message: string }[], status: number): Response {
  if (isFormRequest(request)) {
    return new Response(errorPage(errors), {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // The page has no scripts, styles or images, so it allows none.
        "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  }
  return Response.json({ errors }, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiError(error: unknown, request?: Request): Response {
  const problem = error instanceof RequestProblem ? error : new RequestProblem("Couldn't make this file. Try again in a moment.", 500);
  return errorResponse(request, [{ message: problem.message }], problem.status);
}
