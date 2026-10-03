import type { Pass, Style } from "../import/types";

export type ResolvedStyle = Required<Style>;

export const MIN_CONTRAST = 4.5;

export const DEFAULT_COLORS: Record<Pass["type"], ResolvedStyle> = {
  eventTicket: { backgroundColor: "#2D1E4A", foregroundColor: "#FFFFFF", labelColor: "#CDBEF0" },
  boardingPass: { backgroundColor: "#0F2C4C", foregroundColor: "#FFFFFF", labelColor: "#B9D3F0" },
  storeCard: { backgroundColor: "#1F4D3A", foregroundColor: "#FFFFFF", labelColor: "#BFE3CF" },
  coupon: { backgroundColor: "#8C2F39", foregroundColor: "#FFFFFF", labelColor: "#F4C7CC" },
  generic: { backgroundColor: "#2F3640", foregroundColor: "#FFFFFF", labelColor: "#C9D1DC" },
};

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as RGB;
}

function luminance(hex: string): number {
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

/** Resolve optional colors after schema validation; every readability fix has a warning. */
export function normalizeColors(type: Pass["type"], input?: Style): { style: ResolvedStyle; warnings: string[] } {
  const defaults = DEFAULT_COLORS[type];
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
