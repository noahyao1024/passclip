import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./asc-lib.mjs";
import { run } from "./asc-release.mjs";
import { uploadScreenshot } from "./screenshots.mjs";

vi.mock("./asc-lib.mjs", () => ({ api: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

const app = "6819692153";
const versions = `/v1/apps/${app}/appStoreVersions?filter[platform]=IOS&fields[appStoreVersions]=versionString,appStoreState,releaseType&limit=200`;
const submissions = `/v1/apps/${app}/reviewSubmissions?filter[platform]=IOS&limit=200`;
const items = (id: string) => `/v1/reviewSubmissions/${id}/items?include=appStoreVersion&limit=200`;
const version = (id = "requested", name = "1.2", state = "PREPARE_FOR_SUBMISSION") => ({ id, attributes: { versionString: name, appStoreState: state } });
const submission = (id: string, state = "READY_FOR_REVIEW") => ({ id, attributes: { state, platform: "IOS" } });
const item = (id: string) => ({ id: `item-${id}`, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id } } } });
const patchSubmission = (id: string, attributes: object) => ({ data: { type: "reviewSubmissions", id, attributes } });

type Step = { method: string; path: string; body?: unknown; response?: unknown; error?: Error };
let remaining: Step[];
function sequence(steps: Step[]) {
  remaining = [...steps];
  vi.mocked(api).mockImplementation(async (method, path, body) => {
    const step = remaining.shift();
    expect([method, path]).toEqual([step?.method, step?.path]);
    if (step && "body" in step) expect(body).toEqual(step.body);
    if (step?.error) throw step.error;
    return step?.response ?? {};
  });
}
const getVersions = (): Step => ({ method: "GET", path: versions, response: { data: [version("live", "1.1", "READY_FOR_SALE"), version()] } });

