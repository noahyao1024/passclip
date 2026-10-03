import { deleteUrlFor, newDeleteToken, planUpload } from "../../src/lib/attachments/storage";
import type { StorageConfig } from "../../src/lib/storage/config";

// The round trip behind `npm run check:storage`: upload a tiny image with a signed link, read it
// back from the public address, check that browsers on the site may upload (CORS), then delete
// it. Each step says what to fix. Secrets are never printed.

// A 1×1 transparent PNG.
const TEST_IMAGE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export interface CheckLine { ok: boolean | "note"; message: string }

const storageCode = async (response: Response) => /<Code>([^<]{1,80})<\/Code>/.exec(await response.text().catch(() => ""))?.[1];

export async function runStorageCheck(config: StorageConfig, siteOrigin: string, fetcher: typeof fetch = fetch): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];
  const token = newDeleteToken();
  const planned = planUpload(config, { name: "passclip-storage-check.png", type: "image/png", size: TEST_IMAGE.length }, { token });
  if (!planned.ok) return [{ ok: false, message: planned.message }];
  const { upload, attachment } = planned.plan;

  const preflight = await fetcher(upload.url, {
    method: "OPTIONS",
    headers: { Origin: siteOrigin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
  }).catch(() => undefined);
  const allowed = preflight?.headers.get("access-control-allow-origin");
  lines.push(preflight?.ok && (allowed === "*" || allowed === siteOrigin)
    ? { ok: true, message: `Browsers on ${siteOrigin} may upload to the bucket.` }
    : { ok: false, message: `The bucket doesn't let browsers on ${siteOrigin} upload. Add a CORS rule that allows PUT with the Content-Type header from that address (docs/LAUNCH.md).` });

  let put: Response;
  try {
    put = await fetcher(upload.url, { method: "PUT", headers: upload.headers, body: TEST_IMAGE });
  } catch {
    return [...lines, { ok: false, message: "Couldn't reach STORAGE_ENDPOINT. Check the address and your connection." }];
  }
  if (!put.ok) {
    const code = await storageCode(put);
    return [...lines, { ok: false, message: `Storage refused the upload (${put.status}${code ? ` ${code}` : ""}). Check STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_REGION and STORAGE_BUCKET.` }];
  }
  lines.push({ ok: true, message: "Uploaded a test image with a signed link." });

  const read = await fetcher(attachment.url).catch(() => undefined);
  const bytes = read?.ok ? Buffer.from(await read.arrayBuffer()) : undefined;
  lines.push(bytes?.equals(TEST_IMAGE)
    ? { ok: true, message: "Read it back from STORAGE_PUBLIC_URL." }
    : { ok: false, message: `Couldn't read the test image at STORAGE_PUBLIC_URL${read ? ` (${read.status})` : ""}. Make the bucket public, and check that the address ends with the bucket's name.` });

  const removed = await fetcher(deleteUrlFor(config, token, "passclip-storage-check.png"), { method: "DELETE" }).catch(() => undefined);
  if (!removed?.ok) {
    lines.push({ ok: false, message: `Couldn't delete the test image${removed ? ` (${removed.status})` : ""}. Check that the access key may delete files.` });
    return lines;
  }
  lines.push({ ok: true, message: "Deleted it again." });

  const gone = await fetcher(attachment.url).catch(() => undefined);
  if (gone?.ok) lines.push({ ok: "note", message: "The deleted image still opens, probably from a cache. Check that it's gone in a few minutes." });
  return lines;
}
