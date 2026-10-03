import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { generateImportValidator, VALIDATOR_PATH } from "./import-validator";

it("src/lib/import/schema-validator.generated.ts matches the schema (run npm run gen:types after changing the schema)", async () => {
  expect(await readFile(VALIDATOR_PATH, "utf8")).toBe(await generateImportValidator());
});
