import { hexToRgb, hslToRgb, luminance, MIN_CONTRAST, rgbToHsl, type ResolvedStyle, type RGB } from "./colors";
import { encodePng } from "./png";
import { seeded } from "./seed";

/**
 * The picture behind an event ticket. Wallet blurs a pass's background image and draws the whole card
 * over it, so a soft, colorful picture fills the empty space below the fields. It is drawn from the
 * pass's own colors, with no outside images, and the same colors always give the same picture.
 *
 * Apple's docs (checked 2026-10-10, docs/DECISIONS.md D26): an event pass shows logo, strip,
 * background or thumbnail images; a strip can't be combined with a background; the background is
 * 180 × 220 points, cropped slightly and blurred, and wants @1x, @2x and @3x files.
 */
export const BACKGROUND_POINTS = { width: 180, height: 220 } as const;
export const BACKGROUND_FILES = [
  { name: "background.png", scale: 1 },
  { name: "background@2x.png", scale: 2 },
  { name: "background@3x.png", scale: 3 },
] as const;

export interface Glow { x: number; y: number; radius: number; color: RGB; strength: number }
export interface Ring { x: number; y: number; radius: number; width: number; color: RGB; strength: number }
export interface ArtworkSpec {
  top: RGB;
  bottom: RGB;
  glows: Glow[];
  rings: Ring[];
  /** The brightest any pixel may be, so the pass's text keeps at least 4.5:1 contrast everywhere. */
  maxLuminance: number;
}

const srgbToLinear = (value: number) => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const linearToSrgb = (value: number) => Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
const linearLuminance = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (value: number) => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };

/** A glow's color as linear light, scaled so that one glow at full strength reaches about the brightest allowed pixel. */
function glowLight(color: RGB, maxLuminance: number): RGB {
  const linear = color.map(srgbToLinear) as RGB;
  const factor = maxLuminance * 0.9 / Math.max(linearLuminance(linear), 1e-6);
  return linear.map((channel) => channel * factor) as RGB;
}

/** The picture's drawing plan for a pass's colors, or nothing when the colors don't suit a picture (light passes). */
export function artworkSpec(style: ResolvedStyle): ArtworkSpec | undefined {
  const background = luminance(style.backgroundColor);
  const text = luminance(style.foregroundColor);
  const label = luminance(style.labelColor);
  if (text <= background || label <= background) return undefined;
  // Pixel luminance L keeps contrast >= 4.5 with text of luminance T when (T + 0.05) / (L + 0.05) >= 4.5.
  const base = hexToRgb(style.backgroundColor);
  const { hue, saturation } = rgbToHsl(base);
  // Green carries most of a color's brightness, so greens need a little more room to look as rich as blues.
  const richness = hue >= 70 && hue <= 200 ? 0.11 : 0.085;
  const maxLuminance = Math.min(((Math.min(text, label) + 0.05) / MIN_CONTRAST - 0.05) * 0.96, richness);
  if (maxLuminance < background + 0.012) return undefined;

  // A gray pass gets gentler colors than a saturated one.
  const vivid = Math.min(1, 0.35 + saturation * 1.6);
  const accent = (offset: number, sat: number, light: number) => hslToRgb(hue + offset, sat * vivid, light);
  // Neighbouring hues only: opposite colors mix into mud.
  const palette = [accent(28, 0.85, 0.5), accent(-28, 0.8, 0.48), accent(54, 0.75, 0.5), accent(-52, 0.8, 0.5)];

  const random = seeded(style.backgroundColor);
  const glows: Glow[] = Array.from({ length: 7 }, (_, index) => ({
    x: random(),
    // Skewed toward the bottom, where the card has no fields.
    y: 0.25 + random() ** 0.8 * 0.9,
    radius: 0.3 + random() * 0.42,
    color: palette[index % palette.length],
    strength: 0.55 + random() * 0.45,
  }));
  const ringX = 0.15 + random() * 0.7;
  const rings: Ring[] = [0.5, 0.82].map((radius, index) => ({ x: ringX, y: 1.05 + random() * 0.15, radius, width: 0.07, color: palette[index], strength: 0.3 }));
  const bottom = base.map((channel, index) => Math.round(channel + (palette[0][index] - channel) * 0.35)) as RGB;
  return { top: base, bottom, glows, rings, maxLuminance };
}

