import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import importSchema from "../../../schema/passclip-import.v1.schema.json";
import type { PassclipImport } from "./types";

// Compiled once. Strict mode makes Ajv reject unknown or misused schema keywords, so a typo in
// the schema fails loudly instead of silently allowing anything.
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateImportSchema = ajv.compile<PassclipImport>(importSchema);

export type SchemaCheck =
  | { valid: true; value: PassclipImport }
  | { valid: false; errors: ErrorObject[] };

/**
 * Checks data against the import schema exactly as written: no fixes and no friendly messages.
 * Milestone 1 builds the user-facing validation (unknown-key warnings, plain messages) on top.
 */
export function checkAgainstSchema(data: unknown): SchemaCheck {
  if (validateImportSchema(data)) return { valid: true, value: data };
  return { valid: false, errors: [...(validateImportSchema.errors ?? [])] };
}
