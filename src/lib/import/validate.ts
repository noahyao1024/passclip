import type { ErrorObject, ValidateFunction } from "ajv";
import { describeErrors } from "./messages";
import type { ImportError, Warning } from "./notices";
import { fieldPath, parsePointer, splitPassPath, type Path } from "./paths";
import { validateImport as compiledValidator } from "./schema-validator.generated";
import type { PassclipImport } from "./types";

// Validation (docs/SPEC.md §3.2) with the validator precompiled from the schema by
// `npm run gen:types`, so it also runs in the browser under a strict CSP.
const runSchema = compiledValidator as unknown as ValidateFunction<PassclipImport>;

export type SchemaCheck =
  | { valid: true; value: PassclipImport }
  | { valid: false; errors: ErrorObject[] };

/** Checks data against the import schema exactly as written: no fixes, no plain messages. */
export function checkAgainstSchema(data: unknown): SchemaCheck {
  if (runSchema(data)) return { valid: true, value: data };
  return { valid: false, errors: [...(runSchema.errors ?? [])] };
}

export type ValidationResult =
  | { ok: true; value: PassclipImport; warnings: Warning[] }
  | { ok: false; errors: ImportError[]; warnings: Warning[] };

/**
 * Validates import data. Unknown keys are removed with a warning instead of failing; every other
 * problem becomes a plain message with the pass number and field.
 */
export function validateImport(data: unknown): ValidationResult {
  const value = structuredClone(data);
  const warnings: Warning[] = [];

  let check = checkAgainstSchema(value);
  if (!check.valid) {
    const unknownKeys = check.errors.filter((error) => error.keyword === "additionalProperties");
    for (const error of unknownKeys) {
      const key = String((error.params as { additionalProperty: unknown }).additionalProperty);
      const path = parsePointer(error.instancePath);
      const parent = resolve(value, path);
      if (isPlainObject(parent)) delete parent[key];
      warnings.push(unknownKeyWarning([...path, key]));
    }
    // Check again without the unknown keys to get the real problems, if any.
    if (unknownKeys.length > 0) check = checkAgainstSchema(value);
  }

  if (check.valid) return { ok: true, value: check.value, warnings };
  return { ok: false, errors: describeErrors(check.errors), warnings };
}

function unknownKeyWarning(path: Path): Warning {
  const inPass = splitPassPath(path);
  if (inPass) return { kind: "fix", pass: inPass.pass, message: `Removed "${fieldPath(inPass.field)}", which isn't a Passclip field.` };
  return { kind: "fix", message: `Removed "${fieldPath(path)}", which isn't a Passclip field.` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolve(root: unknown, path: Path): unknown {
  let node = root;
  for (const segment of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[segment];
  }
  return node;
}
