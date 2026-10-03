import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

// Neutral placeholder art, not Apple's Wallet badge. Replace with final brand assets before launch.
// Sizes in points from Apple's Human Interface Guidelines (Wallet), checked 2026-10-03:
// icon 38×38 for every pass style; logo 50 tall and 50–160 wide. PNG at 1×, 2× and 3×.
const SIGNAL = [0x33, 0x46, 0xd3] as const;

const root = path.join(process.cwd(), "pass-models/default.pass");
mkdirSync(root, { recursive: true });
for (const scale of [1, 2, 3]) {
  for (const [name, width, height] of [["icon", 38, 38], ["logo", 160, 50]] as const) {
    const image = new PNG({ width: width * scale, height: height * scale });
    // The clip shape was drawn for a 29 pt icon; the icon scales it to fit, the logo keeps it.
    const shape = name === "icon" ? width / 29 : 1;
    const centerX = name === "icon" ? width / 2 : 24;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const px = x / scale, py = y / scale;
      const dx = (px - centerX) / shape, dy = (py - height / 2) / shape;
      const outer = Math.abs(Math.hypot(dx / 7, dy / 11) - 1) < .16;
      const inner = Math.abs(Math.hypot(dx / 3.5, dy / 7) - 1) < .2;
      const clip = outer || inner;
      const i = (y * image.width + x) * 4;
      // The icon appears in notifications, often on light backgrounds, so it gets an opaque
      // background. The logo sits on the pass color, so it stays transparent.
      const [r, g, b] = clip || name === "logo" ? [255, 255, 255] : SIGNAL;
      image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b;
      image.data[i + 3] = clip || name === "icon" ? 255 : 0;
    }
    writeFileSync(path.join(root, `${name}${scale === 1 ? "" : `@${scale}x`}.png`), PNG.sync.write(image));
  }
}
