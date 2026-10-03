import type { Pixels } from "./decode";

// Browser only: turns an image file into pixels on this device. Nothing is uploaded.

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// Large photos are scaled down: enough detail for codes, without freezing the page.
const MAX_SIDE = 2400;

export async function readImagePixels(file: Blob): Promise<Pixels> {
  // createImageBitmap applies the photo's orientation, so rotated phone photos come out upright.
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No 2D canvas");
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}
