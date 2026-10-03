import {
  AztecCodeReader,
  BarcodeFormat,
  BinaryBitmap,
  Code128Reader,
  DecodeHintType,
  HybridBinarizer,
  PDF417Reader,
  QRCodeReader,
  RGBLuminanceSource,
  type Reader,
  type Result,
} from "@zxing/library";
import type { Barcode } from "../import/types";

// Reads barcodes from an image's pixels (docs/SPEC.md §7). Pure and local: the image never leaves
// the device, and the decoded text is used exactly as read (CLAUDE.md rule 3).

export interface DecodedCode {
  format: Barcode["format"];
  message: string;
}

/** RGBA pixels, as canvas getImageData returns them. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const FORMATS = new Map<BarcodeFormat, Barcode["format"]>([
  [BarcodeFormat.QR_CODE, "qr"],
  [BarcodeFormat.PDF_417, "pdf417"],
  [BarcodeFormat.AZTEC, "aztec"],
  [BarcodeFormat.CODE_128, "code128"],
]);
const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [...FORMATS.keys()]],
  [DecodeHintType.TRY_HARDER, true],
]);
const MAX_CODES = 6;

/** Grayscale, with transparent pixels shown over white, as on a screen. */
function luminance({ width, height, data }: Pixels, invert: boolean): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    const alpha = data[i * 4 + 3] / 255;
    const value = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) * alpha + 255 * (1 - alpha);
    gray[i] = invert ? 255 - value : value;
  }
  return gray;
}

// One reader per format, tried in turn. (ZXing's combined reader prints a console warning for
// every format it doesn't find.)
const READERS: Reader[] = [new QRCodeReader(), new PDF417Reader(), new AztecCodeReader(), new Code128Reader()];

function decodeOnce(gray: Uint8ClampedArray, width: number, height: number): Result | undefined {
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray, width, height)));
  for (const reader of READERS) {
    try {
      return reader.decode(bitmap, HINTS);
    } catch {
      // ZXing throws when it finds no code of this format, or one too damaged to read.
    } finally {
      reader.reset();
    }
  }
  return undefined;
}

