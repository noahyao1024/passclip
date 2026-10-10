import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processImport } from "@/lib/import/process";
import { layoutPass } from "@/lib/pass/fields";

// The iPhone app reads an email with Apple's on-device model and builds import JSON from what it found.
// The Swift tests check that its builder produces exactly this file; this test checks that the server's
// pipeline accepts it, so the two can't drift apart (docs/DECISIONS.md D22).

describe("JSON made by the iPhone app's email reader", () => {
  const result = processImport(readFileSync("ios/PassclipTests/Fixtures/ai-ticket.json", "utf8"));

  it("is a valid import, with a short title and a time zone applied", () => {
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const [pass] = result.value.passes;
    expect(Array.from(pass.title).length).toBeLessThanOrEqual(61);
    expect(pass.start).toBe("2026-10-10T19:30:00+08:00");
    expect(result.warnings.map((warning) => warning.message)).toEqual(expect.arrayContaining([
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

describe("JSON made from a PDF by the iPhone app", () => {
  const result = processImport(readFileSync("ios/PassclipTests/Fixtures/ai-pdf-ticket.json", "utf8"));

  it("is a valid import with a short title, so nothing needs shortening", () => {
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const [pass] = result.value.passes;
    expect(Array.from(pass.title).length).toBeLessThanOrEqual(60);
    expect(pass.timeZone).toBe("Asia/Singapore");
    expect(result.warnings.map((warning) => warning.message)).toEqual(["Read by Apple Intelligence on this iPhone. Check every detail against your email."]);
  });

  it("puts the document name and the original link on the back, and the full title in the notes", () => {
    if (!result.ok) throw new Error("Fixture failed to import");
    const layout = layoutPass(result.value.passes[0], { source: result.value.source });
    const back = Object.fromEntries(layout.backFields.map((field) => [field.key, field]));
    expect(back.source.value).toBe("Imported from SISTIC E-Ticket");
    expect(back.att_1).toMatchObject({ label: "Original ticket", value: "https://sistic.stixcloud.com/Stix/eticket/downloadEticketLive.htm?linkId=IkT1mGrIek" });
    expect(String(back.notes.value)).toMatch(/^Full name: 2026 Deyunshe 30th Anniversary/);
    // Fields fill the first row of four, then the second, above the barcode.
    expect(layout.auxiliaryFields.map((field) => [field.label, field.value, field.row ?? 0])).toEqual([
      ["Section", "A7", 0], ["Row", "22", 0], ["Seat", "13", 0], ["Category", "CAT 2", 0], ["Booking", "20261005-001796", 1], ["Name", "DAMAI", 1],
    ]);
    expect(back.confirmation).toBeUndefined();
  });
});
