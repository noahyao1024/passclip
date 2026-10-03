import type { Barcode } from "../import/types";

export type BarcodeFormat = Barcode["format"];

/** How each type of code is named to people. */
export const FORMAT_NAMES: Record<BarcodeFormat, string> = {
  qr: "QR code",
  pdf417: "PDF417",
  aztec: "Aztec",
  code128: "Code 128",
  ean13: "EAN-13",
  code39: "Code 39",
  codabar: "Codabar",
  itf: "ITF",
};

/** Types Wallet shows only on iOS 27 and later (Apple's pass.json docs, checked 2026-10-03, D17). */
export const IOS_27_FORMATS: ReadonlySet<BarcodeFormat> = new Set(["ean13", "code39", "codabar", "itf"]);

/** Codes made of bars in one row, rather than a 2D pattern. */
export const LINEAR_FORMATS: ReadonlySet<BarcodeFormat> = new Set(["code128", "ean13", "code39", "codabar", "itf"]);
