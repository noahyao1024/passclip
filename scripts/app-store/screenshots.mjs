// Screenshot preflight and Apple's reserve/upload/commit/verify sequence.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PNG } from "pngjs";
import { api } from "./asc-lib.mjs";

// The two display targets emitted by frame-screenshots.ts. Include their accepted landscape sizes.
const targets = [
  { prefix: "iphone-", displayType: "APP_IPHONE_67", sizes: [[1260, 2736], [1290, 2796], [1320, 2868]] },
  { prefix: "ipad-", displayType: "APP_IPAD_PRO_3GEN_129", sizes: [[2064, 2752], [2048, 2732]] },
];

function imageSize(bytes, name) {
  if (/\.png$/i.test(name)) {
    const image = PNG.sync.read(bytes, { checkCRC: true });
    if (image.alpha || image.data.some((value, index) => index % 4 === 3 && value !== 255)) throw new Error(`${name}: remove the alpha channel/transparency before uploading`);
    return [image.width, image.height];
  }
  // JPEGs have no alpha. Check the markers, complete header, dimensions and end marker.
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw new Error(`${name}: invalid or truncated JPEG`);
  let size;
  for (let offset = 2; offset < bytes.length - 2;) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) size = [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    if (marker === 0xda && size) return size;
    offset += length;
  }
  throw new Error(`${name}: invalid JPEG header`);
}

export function readScreenshots(folder) {
  const names = readdirSync(folder).filter((name) => /\.(png|jpe?g)$/i.test(name)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!names.length) throw new Error("no screenshots found; use iphone-*.jpg/png and/or ipad-*.jpg/png");
  const groups = targets.map((target) => ({ ...target, files: [] }));
  for (const name of names) {
    const group = groups.find((target) => name.startsWith(target.prefix));
    if (!group) throw new Error(`${name}: screenshot names must start with iphone- or ipad-`);
    const path = join(folder, name);
    if (!statSync(path).isFile()) throw new Error(`${name}: expected a screenshot file`);
    const bytes = readFileSync(path);
    let size;
    try { size = imageSize(bytes, name); } catch (error) { throw new Error(`${name}: screenshot preflight failed: ${error.message}`); }
    if (!group.sizes.some(([w, h]) => (size[0] === w && size[1] === h) || (size[0] === h && size[1] === w))) throw new Error(`${name}: ${size.join(" × ")} is not an accepted size for ${group.displayType}`);
    group.files.push({ name, bytes });
    if (group.files.length > 10) throw new Error(`${group.displayType}: at most 10 screenshots are allowed`);
  }
  return groups.filter((group) => group.files.length);
}

export async function uploadScreenshot(setId, file) {
  const { data: shot } = await api("POST", "/v1/appScreenshots", { data: { type: "appScreenshots", attributes: { fileName: file.name, fileSize: file.bytes.length }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } } } });
  const operations = shot.attributes.uploadOperations;
  // A reservation must cover the whole file exactly once; check before sending any part.
  let end = 0;
  for (const op of [...(operations ?? [])].sort((a, b) => a.offset - b.offset)) {
    if (!Number.isSafeInteger(op.offset) || !Number.isSafeInteger(op.length) || op.offset !== end || op.length <= 0 || op.offset + op.length > file.bytes.length) throw new Error(`${file.name}: invalid screenshot upload byte ranges`);
    end += op.length;
  }
  if (end !== file.bytes.length) throw new Error(`${file.name}: incomplete screenshot upload byte ranges`);
  for (const op of operations) {
    let response;
    try {
      response = await fetch(op.url, { method: op.method, headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])), body: file.bytes.subarray(op.offset, op.offset + op.length), signal: AbortSignal.timeout(60_000) });
    } catch {
      // Upload URLs contain temporary credentials. Never include them in errors or logs.
      throw new Error(`${file.name}: screenshot upload request failed or timed out`);
    }
    if (!response.ok) throw new Error(`${file.name}: screenshot upload failed (HTTP ${response.status})`);
  }
  await api("PATCH", `/v1/appScreenshots/${shot.id}`, { data: { type: "appScreenshots", id: shot.id, attributes: { uploaded: true, sourceFileChecksum: createHash("md5").update(file.bytes).digest("hex") } } });
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await api("GET", `/v1/appScreenshots/${shot.id}`);
    const state = result.data.attributes.assetDeliveryState;
    if (state?.state === "COMPLETE") return;
    if (state?.state === "FAILED") throw new Error(`${file.name}: screenshot processing failed: ${(state.errors ?? []).map((e) => e.description ?? e.code).join("; ")}`);
    if (attempt < 59) await delay(2000);
  }
  throw new Error(`${file.name}: timed out waiting for screenshot processing; check App Store Connect before retrying`);
}
