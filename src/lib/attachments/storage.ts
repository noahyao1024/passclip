import { createHash, randomBytes } from "node:crypto";
import type { StorageConfig } from "../storage/config";
import { presignUrl } from "../storage/sigv4";
import { checkFile, DELETE_PAGE, type FileFacts } from "./rules";

// Uploads go from the browser straight to the bucket with a short-lived signed link, because a
// 10 MB file is over the 4.5 MB request limit of Vercel Functions (docs/DECISIONS.md D19).
//
// Nothing is stored about an upload. Each file gets a random delete token, and its folder is a
// hash of that token: the public link can't be turned back into the token, and the token alone
// finds the file again. Only the person who uploaded the file sees the token, once.

const UPLOAD_SECONDS = 10 * 60;
const DELETE_SECONDS = 60;

export const newDeleteToken = () => randomBytes(32).toString("base64url");

/** 128 bits of the token's hash, as the file's folder name. */
export const folderFor = (token: string) => createHash("sha256").update(`passclip-attachment:${token}`).digest("hex").slice(0, 32);

const objectPath = (token: string, fileName: string) => `${folderFor(token)}/${fileName}`;

// The same query the AWS SDK signs, so storage services that test against it accept ours.
const s3Url = (config: StorageConfig, path: string, operation: "PutObject" | "DeleteObject") =>
  `${config.endpoint}/${config.bucket}/${path}?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&x-id=${operation}`;

const credentials = (config: StorageConfig) => ({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: config.region });

export interface UploadPlan {
  /** Where the browser sends the file, and the headers it must send with it. */
  upload: { method: "PUT"; url: string; headers: Record<string, string> };
  /** What goes into the pass's attachments once the upload finishes. */
  attachment: { title: string; url: string; kind: "pdf" | "image" };
  /** The delete page and its secret, like /delete-file#<token>/<file name>. Shown once, never stored. */
  deletePath: string;
}

export function planUpload(
  config: StorageConfig,
  facts: FileFacts,
  options: { now?: Date; token?: string } = {},
): { ok: true; plan: UploadPlan } | { ok: false; message: string } {
  const checked = checkFile(facts);
  if (!checked.ok) return checked;
  const { file } = checked;
  const token = options.token ?? newDeleteToken();
  const path = objectPath(token, file.fileName);
  // Signing the type and exact size means the link only accepts this file's bytes.
  const url = presignUrl({
    method: "PUT",
    url: s3Url(config, path, "PutObject"),
    credentials: credentials(config),
    expiresInSeconds: UPLOAD_SECONDS,
    now: options.now ?? new Date(),
    headers: { "content-type": file.contentType, "content-length": String(file.size) },
  });
  return {
    ok: true,
    plan: {
      upload: { method: "PUT", url, headers: { "Content-Type": file.contentType } },
      attachment: { title: file.title, url: `${config.publicUrl}/${path}`, kind: file.kind },
      deletePath: `${DELETE_PAGE}#${token}/${file.fileName}`,
    },
  };
}

/** A signed link that deletes the file, valid for a minute. Used by the server only. */
export function deleteUrlFor(config: StorageConfig, token: string, fileName: string, now = new Date()): string {
  return presignUrl({ method: "DELETE", url: s3Url(config, objectPath(token, fileName), "DeleteObject"), credentials: credentials(config), expiresInSeconds: DELETE_SECONDS, now });
}
