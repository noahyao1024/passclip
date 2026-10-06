import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanImport, cleanLine, cleanMultiline, shorten, TEXT_LIMITS } from "./clean";
import { processImport } from "./process";

describe("cleanLine and cleanMultiline", () => {
  it("trims, collapses spaces and drops control characters", () => {
    expect(cleanLine("  Jazz \u0000  Night\n\tAutumn  ")).toBe("Jazz Night Autumn");
  });

  it("keeps line breaks in multi-line text, with at most one blank line", () => {
    expect(cleanMultiline("  Doors open 18:30.  \r\n\r\n\r\n  Bags  are\u0007 checked.\t ")).toBe(
      "Doors open 18:30.\n\nBags are checked.",
    );
  });
});

describe("cleanImport", () => {
  it("tidies text but never touches the barcode message", () => {
    const { data, warnings } = cleanImport({
      passes: [
        {
          type: "eventTicket",
          title: "  Jazz\n Night ",
          notes: "Line 1\nLine 2",
          barcode: { format: "qr", message: "  AB  12\n", altText: " AB 12 " },
        },
      ],
    });
    expect(data).toEqual({
      passes: [
        {
          type: "eventTicket",
          title: "Jazz Night",
          notes: "Line 1\nLine 2",
          barcode: { format: "qr", message: "  AB  12\n", altText: "AB 12" },
        },
      ],
    });
    expect(warnings).toEqual([]);
  });

  it("drops empty values and says which, per pass", () => {
    const { data, warnings } = cleanImport({
      schemaVersion: "1.0",
      source: { sender: " ", subject: "Tickets" },
      passes: [
        { type: "generic", title: "A", subtitle: "", seat: { row: null, number: "  " }, extraFields: [], venue: {} },
        { type: "generic", title: "B", warnings: ["", "Check the date."] },
      ],
    });
    expect(data).toEqual({
      schemaVersion: "1.0",
      source: { subject: "Tickets" },
      passes: [
        { type: "generic", title: "A" },
        { type: "generic", title: "B", warnings: ["Check the date."] },
      ],
    });
    expect(warnings).toEqual([
      { kind: "fix", message: "Ignored an empty field: source.sender." },
      { kind: "fix", pass: 0, message: "Ignored empty fields: subtitle, seat.row, seat.number, extraFields, venue." },
    ]);
  });

  it("keeps every pass, even an empty one, so pass numbers match the JSON", () => {
    expect(cleanImport({ passes: [{}, { type: "generic", title: "B" }] }).data).toEqual({
      passes: [{}, { type: "generic", title: "B" }],
    });
    expect(cleanImport({ schemaVersion: "1.0", passes: [] }).data).toEqual({ schemaVersion: "1.0", passes: [] });
  });

  it("removes attachments without a full https link", () => {
    const { data, warnings } = cleanImport({
      passes: [
        {
          type: "generic",
          title: "A",
          attachments: [
            { title: "Map", url: "http://example.com/map.pdf" },
            { title: "Tickets", url: "https://example.com/tickets.pdf" },
            { url: "https://example.com/a b" },
          ],
        },
      ],
    });
    expect(data).toEqual({
      passes: [{ type: "generic", title: "A", attachments: [{ title: "Tickets", url: "https://example.com/tickets.pdf" }] }],
    });
    expect(warnings).toEqual([
      { kind: "fix", pass: 0, message: "Removed “Map” because its link isn't a full https:// link." },
      { kind: "fix", pass: 0, message: "Removed an attachment because its link isn't a full https:// link." },
    ]);
  });
});

describe("over-long display text", () => {
  const longTitle = "Deyun Club’s 30th Anniversary Cross Talk Show featuring Yue Yunpeng and Sun Yue - Singapore";

  it("shortens a too-long title at a word, with a warning, and the import then works", () => {
    const reply = JSON.stringify({ schemaVersion: "1.1", passes: [{ type: "eventTicket", title: longTitle, start: "2026-10-10T19:30:00+08:00" }] });
    const result = processImport(reply);
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const title = result.value.passes[0].title;
    expect(Array.from(title).length).toBeLessThanOrEqual(80);
    expect(title).toBe("Deyun Club’s 30th Anniversary Cross Talk Show featuring Yue Yunpeng and Sun…");
    expect(result.warnings).toContainEqual({ kind: "fix", pass: 0, message: "Shortened the title to 80 characters. Check that it still reads well." });
  });

  it("counts characters the way the schema does, by code point", () => {
    expect(shorten("🎫".repeat(81), 80)).toBe(`${"🎫".repeat(79)}…`);
    expect(shorten("short", 80)).toBe("short");
    expect(Array.from(shorten("x".repeat(500), 60))).toHaveLength(60);
  });

  it("never shortens codes, IDs or barcodes: those stay errors to fix", () => {
    const code = "A".repeat(41);
    const result = processImport(JSON.stringify({ schemaVersion: "1.1", passes: [{ type: "generic", title: "Pass", confirmationCode: code, barcode: { format: "qr", message: "Q".repeat(2001) } }] }));
    expect(result.ok).toBe(false);
    const { data } = cleanImport({ passes: [{ confirmationCode: code }] });
    expect((data as { passes: { confirmationCode: string }[] }).passes[0].confirmationCode).toBe(code);
  });

  it("uses the schema's own limits", () => {
    const schema = JSON.parse(readFileSync("schema/passclip-import.v1.schema.json", "utf8"));
    const resolve = (node: Record<string, unknown>): Record<string, unknown> => (typeof node.$ref === "string" ? schema.$defs[node.$ref.split("/").pop()!] : node);
    const limitAt = (root: Record<string, unknown>, field: (string | null)[]) =>
      field.reduce<Record<string, unknown>>((node, part) => {
        const here = resolve(node);
        return resolve(part === null ? (here.items as Record<string, unknown>) : (here.properties as Record<string, Record<string, unknown>>)[part]);
      }, root).maxLength;
    for (const { field, max } of TEXT_LIMITS.pass) expect([field.join("."), limitAt(schema.$defs.pass, field)]).toEqual([field.join("."), max]);
    for (const { field, max } of TEXT_LIMITS.root) expect([field.join("."), limitAt(schema, field)]).toEqual([field.join("."), max]);
  });
});
