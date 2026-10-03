import { describe, expect, it } from "vitest";
import { contrastRatio, contrastingForeground, DEFAULT_COLORS, MIN_CONTRAST, normalizeColors } from "./colors";

describe("pass colors", () => {
  it("uses the WCAG sRGB luminance calculation", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.478, 3);
    expect(contrastRatio("#AABBCC", "#AABBCC")).toBe(1);
  });

  it.each(Object.entries(DEFAULT_COLORS))("%s defaults have readable text and labels", (type, style) => {
    expect(contrastRatio(style.foregroundColor, style.backgroundColor)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastRatio(style.labelColor, style.backgroundColor)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(normalizeColors(type as keyof typeof DEFAULT_COLORS)).toEqual({ style, warnings: [] });
  });

  it("chooses whichever of black or white contrasts more", () => {
    expect(contrastingForeground("#FFFFFF")).toBe("#000000");
    expect(contrastingForeground("#000000")).toBe("#FFFFFF");
    expect(contrastingForeground("#777777")).toBe("#000000");
  });

  it("derives readable text and labels across dark, light and saturated backgrounds", () => {
    // A coarse RGB cube covers mixed channels and the boundary where black replaces white.
    for (const red of [0, 51, 102, 153, 204, 255]) {
      for (const green of [0, 51, 102, 153, 204, 255]) {
        for (const blue of [0, 51, 102, 153, 204, 255]) {
          const backgroundColor = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
          const result = normalizeColors("generic", { backgroundColor });
          expect(result.warnings).toEqual([]);
          expect(contrastRatio(result.style.foregroundColor, backgroundColor)).toBeGreaterThanOrEqual(MIN_CONTRAST);
          expect(contrastRatio(result.style.labelColor, backgroundColor)).toBeGreaterThanOrEqual(MIN_CONTRAST);
        }
      }
    }
  });

  it("corrects unreadable supplied colors with one warning per correction", () => {
    const result = normalizeColors("eventTicket", {
      backgroundColor: "#ffffff", foregroundColor: "#dddddd", labelColor: "#eeeeee",
    });
    expect(result.style.backgroundColor).toBe("#FFFFFF");
    expect(result.style.foregroundColor).toBe("#000000");
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/text color/);
    expect(result.warnings[1]).toMatch(/label color/);
    expect(contrastRatio(result.style.labelColor, result.style.backgroundColor)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("preserves readable custom colors without changing the input", () => {
    const input = { backgroundColor: "#3B2A20", foregroundColor: "#FFFFFF", labelColor: "#E8C9A0" };
    const before = structuredClone(input);
    expect(normalizeColors("storeCard", input)).toEqual({ style: input, warnings: [] });
    expect(input).toEqual(before);
  });

  it("keeps the type's background when only a text color is supplied", () => {
    const result = normalizeColors("coupon", { foregroundColor: "#FFFFFF" });
    expect(result.style.backgroundColor).toBe(DEFAULT_COLORS.coupon.backgroundColor);
    expect(contrastRatio(result.style.labelColor, result.style.backgroundColor)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});
