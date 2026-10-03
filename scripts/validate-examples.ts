import { readFileSync } from "node:fs";
import { checkAgainstSchema } from "@/lib/import/validate";
import { listExamples } from "./lib/examples";

// Checks that every top-level examples/*.json file is valid as-is (examples/README.md).
// The recoverable and invalid fixtures are covered by `npm test`.

function problemsIn(file: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
  const result = checkAgainstSchema(data);
  if (result.valid) return [];
  return result.errors.map((error) => `${error.instancePath || "(root)"} ${error.message ?? error.keyword}`);
}

function main() {
  const files = listExamples("valid");
  if (files.length === 0) {
    console.error("No examples found in examples/.");
    process.exitCode = 1;
    return;
  }

  let failed = 0;
  for (const file of files) {
    const problems = problemsIn(file);
    if (problems.length === 0) {
      console.log(`✓ ${file}`);
    } else {
      failed += 1;
      console.log(`✗ ${file}`);
      for (const problem of problems) console.log(`    ${problem}`);
    }
  }

  const valid = files.length - failed;
  console.log(`\n${valid} of ${files.length} examples are valid.`);
  if (failed > 0) process.exitCode = 1;
}

main();
