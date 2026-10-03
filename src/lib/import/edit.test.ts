import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withAttachment, withBarcode } from "./edit";
import { processImport } from "./process";

const train = readFileSync("examples/train-local-time.json", "utf8");
const tickets = readFileSync("examples/event-tickets.json", "utf8");

describe("withBarcode", () => {
  it("adds a barcode to the chosen pass and keeps everything else", () => {
    const updated = withBarcode(train, 0, { format: "qr", message: "  R-55120 7-12D  " })!;
    const before = JSON.parse(train);
    const after = JSON.parse(updated);
    expect(after.passes[0].barcode).toEqual({ format: "qr", message: "  R-55120 7-12D  " });
    expect({ ...after.passes[0], barcode: undefined }).toEqual({ ...before.passes[0], barcode: undefined });
    const result = processImport(updated, { fallbackTimeZone: "Asia/Tokyo" });
    expect(result.ok && result.value.passes[0].barcode?.message).toBe("  R-55120 7-12D  ");
  });

  it("only changes the pass it was asked to", () => {
    const after = JSON.parse(withBarcode(tickets, 1, { format: "aztec", message: "NEW" })!);
    expect(after.passes[0].barcode).toEqual(JSON.parse(tickets).passes[0].barcode);
    expect(after.passes[1].barcode).toEqual({ format: "aztec", message: "NEW" });
  });

  it("keeps the text under the code only when the code itself is unchanged", () => {
    const original = JSON.parse(tickets).passes[0].barcode;
    expect(JSON.parse(withBarcode(tickets, 0, original)!).passes[0].barcode).toEqual(original);
    expect(JSON.parse(withBarcode(tickets, 0, { format: "qr", message: "OTHER" })!).passes[0].barcode).toEqual({ format: "qr", message: "OTHER" });
  });

  it("works on replies Passclip had to recover, and refuses text it can't read or a missing pass", () => {
    const fenced = readFileSync("examples/recoverable/fenced-with-prose.txt", "utf8");
    expect(JSON.parse(withBarcode(fenced, 0, { format: "qr", message: "LIB" })!).passes[0].barcode).toEqual({ format: "qr", message: "LIB" });
    expect(withBarcode("not json", 0, { format: "qr", message: "X" })).toBeUndefined();
    expect(withBarcode(train, 3, { format: "qr", message: "X" })).toBeUndefined();
  });
});

describe("withAttachment", () => {
  const file = { title: "Venue map", url: "https://files.example.com/9f86d081884c7d659a2feaa0c55ad015/Venue-map.pdf", kind: "pdf" as const };

  it("adds the link after the pass's existing links, and the result still imports", () => {
    const before = JSON.parse(tickets);
    const after = JSON.parse(withAttachment(tickets, 0, file)!);
    expect(after.passes[0].attachments).toEqual([...(before.passes[0].attachments ?? []), file]);
    expect(after.passes[1]).toEqual(before.passes[1]);
    const result = processImport(JSON.stringify(after), { fallbackTimeZone: "Asia/Tokyo" });
    expect(result.ok && result.value.passes[0].attachments?.at(-1)).toEqual(file);
  });

  it("starts a list for a pass with no links", () => {
    expect(JSON.parse(withAttachment(train, 0, file)!).passes[0].attachments).toEqual([file]);
  });

  it("refuses text it can't read or a missing pass", () => {
    expect(withAttachment("not json", 0, file)).toBeUndefined();
    expect(withAttachment(train, 2, file)).toBeUndefined();
  });
});
