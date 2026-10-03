import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

describe("document security policy", () => {
  it("uses a fresh nonce for every production request and passes it to rendering", () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = proxy(new NextRequest("https://passclip.example/"));
    const second = proxy(new NextRequest("https://passclip.example/privacy"));
    const policy = first.headers.get("Content-Security-Policy")!;
    const nonce = policy.match(/'nonce-([^']+)'/)![1];

    expect(second.headers.get("Content-Security-Policy")).not.toBe(policy);
    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(policy).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(policy).toContain("img-src 'self' data:");
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("permits the development debugger and style loader only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = proxy(new NextRequest("http://localhost:3000/"));
    const policy = response.headers.get("Content-Security-Policy")!;
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("connect-src 'self' ws: wss:");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("upgrades requests only when the original connection uses HTTPS", () => {
    vi.stubEnv("NODE_ENV", "production");
    const http = proxy(new NextRequest("http://localhost:3000/"));
    const https = proxy(new NextRequest("http://localhost:3000/", {
      headers: { "x-forwarded-proto": "https" },
    }));
    expect(http.headers.get("Content-Security-Policy")).not.toContain("upgrade-insecure-requests");
    expect(https.headers.get("Content-Security-Policy")).toContain("upgrade-insecure-requests");
  });
});