let folder: string;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  folder = mkdtempSync(join(tmpdir(), "passclip-release-test-"));
  sequence([]);
  // Any unmocked asset upload fails immediately; no test can send a live request.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unexpected upload")));
});
afterEach(() => {
  expect(remaining).toEqual([]);
  rmSync(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("version selection and command validation", () => {
  it("finds the requested iOS version on a later page when attaching a build", async () => {
    sequence([
      { method: "GET", path: versions, response: { data: [version("live", "1.1")], links: { next: `https://api.appstoreconnect.apple.com/v1/apps/${app}/appStoreVersions?cursor=next` } } },
      { method: "GET", path: `/v1/apps/${app}/appStoreVersions?cursor=next`, response: { data: [version()] } },
      { method: "GET", path: `/v1/builds?filter[app]=${app}&filter[version]=42&fields[builds]=version,processingState`, response: { data: [{ id: "build-42", attributes: { processingState: "VALID" } }] } },
      { method: "PATCH", path: "/v1/appStoreVersions/requested/relationships/build", body: { data: { type: "builds", id: "build-42" } } },
    ]);
    await run(["build", "1.2", "42"]);
  });

  it("does not mutate anything when the requested version is absent", async () => {
    sequence([{ method: "GET", path: versions, response: { data: [version("live", "1.1")] } }]);
    await expect(run(["cancel", "1.2"])).rejects.toThrow("version 1.2 not found");
  });

  it.each([["submit"], ["cancel"], ["screenshots", "1.2"], ["status", "1.2"], ["submit", " "], ["constructor"]])("rejects incomplete or unexpected arguments: %s", async (...args) => {
    await expect(run(args)).rejects.toThrow("usage:");
    expect(api).not.toHaveBeenCalled();
  });

  it("returns a failing CLI exit code without reading credentials on bad arguments", () => {
    expect(() => execFileSync(process.execPath, [join(__dirname, "asc-release.mjs"), "screenshots", "1.2"], { stdio: "pipe" })).toThrow(expect.objectContaining({ status: 1, stderr: expect.any(Buffer) }));
  });
});

describe("review submission requests", () => {
  const addItem = (id: string): Step => ({ method: "POST", path: "/v1/reviewSubmissionItems", body: { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id } }, appStoreVersion: { data: { type: "appStoreVersions", id: "requested" } } } } } });
  const send = (id: string): Step => ({ method: "PATCH", path: `/v1/reviewSubmissions/${id}`, body: patchSubmission(id, { submitted: true }) });

  it("creates, attaches the requested version, then submits when no draft exists", async () => {
    sequence([
      getVersions(),
      { method: "GET", path: submissions, response: { data: [] } },
      { method: "POST", path: "/v1/reviewSubmissions", body: { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: app } } } } }, response: { data: submission("new") } },
      addItem("new"), send("new"),
    ]);
    await run(["submit", "1.2"]);
  });

  it("reuses an empty draft instead of creating a submission", async () => {
    sequence([
      getVersions(),
      { method: "GET", path: submissions, response: { data: [submission("draft")] } },
      { method: "GET", path: items("draft"), response: { data: [] } },
      addItem("draft"), send("draft"),
    ]);
    await run(["submit", "1.2"]);
  });

  it("reuses the draft already holding this version without duplicating the item", async () => {
    sequence([
      getVersions(),
      { method: "GET", path: submissions, response: { data: [submission("other"), submission("draft")] } },
      { method: "GET", path: items("other"), response: { data: [item("different-version")] } },
      { method: "GET", path: items("draft"), response: { data: [item("requested")] } },
      send("draft"),
    ]);
    await run(["submit", "1.2"]);
  });

  it.each([
    { data: [item("different-version")], error: "draft submission belongs to other items" },
    { data: [item("requested"), { id: "event-item" }], error: "includes other items" },
  ])("refuses a draft that could submit unrelated work: $error", async ({ data, error }) => {
    sequence([getVersions(), { method: "GET", path: submissions, response: { data: [submission("draft")] } }, { method: "GET", path: items("draft"), response: { data } }]);
    await expect(run(["submit", "1.2"])).rejects.toThrow(error);
  });

  it("refuses ambiguous empty drafts", async () => {
    sequence([getVersions(), { method: "GET", path: submissions, response: { data: [submission("a"), submission("b")] } }, { method: "GET", path: items("a"), response: { data: [] } }, { method: "GET", path: items("b"), response: { data: [] } }]);
    await expect(run(["submit", "1.2"])).rejects.toThrow("multiple draft submissions");
  });

  it("propagates a draft lookup failure without creating a replacement", async () => {
    sequence([getVersions(), { method: "GET", path: submissions, error: new Error("API unavailable") }]);
    await expect(run(["submit", "1.2"])).rejects.toThrow("API unavailable");
  });

  it("cancels the requested version even when another submission is listed first", async () => {
    sequence([
      getVersions(),
      { method: "GET", path: submissions, response: { data: [submission("other", "WAITING_FOR_REVIEW"), submission("target", "IN_REVIEW"), submission("complete", "COMPLETE")] } },
      { method: "GET", path: items("other"), response: { data: [item("different-version")] } },
      { method: "GET", path: items("target"), response: { data: [], links: { next: "https://api.appstoreconnect.apple.com/v1/reviewSubmissions/target/items?cursor=next" } } },
      { method: "GET", path: "/v1/reviewSubmissions/target/items?cursor=next", response: { data: [item("requested")] } },
      { method: "PATCH", path: "/v1/reviewSubmissions/target", body: patchSubmission("target", { canceled: true }) },
    ]);
    await run(["cancel", "1.2"]);
  });

  it.each([
    { data: [item("different-version")], error: "found 0" },
    { data: [item("requested"), { id: "event-item" }], error: "includes other items" },
  ])("does not cancel other versions or shared submissions: $error", async ({ data, error }) => {
    sequence([getVersions(), { method: "GET", path: submissions, response: { data: [submission("target", "WAITING_FOR_REVIEW")] } }, { method: "GET", path: items("target"), response: { data } }]);
    await expect(run(["cancel", "1.2"])).rejects.toThrow(error);
  });
});

