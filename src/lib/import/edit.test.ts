import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withBarcode } from "./edit";
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
