import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

// Neutral placeholder art, not Apple's Wallet badge. Replace with final brand assets before launch.
const root = path.join(process.cwd(), "pass-models/default.pass");
mkdirSync(root, { recursive: true });
for (const scale of [1, 2, 3]) {
  for (const [name, width, height] of [["icon", 29, 29], ["logo", 160, 50]] as const) {
    const image = new PNG({ width: width * scale, height: height * scale });
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const px = x / scale, py = y / scale;
      const dx = px - (name === "icon" ? 14.5 : 24), dy = py - height / 2;
      const outer = Math.abs(Math.hypot(dx / 7, dy / 11) - 1) < .16;
      const inner = Math.abs(Math.hypot(dx / 3.5, dy / 7) - 1) < .2;
      const i = (y * image.width + x) * 4;
      image.data[i] = 255; image.data[i + 1] = 255; image.data[i + 2] = 255;
      image.data[i + 3] = outer || inner ? 255 : 0;
    }
    writeFileSync(path.join(root, `${name}${scale === 1 ? "" : `@${scale}x`}.png`), PNG.sync.write(image));
  }
}