function png(width: number, height: number, alpha = false) {
  return PNG.sync.write({ width, height, data: Buffer.alloc(width * height * 4, 255) } as PNG, { colorType: alpha ? 6 : 2 });
}
const iphone = png(1320, 2868);
const ipad = png(2064, 2752);
const locs = "/v1/appStoreVersions/requested/appStoreVersionLocalizations?limit=200";
const sets = "/v1/appStoreVersionLocalizations/en-US/appScreenshotSets?limit=200";
const set = { id: "iphone-set", attributes: { screenshotDisplayType: "APP_IPHONE_67" } };
const screenshotReads = (): Step[] => [
  getVersions(),
  { method: "GET", path: locs, response: { data: [{ id: "en-US", attributes: { locale: "en-US" } }] } },
  { method: "GET", path: sets, response: { data: [set] } },
  { method: "GET", path: "/v1/appScreenshotSets/iphone-set/appScreenshots?limit=200", response: { data: [{ id: "old-shot" }] } },
];
const reserve = (bytes = iphone, name = "iphone-1.png", setId = "iphone-set"): Step => ({
  method: "POST", path: "/v1/appScreenshots",
  body: { data: { type: "appScreenshots", attributes: { fileName: name, fileSize: bytes.length }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } } } },
  response: { data: { id: "new-shot", attributes: { uploadOperations: [
    { method: "PUT", url: "https://upload.invalid/part-1?secret=test", offset: 0, length: 50, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
    { method: "PUT", url: "https://upload.invalid/part-2?secret=test", offset: 50, length: bytes.length - 50, requestHeaders: [] },
  ] } } },
});
const commit = (bytes = iphone): Step => ({ method: "PATCH", path: "/v1/appScreenshots/new-shot", body: { data: { type: "appScreenshots", id: "new-shot", attributes: { uploaded: true, sourceFileChecksum: createHash("md5").update(bytes).digest("hex") } } } });
const processing = (state: string): Step => ({ method: "GET", path: "/v1/appScreenshots/new-shot", response: { data: { attributes: { assetDeliveryState: { state } } } } });

