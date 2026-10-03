import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkAgainstSchema } from "@/lib/import/validate";
import { listExamples } from "../scripts/lib/examples";

// The fixture contract from examples/README.md. Later milestones extend it: every valid example
// must also parse, normalize and map to pass.json.

function check(file: string) {
  return checkAgainstSchema(JSON.parse(readFileSync(file, "utf8")));
}

describe("valid examples", () => {
  const files = listExamples("valid");

  it("exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s validates as-is", (file) => {
    const result = check(file);
    expect(result.valid ? [] : result.errors).toEqual([]);
  });
});

describe("invalid examples", () => {
  const files = listExamples("invalid");

  it("exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s fails validation", (file) => {
    expect(check(file).valid).toBe(false);
  });

  // The reasons from examples/README.md, checked by field rather than by Ajv's wording.
  // Milestone 1 turns them into plain messages.
  function errorsOf(file: string) {
    const result = check(file);
    if (result.valid) throw new Error(`${file} should fail validation`);
    return result.errors.map(({ instancePath, keyword, params }) => ({ instancePath, keyword, params }));
  }

  it("missing-title.json fails because pass 1 has no title", () => {
    expect(errorsOf("examples/invalid/missing-title.json")).toEqual([
      { instancePath: "/passes/0", keyword: "required", params: { missingProperty: "title" } },
    ]);
  });

  it("bad-date-and-color.json fails on the start date and the background color", () => {
    const errors = errorsOf("examples/invalid/bad-date-and-color.json");
    expect(errors.map((error) => [error.instancePath, error.keyword])).toEqual([
      ["/passes/0/start", "pattern"],
      ["/passes/0/style/backgroundColor", "pattern"],
    ]);
  });

  it("boarding-pass-without-transit.json fails because a boarding pass needs transit", () => {
    expect(errorsOf("examples/invalid/boarding-pass-without-transit.json")).toContainEqual({
      instancePath: "/passes/0",
      keyword: "required",
      params: { missingProperty: "transit" },
    });
  });
});

describe("recoverable examples", () => {
  const files = listExamples("recoverable");

  it("exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // They only test the lenient parser (Milestone 1) if they stay broken as written.
  it.each(files)("%s isn't valid as-is", (file) => {
    expect(isValidAsIs(readFileSync(file, "utf8"))).toBe(false);
  });

  function isValidAsIs(text: string): boolean {
    try {
      return checkAgainstSchema(JSON.parse(text)).valid;
    } catch {
      return false; // Not even JSON yet.
    }
  }
});
