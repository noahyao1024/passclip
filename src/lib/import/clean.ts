import type { Warning } from "./notices";
import { fieldPath, splitPassPath, type Path } from "./paths";

// Lenient clean-up before validation ("lenient in", docs/SPEC.md §3.3 and CLAUDE.md rule 5):
// tidy text, drop empty values, drop attachments without an https link, and shorten display text
// that's over its length limit. Every change that removes something comes with a warning.

function matches(field: Path, pattern: (string | null)[]): boolean {
  return field.length === pattern.length && pattern.every((part, i) => (part === null ? typeof field[i] === "number" : field[i] === part));
}

// The barcode message is never changed (CLAUDE.md rule 3).
const isBarcodeMessage = (field: Path) => matches(field, ["barcode", "message"]);
const isMultiline = (field: Path) =>
  matches(field, ["notes"]) || matches(field, ["offer", "terms"]) || matches(field, ["extraFields", null, "value"]);

// Text that's only read by people, with the import format's length limits. Too long here is
// shortened with a warning. Codes, IDs, names, links and barcodes are never shortened: cutting
// them would make them wrong, so a too-long value there stays an error to fix.
type Limit = { field: (string | null)[]; max: number; name: string };
const PASS_TEXT_LIMITS: Limit[] = [
  { field: ["title"], max: 80, name: "the title" },
  { field: ["subtitle"], max: 60, name: "the subtitle" },
  { field: ["organization"], max: 60, name: "the organization" },
  { field: ["description"], max: 120, name: "the description" },
  { field: ["notes"], max: 2000, name: "the notes" },
  { field: ["venue", "name"], max: 100, name: "the venue name" },
  { field: ["venue", "address"], max: 200, name: "the venue address" },
  { field: ["transit", "from", "name"], max: 100, name: "the departure name" },
  { field: ["transit", "to", "name"], max: 100, name: "the arrival name" },
  { field: ["transit", "carrier"], max: 60, name: "the carrier" },
  { field: ["transit", "cabin"], max: 30, name: "the cabin" },
  { field: ["seat", "description"], max: 60, name: "the seat description" },
  { field: ["seat", "entrance"], max: 40, name: "the entrance" },
  { field: ["membership", "programName"], max: 60, name: "the program name" },
  { field: ["membership", "tier"], max: 30, name: "the tier" },
  { field: ["offer", "headline"], max: 40, name: "the offer headline" },
  { field: ["offer", "terms"], max: 1000, name: "the offer terms" },
  { field: ["extraFields", null, "label"], max: 30, name: "an extra field's label" },
  { field: ["extraFields", null, "value"], max: 300, name: "an extra field's value" },
  { field: ["attachments", null, "title"], max: 60, name: "an attachment's title" },
  { field: ["calendar", "title"], max: 100, name: "the calendar title" },
  { field: ["warnings", null], max: 300, name: "a warning" },
];
const ROOT_TEXT_LIMITS: Limit[] = [
  { field: ["source", "subject"], max: 200, name: "the email subject" },
  { field: ["warnings", null], max: 300, name: "a warning" },
];
/** Exported for the test that keeps these limits in step with the schema. */
export const TEXT_LIMITS = { pass: PASS_TEXT_LIMITS, root: ROOT_TEXT_LIMITS };

/**
 * Shortens text to `max` characters (counted as the schema counts them, by code point), at a word
 * boundary when one is close, ending with "…".
 */
export function shorten(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const kept = chars.slice(0, max - 1).join("");
  const space = kept.lastIndexOf(" ");
  const cut = space >= kept.length * 0.6 ? kept.slice(0, space) : kept;
  return `${cut.replace(/[\s,;:.\-–—]+$/u, "")}…`;
}

/** One line of text: no control characters or line breaks, single spaces, trimmed. */
export function cleanLine(text: string): string {
  return text
    .replace(/[\t\n\r\v\f]+/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Text that may have line breaks: keeps them, at most one blank line in a row. */
export function cleanMultiline(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\v\f]/g, " ")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const isEmpty = (value: unknown) =>
  value === null ||
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);

export function cleanImport(data: unknown): { data: unknown; warnings: Warning[] } {
  const emptyFields = new Map<number | undefined, string[]>();
  const warnings: Warning[] = [];

  const visit = (value: unknown, path: Path): unknown => {
    const pass = splitPassPath(path);
    if (typeof value === "string") {
      if (pass && isBarcodeMessage(pass.field)) return value;
      const text = pass && isMultiline(pass.field) ? cleanMultiline(value) : cleanLine(value);
      const limits = pass ? PASS_TEXT_LIMITS : path[0] === "passes" ? [] : ROOT_TEXT_LIMITS;
      const limit = limits.find(({ field }) => matches(pass ? pass.field : path, field));
      if (!limit || Array.from(text).length <= limit.max) return text;
      const message = `Shortened ${limit.name} to ${limit.max} characters. Check that it still reads well.`;
      warnings.push(pass ? { kind: "fix", pass: pass.pass, message } : { kind: "fix", message });
      return shorten(text, limit.max);
    }
    if (Array.isArray(value)) {
      const items = value.map((item, i) => visit(item, [...path, i]));
      // Passes are never dropped, so "Pass 2" in messages always means the second pass in the JSON.
      if (path.length === 1 && path[0] === "passes") return items;
      if (pass && matches(pass.field, ["attachments"])) return keepHttpsAttachments(items, pass.pass, warnings);
      return items.filter((item) => !isEmpty(item));
    }
    if (typeof value === "object" && value !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        const cleaned = visit(child, [...path, key]);
        const keepEmpty = path.length === 0 && key === "passes";
        if (isEmpty(cleaned) && !keepEmpty) {
          // A group that only became empty was already reported field by field.
          const becameEmpty = typeof child === "object" && child !== null && Object.keys(child).length > 0;
          if (!becameEmpty) {
            const where = splitPassPath([...path, key]);
            const list = emptyFields.get(where?.pass) ?? [];
            list.push(fieldPath(where ? where.field : [...path, key]));
            emptyFields.set(where?.pass, list);
          }
        } else {
          result[key] = cleaned;
        }
      }
      return result;
    }
    return value;
  };

  const cleaned = visit(data, []);
  for (const [pass, fields] of emptyFields) {
    const message = fields.length === 1 ? `Ignored an empty field: ${fields[0]}.` : `Ignored empty fields: ${fields.join(", ")}.`;
    warnings.push(pass === undefined ? { kind: "fix", message } : { kind: "fix", pass, message });
  }
  return { data: cleaned, warnings };
}

const HTTPS_LINK = /^https:\/\/\S+$/;

function keepHttpsAttachments(items: unknown[], pass: number, warnings: Warning[]): unknown[] {
  return items.filter((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return !isEmpty(item);
    const { title, url } = item as { title?: unknown; url?: unknown };
    if (typeof url !== "string" || HTTPS_LINK.test(url)) return !isEmpty(item);
    const name = typeof title === "string" && title ? `“${title}”` : "an attachment";
    warnings.push({ kind: "fix", pass, message: `Removed ${name} because its link isn't a full https:// link.` });
    return false;
  });
}
