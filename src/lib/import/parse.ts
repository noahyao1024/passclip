import { findJsonSyntaxError } from "./json-syntax";
import type { ImportError, TextLocation, Warning } from "./notices";

// Lenient parsing (docs/SPEC.md §3.1): recover JSON from an AI chat reply and say what was fixed.

export const MAX_INPUT_BYTES = 256 * 1024;
/** The current import format version, written whenever Passclip adds or rewraps one. */
export const SCHEMA_VERSION = "1.1";

export type ParseResult =
  | { ok: true; data: unknown; warnings: Warning[] }
  | { ok: false; error: ImportError; warnings: Warning[] };

interface Range {
  start: number;
  end: number;
}

export function parseImportText(input: string): ParseResult {
  const warnings: Warning[] = [];
  const fail = (error: ImportError): ParseResult => ({ ok: false, error, warnings });

  if (new TextEncoder().encode(input).length > MAX_INPUT_BYTES) {
    return fail({ message: "This is over 256 KB, which is more than one import can be. Paste only the JSON from the AI's reply." });
  }

  // 1. A byte-order mark and surrounding whitespace aren't worth a warning.
  let range = trimRange(input, { start: input.startsWith("﻿") ? 1 : 0, end: input.length });
  if (range.start === range.end) {
    return fail({ message: "Paste the JSON from your AI chat, or drop a .json or .txt file." });
  }

  // 2. The first fenced code block, or 3. the first balanced {…} or […] inside other text.
  const fence = findCodeFence(input, range);
  if (fence) {
    warnings.push({
      kind: "fix",
      message: fence.hasOtherText
        ? "Took the JSON out of the code block and ignored the text around it."
        : "Took the JSON out of the code block.",
    });
    range = trimRange(input, fence.content);
  } else {
    const json = findBalancedJson(input, range);
    if (json && (json.start !== range.start || json.end !== range.end)) {
      warnings.push({ kind: "fix", message: "Ignored the text around the JSON." });
      range = json;
    }
  }

  const text = input.slice(range.start, range.end);
  if (!/[{[]/.test(text)) {
    return fail({ message: "There's no JSON here. Paste the AI's reply: it starts with { and ends with }." });
  }

  // 4. Parse as-is, then with fixes. Each fix keeps the text the same length, so error
  // positions still point into what the user pasted.
  const withoutCommas = removeTrailingCommas(text);
  const straightQuotes = replaceCurlyQuotes(text);
  const attempts: { text: string; fixes: string[] }[] = [{ text, fixes: [] }];
  if (withoutCommas !== text) {
    attempts.push({ text: withoutCommas, fixes: [TRAILING_COMMAS] });
  }
  if (straightQuotes !== text) {
    const both = removeTrailingCommas(straightQuotes);
    attempts.push({ text: both, fixes: both === straightQuotes ? [CURLY_QUOTES] : [CURLY_QUOTES, TRAILING_COMMAS] });
  }

  for (const attempt of attempts) {
    const parsed = tryParse(attempt.text);
    if (parsed.ok) {
      warnings.push(...attempt.fixes.map((message): Warning => ({ kind: "fix", message })));
      return { ok: true, data: fixRoot(parsed.value, warnings), warnings };
    }
  }

  const mostFixed = attempts[attempts.length - 1].text;
  const problem = findJsonSyntaxError(mostFixed);
  if (!problem) return fail({ message: "This isn't valid JSON. Copy the AI's whole reply and paste it again." });
  return fail({ message: problem.reason, location: locate(input, range.start + problem.offset) });
}

const TRAILING_COMMAS = "Removed commas that came right before a } or ].";
const CURLY_QUOTES = "Replaced curly quotes with straight quotes.";

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function trimRange(input: string, { start, end }: Range): Range {
  while (start < end && /\s/.test(input[start])) start++;
  while (end > start && /\s/.test(input[end - 1])) end--;
  return { start, end };
}

/** Finds the first ``` block. An unclosed block runs to the end (the reply may be cut off). */
function findCodeFence(input: string, range: Range): { content: Range; hasOtherText: boolean } | undefined {
  const open = input.indexOf("```", range.start);
  if (open === -1 || open >= range.end) return undefined;
  const lineEnd = input.indexOf("\n", open);
  if (lineEnd === -1 || lineEnd >= range.end) return undefined;
  // Only a language name (like "json") may follow the opening fence.
  if (!/^[\w+-]*$/.test(input.slice(open + 3, lineEnd).trim())) return undefined;

  const contentStart = lineEnd + 1;
  const close = input.indexOf("```", contentStart);
  const contentEnd = close === -1 || close >= range.end ? range.end : close;
  const after = close === -1 || close >= range.end ? range.end : close + 3;
  const hasOtherText = input.slice(range.start, open).trim() !== "" || input.slice(after, range.end).trim() !== "";
  return { content: { start: contentStart, end: contentEnd }, hasOtherText };
}

/** Finds the first balanced top-level {…} or […], counting brackets outside strings only. */
function findBalancedJson(input: string, range: Range): Range | undefined {
  let start = -1;
  let depth = 0;
  let inString = false;
  for (let i = range.start; i < range.end; i++) {
    const char = input[i];
    if (start === -1) {
      if (char === "{" || char === "[") {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return undefined;
}

/** Replaces each comma that comes right before } or ] (outside strings) with a space. */
function removeTrailingCommas(text: string): string {
  const chars = [...text];
  let changed = false;
  let inString = false;
  let pendingComma = -1;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      pendingComma = -1;
    } else if (char === ",") {
      pendingComma = i;
    } else if ((char === "}" || char === "]") && pendingComma !== -1) {
      chars[pendingComma] = " ";
      changed = true;
      pendingComma = -1;
    } else if (!/\s/.test(char)) {
      pendingComma = -1;
    }
  }
  return changed ? chars.join("") : text;
}

function replaceCurlyQuotes(text: string): string {
  return text.replace(/[“”]/g, '"');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPassLike(value: unknown): boolean {
  return isPlainObject(value) && "type" in value && "title" in value;
}

/** 5. Wraps a bare pass or list of passes, and adds a missing schemaVersion. */
function fixRoot(data: unknown, warnings: Warning[]): unknown {
  if (Array.isArray(data) && data.length > 0 && data.every(isPassLike)) {
    warnings.push({ kind: "fix", message: "The JSON was a list of passes, so Passclip wrapped it in the import format." });
    return { schemaVersion: SCHEMA_VERSION, passes: data };
  }
  if (isPlainObject(data) && !("passes" in data) && isPassLike(data)) {
    warnings.push({ kind: "fix", message: "The JSON was a single pass, so Passclip wrapped it in the import format." });
    return { schemaVersion: SCHEMA_VERSION, passes: [data] };
  }
  if (isPlainObject(data) && "passes" in data && !("schemaVersion" in data)) {
    warnings.push({ kind: "fix", message: `Added the missing "schemaVersion": "${SCHEMA_VERSION}".` });
    return { schemaVersion: SCHEMA_VERSION, ...data };
  }
  return data;
}

const SNIPPET_RADIUS = 40;

function locate(input: string, offset: number): TextLocation {
  const lineStart = input.lastIndexOf("\n", offset - 1) + 1;
  const newline = input.indexOf("\n", offset);
  const lineEnd = newline === -1 ? input.length : newline;
  const line = input.slice(0, offset).split("\n").length;
  const column = offset - lineStart + 1;

  const from = Math.max(lineStart, offset - SNIPPET_RADIUS);
  const to = Math.min(lineEnd, offset + SNIPPET_RADIUS);
  const prefix = from > lineStart ? "…" : "";
  const suffix = to < lineEnd ? "…" : "";
  const snippet = prefix + input.slice(from, to).replace(/\r$/, "") + suffix;
  return { offset, line, column, snippet, snippetColumn: offset - from + 1 + prefix.length };
}
