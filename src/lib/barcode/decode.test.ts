import bwipjs from "bwip-js/node";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { decodeBarcodes, type Pixels } from "./decode";

// Real images made with the same encoder library the preview uses, read back by the decoder.
const BCIDS = { qr: "qrcode", pdf417: "pdf417", aztec: "azteccode", code128: "code128" } as const;

async function render(format: keyof typeof BCIDS, text: string): Promise<PNG> {
  const buffer = await bwipjs.toBuffer({ bcid: BCIDS[format], text, scale: 3, padding: 10, backgroundcolor: "FFFFFF", ...(format === "code128" ? { height: 15 } : {}) });
  return PNG.sync.read(buffer);
}

/** Places images side by side on a white canvas, like a screenshot with several codes. */
function compose(images: PNG[], { gap = 60, invert = false } = {}): Pixels {
  const width = images.reduce((sum, image) => sum + image.width + gap, gap);
  const height = Math.max(...images.map((image) => image.height)) + gap * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let x0 = gap;
  for (const image of images) {
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const from = (y * image.width + x) * 4;
        const to = ((y + gap) * width + x + x0) * 4;
        data.set(image.data.subarray(from, from + 4), to);
      }
    }
    x0 += image.width + gap;
  }
  if (invert) for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = 255 - data[i + c];
  return { width, height, data };
}

const BOARDING = "M1TANAKA/AIKO MS EQ7XK2P HNDCDGZQ 0101 337Y034K0042 100";

describe("decodeBarcodes", () => {
  it.each([
    ["qr", "BL48213-01-F12-20261114"],
    ["pdf417", BOARDING],
    ["aztec", "R-55120 Tokyo-Kyoto car 7"],
    ["code128", "778122094410"],
  ] as const)("reads a %s code exactly", async (format, text) => {
    expect(decodeBarcodes(compose([await render(format, text)]))).toEqual([{ format, message: text }]);
  });

  it("keeps spaces and non-Latin text exactly as encoded", async () => {
    const text = "  東京 Ticket 12  ";
    expect(decodeBarcodes(compose([await render("qr", text)]))).toEqual([{ format: "qr", message: text }]);
  });

  it("lists every code in a screenshot with several, left to right", async () => {
    const pixels = compose([await render("qr", "TICKET-1"), await render("code128", "TICKET-2"), await render("pdf417", BOARDING)]);
    expect(decodeBarcodes(pixels)).toEqual([
      { format: "qr", message: "TICKET-1" },
      { format: "code128", message: "TICKET-2" },
      { format: "pdf417", message: BOARDING },
    ]);
  });

  it("finds Aztec codes that aren't in the middle of the image, even two side by side", async () => {
    expect(decodeBarcodes(compose([await render("qr", "LEFT"), await render("aztec", "RIGHT")]))).toEqual([
      { format: "qr", message: "LEFT" },
      { format: "aztec", message: "RIGHT" },
    ]);
    expect(decodeBarcodes(compose([await render("aztec", "A1"), await render("aztec", "A2")]))).toEqual([
      { format: "aztec", message: "A1" },
      { format: "aztec", message: "A2" },
    ]);
  });

  it("reads codes stacked on a tall phone screenshot from top to bottom", async () => {
    const top = compose([await render("aztec", "TOP")]);
    const bottom = compose([await render("qr", "BOTTOM")]);
    const width = Math.max(top.width, bottom.width) + 200;
    const height = 1800;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const place = (image: Pixels, x0: number, y0: number) => {
      for (let y = 0; y < image.height; y++) data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + y0) * width + x0) * 4);
    };
    place(top, 180, 150);
    place(bottom, 20, 1200);
    expect(decodeBarcodes({ width, height, data })).toEqual([
      { format: "aztec", message: "TOP" },
      { format: "qr", message: "BOTTOM" },
    ]);
  });

  it("reads a full-size phone screenshot quickly", async () => {
    const code = compose([await render("pdf417", BOARDING)]);
    const [width, height] = [1179, 2400];
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < code.height; y++) data.set(code.data.subarray(y * code.width * 4, (y + 1) * code.width * 4), ((y + 1500) * width + 40) * 4);
    const started = performance.now();
    expect(decodeBarcodes({ width, height, data })).toEqual([{ format: "pdf417", message: BOARDING }]);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("reads light codes on a dark background, as in dark-mode screenshots", async () => {
    expect(decodeBarcodes(compose([await render("qr", "DARK-MODE-1")], { invert: true }))).toEqual([{ format: "qr", message: "DARK-MODE-1" }]);
  });

  it("treats transparent pixels as white", async () => {
    const pixels = compose([await render("aztec", "SEE-THROUGH")]);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i] === 255) pixels.data[i + 3] = 0; // white becomes transparent
    }
    expect(decodeBarcodes(pixels)).toEqual([{ format: "aztec", message: "SEE-THROUGH" }]);
  });

  it("finds nothing in an image without a code", () => {
    const blank = { width: 200, height: 120, data: new Uint8ClampedArray(200 * 120 * 4).fill(255) };
    expect(decodeBarcodes(blank)).toEqual([]);
  });
});
