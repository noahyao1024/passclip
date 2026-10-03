import * as encoders from "bwip-js/browser";
import { describe, expect, it, vi } from "vitest";
import type { Barcode } from "../lib/import/types";
import { renderBarcode } from "./barcode-preview";

// Calls still reach the real encoders; inspect their input at the rendering boundary.
vi.mock("bwip-js/browser", { spy: true });

describe("local barcode previews", () => {
  it.each<Barcode["format"]>(["qr", "pdf417", "aztec", "code128"])("renders a real %s encoder as a local SVG image", async (format) => {
    const image = await renderBarcode({ format, message: "PC-123456789" });
    expect(image.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const svg = decodeURIComponent(image.src.slice(image.src.indexOf(",") + 1));
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("<path");
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
    expect(svg).not.toMatch(/<script|<foreignObject|<image|href=/);
  });

  it.each<Barcode["format"]>(["qr", "pdf417", "aztec", "code128"])("preserves leading/trailing spaces and literal escape syntax in %s data", async (format) => {
    const original = { format, message: "  PC^123^FNC1  " };
    const names = { qr: "qrcode", pdf417: "pdf417", aztec: "azteccode", code128: "code128" } as const;
    const encoder = vi.mocked(encoders[names[format]]);
    encoder.mockClear();
    try {
      const exact = await renderBarcode(original);
      expect(encoder).toHaveBeenCalledWith(expect.objectContaining({
        text: original.message,
        parse: false,
        parsefnc: false,
      }), expect.anything());
      const trimmed = await renderBarcode({ format, message: original.message.trim() });
      expect(exact.src).not.toBe(trimmed.src);
      expect(original.message).toBe("  PC^123^FNC1  ");
    } finally {
      encoder.mockClear();
    }
  });

  it("renders both Latin-1 and Unicode without rewriting the source message", async () => {
    const latin = await renderBarcode({ format: "qr", message: "CAFÉ-123" });
    const unicode = await renderBarcode({ format: "qr", message: "東京-🎟️-123" });
    expect(latin.width).toBeGreaterThan(0);
    expect(unicode.width).toBeGreaterThan(0);
    expect(latin.src).not.toBe(unicode.src);
    const newline = await renderBarcode({ format: "qr", message: "line one\nline two" });
    const space = await renderBarcode({ format: "qr", message: "line one line two" });
    expect(newline.src).not.toBe(space.src);
  });

  it("fails visibly instead of inventing a barcode when exact data cannot be encoded", async () => {
    await expect(renderBarcode({ format: "code128", message: "" })).rejects.toBeDefined();
    await expect(renderBarcode({ format: "qr", message: "\ud800" })).rejects.toBeDefined();
  });
});