/** Raw RGB pixels, row by row. Colors are added as light (linear), then no pixel is allowed past `maxLuminance`. */
export function renderArtwork(spec: ArtworkSpec, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height * 3);
  const aspect = height / width;
  const top = spec.top.map(srgbToLinear) as RGB;
  const bottom = spec.bottom.map(srgbToLinear) as RGB;
  const glows = spec.glows.map((glow) => ({ ...glow, light: glowLight(glow.color, spec.maxLuminance) }));
  const rings = spec.rings.map((ring) => ({ ...ring, light: glowLight(ring.color, spec.maxLuminance) }));

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const blend = smooth(v);
    // The top of the card holds the logo and title, so the picture stays calm there and grows toward the bottom.
    const lower = 0.25 + 0.75 * smooth((v - 0.15) / 0.5);
    const rowR = top[0] + (bottom[0] - top[0]) * blend, rowG = top[1] + (bottom[1] - top[1]) * blend, rowB = top[2] + (bottom[2] - top[2]) * blend;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      let r = rowR, g = rowG, b = rowB;
      for (const glow of glows) {
        const dx = u - glow.x, dy = (v - glow.y) * aspect;
        const distance = Math.sqrt(dx * dx + dy * dy) / glow.radius;
        if (distance < 1) { const weight = smooth(1 - distance) * glow.strength * lower; r += glow.light[0] * weight; g += glow.light[1] * weight; b += glow.light[2] * weight; }
      }
      for (const ring of rings) {
        const dx = u - ring.x, dy = (v - ring.y) * aspect;
        const distance = Math.abs(Math.sqrt(dx * dx + dy * dy) - ring.radius) / ring.width;
        if (distance < 1) { const weight = smooth(1 - distance) * ring.strength * lower; r += ring.light[0] * weight; g += ring.light[1] * weight; b += ring.light[2] * weight; }
      }
      const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (brightness > spec.maxLuminance) { const factor = spec.maxLuminance / brightness; r *= factor; g *= factor; b *= factor; }
      const offset = (y * width + x) * 3;
      output[offset] = Math.min(255, Math.max(0, linearToSrgb(r)));
      output[offset + 1] = Math.min(255, Math.max(0, linearToSrgb(g)));
      output[offset + 2] = Math.min(255, Math.max(0, linearToSrgb(b)));
    }
  }
  return output;
}

// Drawing takes a few hundred milliseconds, and the same colors come back (a preview, then the pass).
const cache = new Map<string, Record<string, Buffer>>();

/** The files for the pass package, or nothing when these colors don't suit a picture. */
export function artworkFiles(style: ResolvedStyle): Record<string, Buffer> | undefined {
  const spec = artworkSpec(style);
  if (!spec) return undefined;
  const key = `${style.backgroundColor}${style.foregroundColor}${style.labelColor}`;
  const known = cache.get(key);
  if (known) return known;
  const files = Object.fromEntries(BACKGROUND_FILES.map(({ name, scale }) => {
    const width = BACKGROUND_POINTS.width * scale;
    const height = BACKGROUND_POINTS.height * scale;
    return [name, encodePng(width, height, renderArtwork(spec, width, height))];
  }));
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, files);
  return files;
}

/** The 1x picture as base64, for the iPhone app's preview. */
export function artworkPreview(style: ResolvedStyle): string | undefined {
  const spec = artworkSpec(style);
  if (!spec) return undefined;
  return encodePng(BACKGROUND_POINTS.width, BACKGROUND_POINTS.height, renderArtwork(spec, BACKGROUND_POINTS.width, BACKGROUND_POINTS.height)).toString("base64");
}

/** The same plan as CSS gradients, for the website's preview, which runs in the browser. */
export function artworkCss(style: ResolvedStyle): string | undefined {
  const spec = artworkSpec(style);
  if (!spec) return undefined;
  const css = (color: RGB, alpha = 1) => `rgba(${color.join(",")},${alpha})`;
  const layers = spec.glows.map((glow) => {
    // The glow's own color, dimmed to the brightest allowed pixel, as in the picture itself.
    const light = glowLight(glow.color, spec.maxLuminance).map(linearToSrgb) as RGB;
    return `radial-gradient(circle at ${(glow.x * 100).toFixed(1)}% ${(glow.y / 1.1 * 100).toFixed(1)}%, ${css(light, Number(Math.min(1, 0.9 * glow.strength).toFixed(2)))} 0, transparent ${(glow.radius * 100).toFixed(0)}%)`;
  });
  return [...layers, `linear-gradient(to bottom, ${css(spec.top)}, ${css(spec.bottom)})`].join(", ");
}
