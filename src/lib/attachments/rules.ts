import type { Attachment } from "../import/types";

// What can be uploaded (docs/SPEC.md §9). Shared by the browser, which checks a file before it
// asks to upload, and the server, which checks again before it signs an upload link.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOADS_PER_PASS = 5;
/** The import format's limit for links of any kind on one pass. */
export const MAX_ATTACHMENTS_PER_PASS = 10;

export const ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic";

const TYPES = {
  "application/pdf": { extensions: ["pdf"], kind: "pdf" },
  "image/jpeg": { extensions: ["jpg", "jpeg"], kind: "image" },
  "image/png": { extensions: ["png"], kind: "image" },
  "image/heic": { extensions: ["heic"], kind: "image" },
} as const satisfies Record<string, { extensions: readonly string[]; kind: Attachment["kind"] }>;

export type AttachmentContentType = keyof typeof TYPES;

export interface FileFacts {
  name: string;
  /** The browser's guess at the type. Often empty for HEIC. */
  type: string;
  size: number;
}

export interface CheckedFile {
  contentType: AttachmentContentType;
  kind: "pdf" | "image";
  /** A safe file name for the link, like "Concert-ticket.pdf". */
  fileName: string;
  /** The name shown on the back of the pass, like "Concert ticket". */
  title: string;
  size: number;
}

const extensionOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();

function contentTypeOf({ name, type }: FileFacts): AttachmentContentType | undefined {
  const extension = extensionOf(name);
  const fromExtension = (Object.keys(TYPES) as AttachmentContentType[]).find((key) => (TYPES[key].extensions as readonly string[]).includes(extension ?? ""));
  const declared = type.toLowerCase();
  if (declared in TYPES) {
    // Trust the declared type only when the name agrees, or has no known extension.
    return !fromExtension || fromExtension === declared ? (declared as AttachmentContentType) : undefined;
  }
  // Browsers often send no type (or a generic one) for HEIC photos.
  return !declared || declared === "application/octet-stream" ? fromExtension : undefined;
}

/** Letters, numbers, dots, hyphens and underscores only, so links never need escaping. */
export function safeFileName(name: string, contentType: AttachmentContentType): string {
  const extension = TYPES[contentType].extensions[0];
  const base = name
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 80)
    .replace(/[-._]+$/, "");
  return `${base || "file"}.${extension}`;
}

export function attachmentTitle(name: string): string {
  const title = name.replace(/\.[^.]*$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(title || "Attached file").slice(0, 60).join("").trim();
}

export function checkFile(file: FileFacts): { ok: true; file: CheckedFile } | { ok: false; message: string } {
  const contentType = contentTypeOf(file);
  if (!contentType) return { ok: false, message: "Choose a PDF, JPEG, PNG or HEIC file." };
  if (!Number.isInteger(file.size) || file.size <= 0) return { ok: false, message: "This file is empty. Choose another file." };
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, message: "This file is over 10 MB. Choose a smaller file, or add a link to it in your JSON instead." };
  }
  return {
    ok: true,
    file: { contentType, kind: TYPES[contentType].kind, fileName: safeFileName(file.name, contentType), title: attachmentTitle(file.name), size: file.size },
  };
}

/** A file name as it appears in an upload's link and delete link. */
export function isSafeFileName(name: string): boolean {
  const extension = extensionOf(name);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.[a-z]+$/.test(name)
    && Object.values(TYPES).some((type) => (type.extensions as readonly string[]).includes(extension ?? ""));
}

// Delete links carry a secret token after the "#", which browsers never send to a server:
// https://passclip.example/delete-file#<token>/<file name>
export const DELETE_PAGE = "/delete-file";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isDeleteToken(token: string): boolean {
  return TOKEN.test(token);
}

export function readDeleteFragment(hash: string): { token: string; fileName: string } | undefined {
  const [token, fileName, ...rest] = hash.replace(/^#/, "").split("/");
  if (rest.length > 0 || !token || !fileName) return undefined;
  // Safe file names never need escaping, so there's nothing to decode.
  return isDeleteToken(token) && isSafeFileName(fileName) ? { token, fileName } : undefined;
}
