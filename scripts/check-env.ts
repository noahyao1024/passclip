import { loadEnvConfig } from "@next/env";
import { inspectSigningConfig, readSigningConfig } from "@/lib/pass/signing";

// Checks the pass signing settings (docs/SPEC.md §6). Prints setting names and problems, never secret values.

function main() {
  // Loads the same .env files as the site (.env.local and friends), so this checks what it will use.
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

  const result = readSigningConfig(process.env);
  if (!result.ok) {
    if (result.missing.length > 0) {
      console.log("Pass signing isn't set up yet, so the site runs in preview-only mode.");
      console.log("Missing settings:");
      for (const name of result.missing) console.log(`  - ${name}`);
      console.log("\nAdd them to .env.local. See .env.example and docs/SPEC.md §6.");
    } else {
      for (const problem of result.problems) console.log(`✗ ${problem}`);
      console.log("\nFix these settings in .env.local. See docs/SPEC.md §6.");
    }
    process.exitCode = 1;
    return;
  }

  const { problems, notes } = inspectSigningConfig(result.config);
  for (const problem of problems) console.log(`✗ ${problem}`);
  for (const note of notes) console.log(`- ${note}`);
  if (problems.length > 0) {
    console.log("\nFix these settings in .env.local. See docs/SPEC.md §6.");
    process.exitCode = 1;
    return;
  }
  const { passTypeIdentifier, teamIdentifier } = result.config;
  console.log(`\n✓ Pass signing is set up for ${passTypeIdentifier} (team ${teamIdentifier}).`);
}

main();