/** Paints over a found code so the next pass can find the others. Returns false if it can't tell where the code is. */
function blankOut(gray: Uint8ClampedArray, width: number, height: number, result: Result): boolean {
  const points = (result.getResultPoints() ?? []).filter(Boolean);
  if (points.length === 0) return false;
  const xs = points.map((point) => point.getX());
  const ys = points.map((point) => point.getY());
  let [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const size = Math.max(right - left, bottom - top);
  if (result.getBarcodeFormat() === BarcodeFormat.CODE_128) {
    // A 1D code reports points along one scan line: cover its likely height too.
    const margin = Math.max(10, (right - left) * 0.1);
    [left, right, top, bottom] = [left - margin, right + margin, top - (right - left) * 0.6, bottom + (right - left) * 0.6];
  } else {
    // 2D codes report finder patterns or corners: widen to cover the whole symbol.
    const margin = Math.max(10, size * 0.25);
    [left, right, top, bottom] = [left - margin, right + margin, top - margin, bottom + margin];
  }
  const x0 = Math.max(0, Math.floor(left)), x1 = Math.min(width, Math.ceil(right));
  const y0 = Math.max(0, Math.floor(top)), y1 = Math.min(height, Math.ceil(bottom));
  for (let y = y0; y < y1; y++) gray.fill(255, y * width + x0, y * width + x1);
  return x1 > x0 && y1 > y0;
}

interface Found extends DecodedCode {
  /** Where the code is, in image pixels: its center and vertical extent. */
  x: number;
  y: number;
  top: number;
  bottom: number;
}

function decodeAll(gray: Uint8ClampedArray, width: number, height: number, offset = { x: 0, y: 0 }): Found[] {
  const found: Found[] = [];
  for (let attempt = 0; attempt < MAX_CODES; attempt++) {
    const result = decodeOnce(gray, width, height);
    if (!result) break;
    const format = FORMATS.get(result.getBarcodeFormat());
    const points = (result.getResultPoints() ?? []).filter(Boolean);
    const xs = points.map((point) => offset.x + point.getX()), ys = points.map((point) => offset.y + point.getY());
    const [top, bottom] = ys.length > 0 ? [Math.min(...ys), Math.max(...ys)] : [offset.y, offset.y + height];
    const x = xs.length > 0 ? (Math.min(...xs) + Math.max(...xs)) / 2 : offset.x + width / 2;
    const code = format && { format, message: result.getText(), x, y: (top + bottom) / 2, top, bottom };
    if (code && found.some((known) => known.format === code.format && known.message === code.message)) break;
    if (code) found.push(code);
    if (!blankOut(gray, width, height, result)) break;
  }
  return found;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_REGIONS = 12;

/**
 * Finds dark, dense areas that could be codes. ZXing's Aztec reader looks from the middle of the
 * image outwards, so codes off-center or next to another code are only found when read on their own.
 */
function candidateRegions(gray: Uint8ClampedArray, width: number, height: number): Box[] {
  const cell = Math.max(4, Math.round(Math.max(width, height) / 300));
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  const dark = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let ink = 0, total = 0;
      for (let y = row * cell; y < Math.min(height, (row + 1) * cell); y++) {
        for (let x = col * cell; x < Math.min(width, (col + 1) * cell); x++, total++) if (gray[y * width + x] < 128) ink++;
      }
      dark[row * cols + col] = ink / total > 0.15 ? 1 : 0;
    }
  }
  // Join modules and bars separated by thin white gaps: neighbors within two cells count as touching.
  const seen = new Uint8Array(cols * rows);
  const boxes: (Box & { area: number })[] = [];
  for (let start = 0; start < dark.length; start++) {
    if (!dark[start] || seen[start]) continue;
    let [minCol, maxCol, minRow, maxRow, area] = [cols, 0, rows, 0, 0];
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const index = queue.pop()!;
      const col = index % cols, row = (index - col) / cols;
      [minCol, maxCol, minRow, maxRow] = [Math.min(minCol, col), Math.max(maxCol, col), Math.min(minRow, row), Math.max(maxRow, row)];
      area++;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const c = col + dx, r = row + dy, next = r * cols + c;
          if (c >= 0 && c < cols && r >= 0 && r < rows && dark[next] && !seen[next]) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    // Too small to hold a code: specks and single words.
    if (maxCol - minCol < 3 || maxRow - minRow < 2) continue;
    const margin = 2 * cell;
    const x = Math.max(0, minCol * cell - margin), y = Math.max(0, minRow * cell - margin);
    boxes.push({ x, y, width: Math.min(width, (maxCol + 1) * cell + margin) - x, height: Math.min(height, (maxRow + 1) * cell + margin) - y, area });
  }
  return boxes.sort((a, b) => b.area - a.area).slice(0, MAX_REGIONS);
}

function crop(gray: Uint8ClampedArray, width: number, box: Box): Uint8ClampedArray {
  const region = new Uint8ClampedArray(box.width * box.height);
  for (let y = 0; y < box.height; y++) region.set(gray.subarray((box.y + y) * width + box.x, (box.y + y) * width + box.x + box.width), y * box.width);
  return region;
}

function decodeImage(gray: Uint8ClampedArray, width: number, height: number): DecodedCode[] {
  const regions = candidateRegions(gray, width, height);
  const found = decodeAll(gray.slice(), width, height);
  for (const box of regions) {
    for (const code of decodeAll(crop(gray, width, box), box.width, box.height, box)) {
      if (!found.some((known) => known.format === code.format && known.message === code.message)) found.push(code);
    }
  }
  // Reading order: codes whose heights overlap are on one row, read left to right; rows top to bottom.
  const sameRow = (a: Found, b: Found) => a.top <= b.bottom + 10 && b.top <= a.bottom + 10;
  return found
    .sort((a, b) => (sameRow(a, b) ? a.x - b.x : a.y - b.y))
    .map(({ format, message }) => ({ format, message }));
}

/** Finds every QR, PDF417, Aztec and Code 128 code in the image, light or dark. */
export function decodeBarcodes(pixels: Pixels): DecodedCode[] {
  const found = decodeImage(luminance(pixels, false), pixels.width, pixels.height);
  // Dark-mode screenshots often show a light code on a dark background.
  return found.length > 0 ? found : decodeImage(luminance(pixels, true), pixels.width, pixels.height);
}
