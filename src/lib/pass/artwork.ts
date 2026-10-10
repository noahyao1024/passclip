import { hexToRgb, hslToRgb, luminance, MIN_CONTRAST, rgbToHsl, type ResolvedStyle, type RGB } from "./colors";
import { encodePng } from "./png";
import { seeded } from "./seed";

/**
 * The picture behind an event ticket. Wallet blurs a pass's background image and draws the whole card
 * over it, so a soft, colorful picture fills the empty space below the fields. It is drawn from the
 * pass's own colors, with no outside images, and the same colors always give the same picture.
 *
 * Apple's Human Interface Guidelines for Wallet (checked 2026-10-10, docs/DECISIONS.md D26): a
 * non-poster event ticket's background is 343 × 503 points and is blurred behind the content; a thumbnail
 * is 60 to 90 points wide and 90 high. Older docs gave 180 × 220 and said a strip can't be combined with a
 * background. Files are wanted at @1x, @2x and @3x.
 */
export const BACKGROUND_POINTS = { width: 343, height: 503 } as const;
export const BACKGROUND_FILES = [
  { name: "background.png", scale: 1 },
  { name: "background@2x.png", scale: 2 },
  { name: "background@3x.png", scale: 3 },
] as const;

export interface Glow { x: number; y: number; radius: number; color: RGB; strength: number; /** Not dimmed by the calm top of the card. */ anchored?: boolean }
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
  const glows: Glow[] = Array.from({ length: 9 }, (_, index) => ({
    x: random(),
    // Skewed toward the bottom, where the card has no fields.
    y: 0.25 + random() ** 0.8 * 0.9,
    radius: 0.2 + random() * 0.5,
    color: palette[index % palette.length],
    strength: 0.55 + random() * 0.45,
  }));
  // Wallet's stack shows only the top of each pass, so the top edge carries color too.
  glows.push(...[0, 1].map((index): Glow => ({
    x: index === 0 ? 0.05 + random() * 0.25 : 0.6 + random() * 0.3,
    y: 0.02 + random() * 0.05,
    radius: 0.42 + random() * 0.18,
    color: palette[index === 0 ? 1 : 0],
    strength: 0.6,
    anchored: true,
  })));
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
        if (distance < 1) { const weight = smooth(1 - distance) * glow.strength * (glow.anchored ? 1 : lower); r += glow.light[0] * weight; g += glow.light[1] * weight; b += glow.light[2] * weight; }
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

/** A half-size picture as base64, for the iPhone app's preview (it is blurred there anyway). */
export function artworkPreview(style: ResolvedStyle): string | undefined {
  const spec = artworkSpec(style);
  if (!spec) return undefined;
  const width = Math.round(BACKGROUND_POINTS.width / 2), height = Math.round(BACKGROUND_POINTS.height / 2);
  return encodePng(width, height, renderArtwork(spec, width, height)).toString("base64");
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

/**
 * A small ticket emblem for the header, in the pass's text color: a ticket with a notch on each side and
 * a dashed tear line. It stands in for a brand logo, which Passclip can't know, and says what the pass is.
 */
export const LOGO_POINTS = { width: 36, height: 30 } as const;
export const LOGO_FILES = [
  { name: "logo.png", scale: 1 },
  { name: "logo@2x.png", scale: 2 },
  { name: "logo@3x.png", scale: 3 },
] as const;

export function renderTicketLogo(scale: number, color: RGB): Uint8Array {
  const width = LOGO_POINTS.width * scale;
  const height = LOGO_POINTS.height * scale;
  const output = new Uint8Array(width * height * 4);
  const center = { x: 18, y: 15 }, half = { x: 15, y: 10 }, radius = 3.5, notch = 3.2, tearX = 25.5;
  const dashes = [0, 1, 2, 3, 4].map((index) => ({ x: tearX, y: 7.9 + index * 3.3 }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = (x + 0.5) / scale, py = (y + 0.5) / scale;
      // Signed distance in points: negative inside the ticket.
      const qx = Math.abs(px - center.x) - (half.x - radius), qy = Math.abs(py - center.y) - (half.y - radius);
      let distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      for (const side of [center.x - half.x, center.x + half.x]) distance = Math.max(distance, notch - Math.hypot(px - side, py - center.y));
      for (const dash of dashes) {
        const dx = Math.abs(px - dash.x) - 0.65, dy = Math.abs(py - dash.y) - 1.05;
        distance = Math.max(distance, -(Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)));
      }
      const alpha = Math.min(1, Math.max(0, 0.5 - distance * scale));
      const offset = (y * width + x) * 4;
      output[offset] = color[0]; output[offset + 1] = color[1]; output[offset + 2] = color[2];
      output[offset + 3] = Math.round(alpha * 255);
    }
  }
  return output;
}

/** The three logo files for an event ticket's package, drawn in its text color. */
export function ticketLogoFiles(style: ResolvedStyle): Record<string, Buffer> {
  const color = hexToRgb(style.foregroundColor);
  return Object.fromEntries(LOGO_FILES.map(({ name, scale }) => [name, encodePng(LOGO_POINTS.width * scale, LOGO_POINTS.height * scale, renderTicketLogo(scale, color), 4)]));
}
