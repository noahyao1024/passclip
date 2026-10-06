import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";

// The placeholder iPhone app icon (1024×1024, opaque): a white pass with ticket notches and a
// perforation line on Signal blue (docs/SPEC.md §10). Replace with final art before launch.
const SIZE = 1024;
const SIGNAL = [0x33, 0x46, 0xd3];
const WHITE = [0xff, 0xff, 0xff];
const STEEL = [0x8b, 0x96, 0xa8];

// pngjs keeps pixels as RGBA in memory and drops the alpha channel when writing colorType 2.
const png = new PNG({ width: SIZE, height: SIZE });
const card = { left: 262, right: 762, top: 190, bottom: 834, radius: 64 };
const notchY = 600;
const notchR = 46;

function inCard(x: number, y: number) {
  if (x < card.left || x > card.right || y < card.top || y > card.bottom) return false;
  const cx = Math.min(Math.max(x, card.left + card.radius), card.right - card.radius);
  const cy = Math.min(Math.max(y, card.top + card.radius), card.bottom - card.radius);
  if ((x - cx) ** 2 + (y - cy) ** 2 > card.radius ** 2) return false;
  // Ticket notches on both sides.
  return (x - card.left) ** 2 + (y - notchY) ** 2 > notchR ** 2 && (x - card.right) ** 2 + (y - notchY) ** 2 > notchR ** 2;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let color = SIGNAL;
    if (inCard(x, y)) {
      color = WHITE;
      const perforation = Math.abs(y - notchY) <= 5 && x > card.left + notchR + 24 && x < card.right - notchR - 24 && Math.floor((x - card.left) / 28) % 2 === 0;
      const lines = [[300, 52], [380, 52], [700, 34]].some(([top, h]) => y >= top && y < top + h && x >= card.left + 70 && x <= (top === 380 ? card.left + 280 : card.right - 70));
      if (lines) color = SIGNAL;
      if (perforation) color = STEEL;
    }
    const i = (y * SIZE + x) * 4;
    png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255;
  }
}

writeFileSync("ios/AppResources/Assets.xcassets/AppIcon.appiconset/AppIcon.png", PNG.sync.write(png, { colorType: 2 }));
console.log("Wrote the 1024×1024 app icon.");
