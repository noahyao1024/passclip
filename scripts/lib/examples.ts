import { readdirSync } from "node:fs";
import path from "node:path";

// Fixture folders, as described in examples/README.md. Paths are relative to the project root.
const EXAMPLES = {
  valid: { folder: "examples", files: /\.json$/ },
  recoverable: { folder: "examples/recoverable", files: /\.(json|txt)$/ },
  invalid: { folder: "examples/invalid", files: /\.(json|txt)$/ },
} as const;

/** Lists the fixture files of one kind (not subfolders), sorted by name. */
export function listExamples(kind: keyof typeof EXAMPLES): string[] {
  const { folder, files } = EXAMPLES[kind];
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && files.test(entry.name))
    .map((entry) => path.join(folder, entry.name))
    .sort();
}
