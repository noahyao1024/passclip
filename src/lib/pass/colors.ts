import type { Pass, Style } from "../import/types";
import { seeded } from "./seed";

export type ResolvedStyle = Required<Style>;

export const MIN_CONTRAST = 4.5;

export const DEFAULT_COLORS: Record<Pass["type"], ResolvedStyle> = {
  eventTicket: { backgroundColor: "#2D1E4A", foregroundColor: "#FFFFFF", labelColor: "#CDBEF0" },
  boardingPass: { backgroundColor: "#0F2C4C", foregroundColor: "#FFFFFF", labelColor: "#B9D3F0" },
  storeCard: { backgroundColor: "#1F4D3A", foregroundColor: "#FFFFFF", labelColor: "#BFE3CF" },
  coupon: { backgroundColor: "#8C2F39", foregroundColor: "#FFFFFF", labelColor: "#F4C7CC" },
  generic: { backgroundColor: "#2F3640", foregroundColor: "#FFFFFF", labelColor: "#C9D1DC" },
};

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as RGB;
}
const rgb = hexToRgb;

/** WCAG relative luminance of a six-digit sRGB hex color. */
export function luminance(hex: string): number {
  const linear = rgb(hex).map((channel) => {
    const sRGB = channel / 255;
    return sRGB <= 0.04045 ? sRGB / 12.92 : ((sRGB + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

/** WCAG contrast ratio for two six-digit sRGB hex colors. */
export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function contrastingForeground(background: string): string {
  return contrastRatio("#FFFFFF", background) >= contrastRatio("#000000", background) ? "#FFFFFF" : "#000000";
}

function mix(foreground: string, background: string, amount: number): string {
  const front = rgb(foreground);
  const back = rgb(background);
  return `#${front.map((channel, i) => Math.round(channel + (back[i] - channel) * amount).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Soften the label toward the background as far as readable contrast permits. */
export function deriveLabelColor(foreground: string, background: string): string {
  let readable = 0;
  let unreadable = 1;
  // Test the rounded output itself: rounding an otherwise valid float can cross 4.5:1.
  for (let i = 0; i < 24; i++) {
    const amount = (readable + unreadable) / 2;
    if (contrastRatio(mix(foreground, background, amount), background) >= MIN_CONTRAST) readable = amount;
    else unreadable = amount;
  }
  return mix(foreground, background, readable);
}

export function hslToRgb(hue: number, saturation: number, lightness: number): RGB {
  const h = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [r, g, b].map((channel) => Math.round((channel + match) * 255)) as RGB;
}

export function rgbToHsl([red, green, blue]: RGB): { hue: number; saturation: number; lightness: number } {
  const [r, g, b] = [red / 255, green / 255, blue / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return { hue: 0, saturation: 0, lightness };
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation, lightness };
}

const toHex = (color: RGB) => `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** Hues that look good as a deep background: indigo, violet, magenta, rose, red, rust, teal, blues, emerald. */
const DESIGN_HUES = [248, 266, 284, 304, 324, 344, 6, 24, 196, 214, 230, 172];

/**
 * A deep, readable color scheme picked from a seed (the event's organizer and title), so every event
 * looks different and the same event always looks the same. White text and a tinted label read on it.
 */
export function designColors(seed: string): ResolvedStyle {
  const random = seeded(seed);
  const hue = DESIGN_HUES[Math.floor(random() * DESIGN_HUES.length)] + (random() - 0.5) * 10;
  const backgroundColor = toHex(hslToRgb(hue, 0.5 + random() * 0.15, 0.15 + random() * 0.04));
  return { backgroundColor, foregroundColor: "#FFFFFF", labelColor: toHex(hslToRgb(hue, 0.7, 0.88)) };
}

/**
 * Resolve optional colors after schema validation; every readability fix has a warning. Event tickets
 * with no colors of their own get a scheme picked from `seed`; everything else uses the type's default.
 */
export function normalizeColors(type: Pass["type"], input?: Style, seed?: string): { style: ResolvedStyle; warnings: string[] } {
  const designed = type === "eventTicket" && seed !== undefined && !input?.backgroundColor && !input?.foregroundColor && !input?.labelColor;
  const defaults = designed ? designColors(seed) : DEFAULT_COLORS[type];
  const backgroundColor = (input?.backgroundColor ?? defaults.backgroundColor).toUpperCase();
  const warnings: string[] = [];
  let foregroundColor = (input?.foregroundColor ?? (input?.backgroundColor ? contrastingForeground(backgroundColor) : defaults.foregroundColor)).toUpperCase();

  if (contrastRatio(foregroundColor, backgroundColor) < MIN_CONTRAST) {
    foregroundColor = contrastingForeground(backgroundColor);
    warnings.push("Changed the text color so it has enough contrast with the background (at least 4.5:1).");
  }

  let labelColor = (input?.labelColor ?? (input?.backgroundColor || input?.foregroundColor ? deriveLabelColor(foregroundColor, backgroundColor) : defaults.labelColor)).toUpperCase();
  if (contrastRatio(labelColor, backgroundColor) < MIN_CONTRAST) {
    labelColor = deriveLabelColor(foregroundColor, backgroundColor);
    warnings.push("Changed the label color so it has enough contrast with the background (at least 4.5:1).");
  }

  return { style: { backgroundColor, foregroundColor, labelColor }, warnings };
}
