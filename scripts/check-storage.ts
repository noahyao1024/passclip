import { loadEnvConfig } from "@next/env";
import { readStorageConfig } from "@/lib/storage/config";
import { runStorageCheck } from "./lib/storage-check";

// Tries a real upload with the settings in .env.local: a tiny test image goes up, is read back
// and is deleted again (docs/LAUNCH.md). Prints setting names and problems, never secret values.

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const result = readStorageConfig(process.env);
  if (!result.ok) {
    if (result.missing.length > 0) console.log(`File uploads aren't set up. Missing settings: ${result.missing.join(", ")}.`);
    for (const problem of result.problems) console.log(`✗ ${problem}`);
    console.log("\nAdd them to .env.local. See .env.example and docs/LAUNCH.md.");
    process.exitCode = 1;
    return;
  }

  let site: string;
  try {
    site = new URL(process.env.PUBLIC_BASE_URL ?? "").origin;
  } catch {
    console.log("Set PUBLIC_BASE_URL to the site's address, so the check can test uploads from it.");
    process.exitCode = 1;
    return;
  }

  console.log(`Checking the "${result.config.bucket}" bucket at ${new URL(result.config.endpoint).host} for ${site}…\n`);
  const lines = await runStorageCheck(result.config, site);
  for (const line of lines) console.log(`${line.ok === true ? "✓" : line.ok === "note" ? "-" : "✗"} ${line.message}`);
  if (lines.some((line) => line.ok === false)) {
    process.exitCode = 1;
    return;
  }
  console.log("\n✓ File uploads are ready.");
}

void main();
