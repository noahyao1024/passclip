import { describe, expect, it } from "vitest";
import { cleanImport, cleanLine, cleanMultiline } from "./clean";

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
