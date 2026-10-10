/**
 * A picture for the pass (Wallet's thumbnail: an event poster, next to the title). The iPhone app makes the three
 * PNG files itself; the server only checks they are what they claim to be and puts them in the pass. Nothing is
 * stored. Apple's Human Interface Guidelines (checked 2026-10-10, D30): thumbnails are 60 to 90 points wide and
 * 90 high, on event tickets and generic passes.
 */
export const THUMBNAIL_FILES = { "thumbnail.png": 1, "thumbnail@2x.png": 2, "thumbnail@3x.png": 3 } as const;
export type ThumbnailFiles = Record<keyof typeof THUMBNAIL_FILES, Buffer>;
export const MAX_THUMBNAIL_BYTES = 300 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Checks the app's picture files: all three, PNG, the right size. Returns a plain-English problem otherwise. */
export function readThumbnails(input: unknown): { files: ThumbnailFiles } | { problem: string } {
  const problem = "The picture couldn't be added. Choose it again, or add the pass without it.";
  if (!input || typeof input !== "object" || Array.isArray(input)) return { problem };
  const entries = Object.entries(input);
  const names = Object.keys(THUMBNAIL_FILES);
  if (entries.length !== names.length || !entries.every(([name]) => names.includes(name))) return { problem };
  const files: Partial<ThumbnailFiles> = {};
  for (const [name, value] of entries) {
    if (typeof value !== "string" || value.length > MAX_THUMBNAIL_BYTES * 1.4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return { problem };
    const bytes = Buffer.from(value, "base64");
    if (bytes.length > MAX_THUMBNAIL_BYTES || bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString("ascii", 12, 16) !== "IHDR") return { problem };
    const scale = THUMBNAIL_FILES[name as keyof typeof THUMBNAIL_FILES];
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (height !== 90 * scale || width < 60 * scale || width > 90 * scale) return { problem };
    files[name as keyof typeof THUMBNAIL_FILES] = bytes;
  }
  return { files: files as ThumbnailFiles };
}
