import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { generateImportTypes, TYPES_PATH } from "./import-types";

it("src/lib/import/types.ts matches the schema (run npm run gen:types after changing the schema)", async () => {
  expect(await readFile(TYPES_PATH, "utf8")).toBe(await generateImportTypes());
});
