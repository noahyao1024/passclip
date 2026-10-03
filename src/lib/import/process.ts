import { cleanImport } from "./clean";
import { normalizeImport, type NormalizeOptions, type NormalizeResult } from "./normalize";
import { parseImportText } from "./parse";
import { validateImport } from "./validate";

export type ProcessResult = NormalizeResult;

/** The shared browser/server import path: parse → clean → validate → normalize. */
export function processImport(text: string, options: NormalizeOptions = {}): ProcessResult {
  const parsed = parseImportText(text);
  if (!parsed.ok) return { ok: false, errors: [parsed.error], warnings: parsed.warnings };

  const cleaned = cleanImport(parsed.data);
  const validated = validateImport(cleaned.data);
  const warnings = [...parsed.warnings, ...cleaned.warnings, ...validated.warnings];
  if (!validated.ok) return { ok: false, errors: validated.errors, warnings };

  const normalized = normalizeImport(validated.value, options);
  return { ...normalized, warnings: [...warnings, ...normalized.warnings] };
}
