import { writeFileSync } from "node:fs";
import { encodePng } from "../src/lib/pass/png";

// The iPhone app icon (1024 × 1024, opaque; Xcode makes the other sizes): a white ticket, tilted, with a notch on
// each side and a dashed tear line, on the deep blue-to-violet glow Passclip's passes use. Run: npm run gen:app-icon
const SIZE = 1024;
const pixels = new Uint8Array(SIZE * SIZE * 3);
const toLinear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.min(1, v) ** (1 / 2.4) - 0.055));
const hex = (value: number) => [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(toLinear);
const top = hex(0x2a2a8c), bottom = hex(0x3a1260);
const glows = [
  { x: 0.18, y: 0.12, r: 0.75, color: hex(0x3346d3), strength: 0.9 },
  { x: 0.95, y: 0.95, r: 0.7, color: hex(0xb23ad0), strength: 0.7 },
  { x: 0.85, y: 0.15, r: 0.45, color: hex(0x5b6cff), strength: 0.35 },
];
const smooth = (t: number) => { const v = Math.min(1, Math.max(0, t)); return v * v * (3 - 2 * v); };

// The ticket in its own units (like the pass logo, 30 × 20 with radius 3.5), then scaled and tilted.
const scale = 21, angle = (-12 * Math.PI) / 180, cos = Math.cos(angle), sin = Math.sin(angle);
function ticketDistance(px: number, py: number): number {
  // Into ticket units, centered.
  const x0 = (px - SIZE / 2) / scale, y0 = (py - SIZE / 2) / scale;
  const x = x0 * cos + y0 * sin, y = -x0 * sin + y0 * cos;
  const qx = Math.abs(x) - (15 - 3.5), qy = Math.abs(y) - (10 - 3.5);
  let d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 3.5;
  for (const side of [-15, 15]) d = Math.max(d, 3.2 - Math.hypot(x - side, y));
  for (let i = 0; i < 5; i++) {
    const dx = Math.abs(x - 7.5) - 0.65, dy = Math.abs(y - (-7.1 + i * 3.3)) - 1.05;
    d = Math.max(d, -(Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)));
  }
  return d * scale; // back to pixels
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE, v = y / SIZE;
    const t = smooth(v * 0.7 + u * 0.3);
    let rgb = top.map((c, i) => c + (bottom[i] - c) * t);
    for (const glow of glows) {
      const w = smooth(1 - Math.hypot(u - glow.x, v - glow.y) / glow.r) * glow.strength;
      rgb = rgb.map((c, i) => c + glow.color[i] * w * 0.6);
    }
    // A soft shadow under the ticket, then the ticket itself.
    const shadow = smooth(1 - Math.max(0, ticketDistance(x - 10, y - 24)) / 60) * 0.35;
    rgb = rgb.map((c) => c * (1 - shadow));
    const alpha = Math.min(1, Math.max(0, 0.5 - ticketDistance(x, y)));
    rgb = rgb.map((c) => c * (1 - alpha) + 1 * alpha);
    const offset = (y * SIZE + x) * 3;
    for (let i = 0; i < 3; i++) pixels[offset + i] = Math.min(255, Math.max(0, toSrgb(rgb[i])));
  }
}

writeFileSync("ios/AppResources/Assets.xcassets/AppIcon.appiconset/AppIcon.png", encodePng(SIZE, SIZE, pixels));
console.log("Wrote the 1024 × 1024 app icon.");
