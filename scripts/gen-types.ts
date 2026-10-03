import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateImportTypes, TYPES_PATH } from "./lib/import-types";

async function main() {
  await mkdir(path.dirname(TYPES_PATH), { recursive: true });
  await writeFile(TYPES_PATH, await generateImportTypes());
  console.log(`Wrote ${path.relative(process.cwd(), TYPES_PATH)} from the import schema.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
