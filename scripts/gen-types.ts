import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateImportTypes, TYPES_PATH } from "./lib/import-types";
import { generateImportValidator, VALIDATOR_PATH } from "./lib/import-validator";

// Regenerates everything that comes from the import schema: TypeScript types and the
// precompiled validator.
async function main() {
  const outputs: [string, Promise<string>][] = [
    [TYPES_PATH, generateImportTypes()],
    [VALIDATOR_PATH, generateImportValidator()],
  ];
  for (const [file, contents] of outputs) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await contents);
    console.log(`Wrote ${path.relative(process.cwd(), file)} from the import schema.`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
