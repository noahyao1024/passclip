import { loadEnvConfig } from "@next/env";
import { inspectSigningConfig, readSigningConfig } from "@/lib/pass/signing";
import { readStorageConfig, STORAGE_SETTINGS } from "@/lib/storage/config";

// Checks the pass signing settings (docs/SPEC.md §6) and the optional file upload settings
// (§9). Prints setting names and problems, never secret values.

/** Returns false when signing isn't ready. */
function checkSigning(): boolean {
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
    return false;
  }

  const { problems, notes } = inspectSigningConfig(result.config);
  for (const problem of problems) console.log(`✗ ${problem}`);
  for (const note of notes) console.log(`- ${note}`);
  if (problems.length > 0) {
    console.log("\nFix these settings in .env.local. See docs/SPEC.md §6.");
    return false;
  }
  const { passTypeIdentifier, teamIdentifier } = result.config;
  console.log(`\n✓ Pass signing is set up for ${passTypeIdentifier} (team ${teamIdentifier}).`);
  return true;
}

/** File uploads are optional: returns false only when they're half set up or wrong. */
function checkStorage(): boolean {
  const result = readStorageConfig(process.env);
  if (result.ok) {
    console.log(`✓ File uploads go to the "${result.config.bucket}" bucket at ${new URL(result.config.endpoint).host}. Run npm run check:storage to try one.`);
    return true;
  }
  if (result.missing.length === STORAGE_SETTINGS.length) {
    console.log("File uploads aren't set up, so the site doesn't offer them. They're optional: see docs/LAUNCH.md.");
    return true;
  }
  if (result.missing.length > 0) {
    console.log("File upload settings are incomplete, so the site doesn't offer uploads.");
    console.log("Missing settings:");
    for (const name of result.missing) console.log(`  - ${name}`);
  } else {
    for (const problem of result.problems) console.log(`✗ ${problem}`);
  }
  console.log("\nFix these settings in .env.local. See .env.example and docs/LAUNCH.md.");
  return false;
}

function main() {
  // Loads the same .env files as the site (.env.local and friends), so this checks what it will use.
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const signing = checkSigning();
  console.log("");
  const storage = checkStorage();
  if (!signing || !storage) process.exitCode = 1;
}

main();
