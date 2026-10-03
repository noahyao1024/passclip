import { describe, expect, it } from "vitest";
import { processImport } from "./process";

describe("processImport", () => {
  it("runs each stage in order and retains their warnings", () => {
    const input = '```json\n{ "passes": [{ "type": "generic", "title": "  Test   pass  ", "notes": null, "surprise": true, "start": "2026-11-01T12:00", "warnings": ["Check the venue."], }], }\n```';
    const result = processImport(input, { fallbackTimeZone: "Asia/Tokyo" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.passes[0]).toMatchObject({ title: "Test pass", start: "2026-11-01T12:00:00+09:00", needsTimeZone: true });
      expect(result.value.passes[0]).not.toHaveProperty("notes");
      expect(result.value.passes[0]).not.toHaveProperty("surprise");
    }
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      expect.stringContaining("code block"), expect.stringContaining("commas"), expect.stringContaining("schemaVersion"),
      expect.stringContaining("empty field: notes"), expect.stringContaining('Removed "surprise"'),
      "Check the venue.", expect.stringContaining("Used Asia/Tokyo"),
    ]);
  });

  it("keeps syntax locations in the unified error array", () => {
    const result = processImport('{\n "schemaVersion": "1.0",\n "passes": [bad]\n}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].location).toMatchObject({ line: 3, column: 13 });
  });

  it("keeps recovery warnings when schema validation fails", () => {
    const result = processImport('```json\n{"passes":[{"type":"generic"}]}\n```');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toBe("Pass 1 needs a title, for example the event name.");
    expect(result.warnings).toHaveLength(2);
  });

  it("rejects an impossible date that passed schema validation", () => {
    const result = processImport('{"schemaVersion":"1.0","passes":[{"type":"generic","title":"Test","start":"2026-02-30T12:00Z"}]}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toMatch(/start isn't a real date/);
  });

  it("preserves exact barcode payloads through every stage", () => {
    const message = " \tABC\u0000\n123 ";
    const input = { type: "generic", title: "Test", barcode: { format: "qr", message }, notes: null };
    const result = processImport(JSON.stringify(input));
    expect(result.ok && result.value.passes[0].barcode?.message).toBe(message);
  });
});
