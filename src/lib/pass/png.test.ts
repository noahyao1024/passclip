import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { encodePng } from "./png";

describe("PNG encoder", () => {
  it("writes a valid image that decodes to exactly the same pixels", () => {
    const width = 37, height = 23;
    const rgb = new Uint8Array(width * height * 3).map((_, index) => (index * 31 + Math.floor(index / 7)) % 256);
    const image = PNG.sync.read(encodePng(width, height, rgb));
    expect([image.width, image.height]).toEqual([width, height]);
    for (let pixel = 0; pixel < width * height; pixel++) {
      expect([image.data[pixel * 4], image.data[pixel * 4 + 1], image.data[pixel * 4 + 2], image.data[pixel * 4 + 3]]).toEqual([rgb[pixel * 3], rgb[pixel * 3 + 1], rgb[pixel * 3 + 2], 255]);
    }
  });

  it("makes smooth gradients small and refuses pixel data of the wrong size", () => {
    const width = 360, height = 440;
    const gradient = new Uint8Array(width * height * 3).map((_, index) => Math.floor(index / 3 / width / 3) + (index % 3) * 10);
    expect(encodePng(width, height, gradient).length).toBeLessThan(width * height * 3 / 20);
    expect(() => encodePng(10, 10, new Uint8Array(5))).toThrow("doesn't match");
  });
});
