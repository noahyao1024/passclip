// File upload settings (docs/SPEC.md §9, docs/DECISIONS.md D19). Uploads are off until every
// setting is present, like pass signing. The storage is any S3-compatible bucket.

export type Env = Readonly<Record<string, string | undefined>>;

export interface StorageConfig {
  /** The S3 API address, like https://<project>.storage.supabase.co/storage/v1/s3. No trailing slash. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Where files can be read publicly, like https://<project>.supabase.co/storage/v1/object/public/<bucket>. No trailing slash. */
  publicUrl: string;
}

export const STORAGE_SETTINGS = [
  "STORAGE_ENDPOINT",
  "STORAGE_REGION",
  "STORAGE_BUCKET",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "STORAGE_PUBLIC_URL",
] as const;

export type StorageResult =
  | { ok: true; config: StorageConfig }
  | { ok: false; missing: string[]; problems: string[] };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** Reads the settings. Never includes secret values in its problems. */
export function readStorageConfig(env: Env): StorageResult {
  const values = Object.fromEntries(STORAGE_SETTINGS.map((name) => [name, env[name]?.trim() ?? ""])) as Record<(typeof STORAGE_SETTINGS)[number], string>;
  const missing = STORAGE_SETTINGS.filter((name) => !values[name]);
  if (missing.length > 0) return { ok: false, missing, problems: [] };

  const problems: string[] = [];
  const endpoint = parseUrl(values.STORAGE_ENDPOINT);
  // Plain http is only for a storage server on this computer, like Supabase's local stack.
  if (!endpoint || !(endpoint.protocol === "https:" || (endpoint.protocol === "http:" && LOCAL_HOSTS.has(endpoint.hostname))) || endpoint.search || endpoint.hash) {
    problems.push("STORAGE_ENDPOINT must be the storage's S3 address, starting with https://.");
  }
  const publicUrl = parseUrl(values.STORAGE_PUBLIC_URL);
  // Links on a pass must be https (the import schema only allows https links).
  if (!publicUrl || publicUrl.protocol !== "https:" || publicUrl.search || publicUrl.hash) {
    problems.push("STORAGE_PUBLIC_URL must be the https:// address where the bucket's files can be read.");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(values.STORAGE_BUCKET)) {
    problems.push("STORAGE_BUCKET must be a bucket name: 3 to 63 lowercase letters, numbers, dots or hyphens.");
  }
  if (!/^[a-z0-9-]+$/.test(values.STORAGE_REGION)) {
    problems.push("STORAGE_REGION must be the storage's region, like eu-central-1 (or auto for Cloudflare R2).");
  }
  if (problems.length > 0) return { ok: false, missing: [], problems };

  const trim = (url: string) => url.replace(/\/+$/, "");
  return {
    ok: true,
    config: {
      endpoint: trim(values.STORAGE_ENDPOINT),
      bucket: values.STORAGE_BUCKET,
      region: values.STORAGE_REGION,
      accessKeyId: values.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: values.STORAGE_SECRET_ACCESS_KEY,
      publicUrl: trim(values.STORAGE_PUBLIC_URL),
    },
  };
}

export function uploadsAvailable(env: Env): boolean {
  return readStorageConfig(env).ok;
}
