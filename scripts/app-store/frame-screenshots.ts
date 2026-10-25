// Frames simulator screenshots for the App Store: a short caption above the app, on the passes' blue-to-violet glow.
//   npx tsx scripts/app-store/frame-screenshots.ts <folder>
// The folder holds iPhone 6.9" simulator screenshots (1320 × 2868) and captions.json: [{ "file": "1-home.png", "caption": "…" }].
// Writes <folder>/framed/iphone-<name>.jpg (1320 × 2868) and <folder>/framed/ipad-<name>.jpg (2064 × 2752, Apple's iPad 13" size).
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const sizes = [
  { name: "iphone", width: 1320, height: 2868, caption: 92, shot: 0.8 },
  { name: "ipad", width: 2064, height: 2752, caption: 118, shot: 0.78 },
] as const;

function page(caption: string, image: string, size: (typeof sizes)[number]) {
  const escaped = caption.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${size.width}px; height: ${size.height}px; overflow: hidden; }
    body { background: radial-gradient(120% 70% at 20% 0%, #4a52e0 0%, #2a2e9c 45%, #5a1480 100%);
      font-family: -apple-system, "SF Pro Display", system-ui, sans-serif; color: #fff;
      display: flex; flex-direction: column; align-items: center; }
    h1 { font-size: ${size.caption}px; line-height: 1.08; font-weight: 700; letter-spacing: -0.02em; text-align: center;
      margin: ${Math.round(size.height * 0.055)}px ${Math.round(size.width * 0.08)}px 0; max-width: ${Math.round(size.width * 0.84)}px; text-wrap: balance; }
    img { margin-top: auto; height: ${Math.round(size.height * size.shot)}px; border-radius: ${Math.round(size.height * size.shot * 0.045)}px ${Math.round(size.height * size.shot * 0.045)}px 0 0;
      box-shadow: 0 0 0 ${Math.round(size.width * 0.012)}px rgba(255,255,255,0.18), 0 40px 120px rgba(10,6,40,0.55); }
  </style></head><body><h1>${escaped}</h1><img src="${image}"></body></html>`;
}

async function main() {
  const folder = process.argv[2];
  if (!folder) throw new Error("usage: frame-screenshots.ts <folder>");
  const items = JSON.parse(readFileSync(join(folder, "captions.json"), "utf8")) as { file: string; caption: string }[];
  mkdirSync(join(folder, "framed"), { recursive: true });
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  for (const size of sizes) {
    const tab = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
    for (const item of items) {
      const image = `data:image/png;base64,${readFileSync(join(folder, item.file)).toString("base64")}`;
      await tab.setContent(page(item.caption, image, size), { waitUntil: "load" });
      // JPEG, so there is no alpha channel for App Store Connect to refuse.
      await tab.screenshot({ path: join(folder, "framed", `${size.name}-${item.file.replace(/\.png$/, ".jpg")}`), type: "jpeg", quality: 92 });
      console.log("framed", size.name, item.file);
    }
    await tab.close();
  }
  await browser.close();
}

main().catch((error) => { console.error(error.message); process.exit(1); });
