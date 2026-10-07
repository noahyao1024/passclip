import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processImport } from "@/lib/import/process";
import { layoutPass } from "@/lib/pass/fields";

// The iPhone app reads an email with Apple's on-device model and builds import JSON from what it found.
// The Swift tests check that its builder produces exactly this file; this test checks that the server's
// pipeline accepts it, so the two can't drift apart (docs/DECISIONS.md D22).

describe("JSON made by the iPhone app's email reader", () => {
  const result = processImport(readFileSync("ios/PassclipTests/Fixtures/ai-ticket.json", "utf8"));

  it("is a valid import, with the long title shortened and a time zone applied", () => {
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const [pass] = result.value.passes;
    expect(Array.from(pass.title).length).toBeLessThanOrEqual(80);
    expect(pass.start).toBe("2026-10-10T19:30:00+08:00");
    expect(result.warnings.map((warning) => warning.message)).toEqual(expect.arrayContaining([
      "Shortened the title to 80 characters. Check that it still reads well.",
      "Read by Apple Intelligence on this iPhone. Check every detail against your email.",
      "The barcode isn't included. Add it from a screenshot of your ticket.",
    ]));
  });

  it("makes a pass that shows the category and booking number on the front", () => {
    if (!result.ok) throw new Error("Fixture failed to import");
    const layout = layoutPass(result.value.passes[0]);
    expect(layout.auxiliaryFields.map((field) => [field.label, field.value])).toEqual([["Category", "CAT 2"], ["Booking", "1004940771101"]]);
  });
});
