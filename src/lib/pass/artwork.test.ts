import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { artworkCss, artworkFiles, artworkPreview, artworkSpec, renderArtwork } from "./artwork";
import { contrastRatio, MIN_CONTRAST, normalizeColors, type ResolvedStyle } from "./colors";

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
const designed = (seed: string) => normalizeColors("eventTicket", undefined, seed).style;

describe("event ticket artwork", () => {
  it("keeps the text readable on every pixel, for many colors", () => {
    for (let index = 0; index < 80; index++) {
      const style = designed(`Organizer ${index}\nEvent ${index * 7}`);
      const spec = artworkSpec(style);
      expect(spec, style.backgroundColor).toBeDefined();
      const width = 36, height = 44;
      const pixels = renderArtwork(spec!, width, height);
      let worst = Infinity;
      for (let pixel = 0; pixel < width * height; pixel++) {
        const color = hex(pixels[pixel * 3], pixels[pixel * 3 + 1], pixels[pixel * 3 + 2]);
        worst = Math.min(worst, contrastRatio(style.foregroundColor, color), contrastRatio(style.labelColor, color));
      }
      expect(worst, style.backgroundColor).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  }, 30_000);

  it("also keeps text readable on colors the person chose", () => {
    const style: ResolvedStyle = { backgroundColor: "#3B2A20", foregroundColor: "#FFFFFF", labelColor: "#E8C9A0" };
    const spec = artworkSpec(style)!;
    const pixels = renderArtwork(spec, 45, 55);
    for (let pixel = 0; pixel < 45 * 55; pixel++) {
      const color = hex(pixels[pixel * 3], pixels[pixel * 3 + 1], pixels[pixel * 3 + 2]);
      expect(contrastRatio(style.labelColor, color)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("draws nothing for light passes or colors with no room for a picture", () => {
    expect(artworkSpec({ backgroundColor: "#FFFFFF", foregroundColor: "#000000", labelColor: "#444444" })).toBeUndefined();
    expect(artworkSpec({ backgroundColor: "#777777", foregroundColor: "#FFFFFF", labelColor: "#F0F0F0" })).toBeUndefined();
    expect(artworkFiles({ backgroundColor: "#FFFFFF", foregroundColor: "#000000", labelColor: "#444444" })).toBeUndefined();
    expect(artworkPreview({ backgroundColor: "#FFFFFF", foregroundColor: "#000000", labelColor: "#444444" })).toBeUndefined();
    expect(artworkCss({ backgroundColor: "#FFFFFF", foregroundColor: "#000000", labelColor: "#444444" })).toBeUndefined();
  });

  it("gives the same picture for the same colors and a different one for different colors", () => {
    const first = renderArtwork(artworkSpec(designed("A\nB"))!, 30, 40);
    expect(renderArtwork(artworkSpec(designed("A\nB"))!, 30, 40)).toEqual(first);
    expect(renderArtwork(artworkSpec(designed("C\nD"))!, 30, 40)).not.toEqual(first);
  });

  it("makes Wallet's three background sizes as small PNG files", () => {
    const files = artworkFiles(designed("SISTIC\nCross Talk Show"))!;
    expect(Object.keys(files)).toEqual(["background.png", "background@2x.png", "background@3x.png"]);
    for (const [scale, name] of [[1, "background.png"], [2, "background@2x.png"], [3, "background@3x.png"]] as const) {
      const image = PNG.sync.read(files[name]);
      expect([image.width, image.height]).toEqual([180 * scale, 220 * scale]);
      expect(files[name].length).toBeLessThan(150 * 1024);
    }
  });

  it("makes the preview picture and the website's CSS from the same plan", () => {
    const style = designed("SISTIC\nCross Talk Show");
    const preview = PNG.sync.read(Buffer.from(artworkPreview(style)!, "base64"));
    expect([preview.width, preview.height]).toEqual([180, 220]);
    const css = artworkCss(style)!;
    expect(css).toContain("radial-gradient(");
    expect(css).toMatch(/linear-gradient\(to bottom, rgba\(\d+,\d+,\d+,1\), rgba\(\d+,\d+,\d+,1\)\)$/);
  });
});
