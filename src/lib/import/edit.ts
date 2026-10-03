import { parseImportText } from "./parse";
import type { Barcode } from "./types";

/**
 * Puts a barcode the user confirmed (decoded from a screenshot or typed) into pass `passIndex`
 * of their pasted JSON, so the JSON stays the single source for the preview and the pass.
 * Returns undefined when the text can't be read or has no such pass. The message is kept
 * exactly; the old text under the code is kept only if the message didn't change.
 */
export function withBarcode(text: string, passIndex: number, barcode: Pick<Barcode, "format" | "message">): string | undefined {
  const parsed = parseImportText(text);
  if (!parsed.ok) return undefined;
  const data = parsed.data as { passes?: unknown };
  const pass = Array.isArray(data.passes) ? data.passes[passIndex] : undefined;
  if (typeof pass !== "object" || pass === null || Array.isArray(pass)) return undefined;

  const record = pass as Record<string, unknown>;
  const previous = record.barcode as Partial<Barcode> | undefined;
  const altText = previous?.message === barcode.message ? previous.altText : undefined;
  record.barcode = { format: barcode.format, message: barcode.message, ...(altText ? { altText } : {}) };
  return JSON.stringify(data, null, 2);
}
