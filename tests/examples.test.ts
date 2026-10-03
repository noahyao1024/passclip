import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processImport } from "@/lib/import/process";
import { contrastRatio, MIN_CONTRAST } from "@/lib/pass/colors";
import { checkAgainstSchema } from "@/lib/import/validate";
import { listExamples } from "../scripts/lib/examples";

// The fixture contract from examples/README.md, through the shared import pipeline.

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

  it.each(files)("%s processes into normalized, readable passes", (file) => {
    const result = processImport(readFileSync(file, "utf8"), { fallbackTimeZone: "Asia/Tokyo" });
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    for (const pass of result.value.passes) {
      expect(contrastRatio(pass.style.foregroundColor, pass.style.backgroundColor)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(pass.style.labelColor, pass.style.backgroundColor)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      for (const value of [pass.start, pass.end, pass.expires, pass.transit?.boardingTime]) {
        if (value) expect(value).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
      }
    }
  });

  it("normalizes the coupon's date-only expiry and collects the train's AI warnings", () => {
    const coupon = processImport(readFileSync("examples/coupon.json", "utf8"), { fallbackTimeZone: "Asia/Tokyo" });
    expect(coupon.ok && coupon.value.passes[0].expires).toBe("2026-12-31T23:59:59+09:00");
    const train = processImport(readFileSync("examples/train-local-time.json", "utf8"));
    expect(train.ok && train.value.passes[0].start).toBe("2026-11-20T08:03:00+09:00");
    expect(train.warnings.filter((warning) => warning.from === "ai")).toHaveLength(2);
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

  it.each(files)("%s produces readable errors through the whole pipeline", (file) => {
    const result = processImport(readFileSync(file, "utf8"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.every((error) => error.message.startsWith("Pass 1"))).toBe(true);
      expect(result.errors.every((error) => !/schemaPath|must match|additionalProperties/.test(error.message))).toBe(true);
    }
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

  it.each([
    ["fenced-with-prose.txt", [/code block.*text around it/]],
    ["single-pass-root.json", [/single pass.*wrapped/]],
    ["curly-quotes.txt", [/curly quotes.*straight quotes/]],
    ["trailing-comma-no-version.txt", [/commas/, /schemaVersion/]],
    ["unknown-keys.json", [/Removed "eventDate"/, /Removed "color"/, /Removed "venue.parking"/]],
  ] as const)("%s recovers with every documented fix", (name, expected) => {
    const result = processImport(readFileSync(`examples/recoverable/${name}`, "utf8"), { fallbackTimeZone: "Asia/Tokyo" });
    expect(result.ok ? [] : result.errors).toEqual([]);
    const fixes = result.warnings.filter((warning) => warning.kind === "fix");
    expect(fixes).toHaveLength(expected.length);
    expected.forEach((pattern, index) => expect(fixes[index].message).toMatch(pattern));
  });

  function isValidAsIs(text: string): boolean {
    try {
      return checkAgainstSchema(JSON.parse(text)).valid;
    } catch {
      return false; // Not even JSON yet.
    }
  }
});