describe("screenshot replacement", () => {
  it("checks all local inputs before making API requests", async () => {
    writeFileSync(join(folder, "iphone-1.png"), iphone);
    writeFileSync(join(folder, "ipad-1.png"), "not an image");
    await expect(run(["screenshots", "1.2", folder])).rejects.toThrow("preflight failed");
    expect(api).not.toHaveBeenCalled();
  });

  it.each(["empty", "wrong-size", "alpha", "truncated-jpeg", "directory", "unknown-prefix", "too-many"])("rejects %s input before deleting anything", async (kind) => {
    if (kind === "wrong-size") writeFileSync(join(folder, "iphone-1.png"), png(32, 32));
    if (kind === "alpha") writeFileSync(join(folder, "iphone-1.png"), png(1320, 2868, true));
    if (kind === "truncated-jpeg") writeFileSync(join(folder, "iphone-1.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
    if (kind === "directory") mkdirSync(join(folder, "iphone-1.png"));
    if (kind === "unknown-prefix") writeFileSync(join(folder, "duo-1.png"), iphone);
    if (kind === "too-many") for (let i = 0; i < 11; i++) writeFileSync(join(folder, `iphone-${i}.png`), iphone);
    await expect(run(["screenshots", "1.2", folder])).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
  });

  it("refuses to replace assets on the released version", async () => {
    writeFileSync(join(folder, "iphone-1.png"), iphone);
    sequence([getVersions()]);
    await expect(run(["screenshots", "1.1", folder])).rejects.toThrow("READY_FOR_SALE");
  });

  it("refuses a missing locale instead of changing another localization", async () => {
    writeFileSync(join(folder, "iphone-1.png"), iphone);
    sequence([getVersions(), { method: "GET", path: locs, response: { data: [{ id: "other", attributes: { locale: "es-MX" } }] } }]);
    await expect(run(["screenshots", "1.2", folder])).rejects.toThrow("en-US localization not found");
  });

  it("reserves, uploads each byte range with the supplied headers, commits the checksum, and waits for COMPLETE", async () => {
    writeFileSync(join(folder, "iphone-1.png"), iphone);
    sequence([...screenshotReads(), { method: "DELETE", path: "/v1/appScreenshots/old-shot" }, reserve(), commit(), processing("UPLOAD_COMPLETE"), processing("COMPLETE")]);
    const upload = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", upload);
    await run(["screenshots", "1.2", folder]);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(1, "https://upload.invalid/part-1?secret=test", { method: "PUT", headers: { "Content-Type": "image/png" }, body: iphone.subarray(0, 50), signal: expect.any(AbortSignal) });
    expect(upload).toHaveBeenNthCalledWith(2, "https://upload.invalid/part-2?secret=test", { method: "PUT", headers: {}, body: iphone.subarray(50), signal: expect.any(AbortSignal) });
    expect(console.log).toHaveBeenCalledWith("screenshots complete:", "1.2", "en-US", "APP_IPHONE_67", 1);
  });

  it("creates a missing set on the requested locale and version", async () => {
    writeFileSync(join(folder, "ipad-1.png"), ipad);
    sequence([
      getVersions(),
      { method: "GET", path: locs, response: { data: [{ id: "spanish", attributes: { locale: "es-MX" } }] } },
      { method: "GET", path: "/v1/appStoreVersionLocalizations/spanish/appScreenshotSets?limit=200", response: { data: [] } },
      { method: "POST", path: "/v1/appScreenshotSets", body: { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: "APP_IPAD_PRO_3GEN_129" }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: "spanish" } } } } }, response: { data: { id: "ipad-set" } } },
      reserve(ipad, "ipad-1.png", "ipad-set"), commit(ipad), processing("COMPLETE"),
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await run(["screenshots", "1.2", folder, "es-MX"]);
  });

  it.each(["http-error", "network-timeout"])("stops after an upload %s without committing or logging success", async (failure) => {
    writeFileSync(join(folder, "iphone-1.png"), iphone);
    sequence([...screenshotReads(), { method: "DELETE", path: "/v1/appScreenshots/old-shot" }, reserve()]);
    const upload = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }));
    if (failure === "http-error") upload.mockResolvedValueOnce(new Response(null, { status: 503 }));
    else upload.mockRejectedValueOnce(new DOMException("https://upload.invalid/?secret=test", "TimeoutError"));
    vi.stubGlobal("fetch", upload);
    await expect(run(["screenshots", "1.2", folder])).rejects.toThrow(failure === "http-error" ? "HTTP 503" : "request failed or timed out");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("reports failed processing", async () => {
    sequence([reserve(), commit(), processing("FAILED")]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(uploadScreenshot("iphone-set", { name: "iphone-1.png", bytes: iphone })).rejects.toThrow("screenshot processing failed");
  });

  it("reports a processing timeout as failure instead of successful completion", async () => {
    sequence([reserve(), commit(), ...Array.from({ length: 60 }, () => processing("UPLOAD_COMPLETE"))]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(uploadScreenshot("iphone-set", { name: "iphone-1.png", bytes: iphone })).rejects.toThrow("timed out waiting for screenshot processing");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("refuses incomplete upload operations without sending or committing bytes", async () => {
    const reservation = reserve();
    reservation.response = { data: { id: "new-shot", attributes: { uploadOperations: [] } } };
    sequence([reservation]);
    await expect(uploadScreenshot("iphone-set", { name: "iphone-1.png", bytes: iphone })).rejects.toThrow("incomplete screenshot upload byte ranges");
    expect(fetch).not.toHaveBeenCalled();
  });
});
