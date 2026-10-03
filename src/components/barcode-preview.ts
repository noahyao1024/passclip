import type { Barcode } from "../lib/import/types";

export interface BarcodeImage {
  src: string;
  width: number;
  height: number;
}

/** Encoders run locally; no barcode text is sent to an image service or changed. */
export async function renderBarcode(barcode: Pick<Barcode, "format" | "message">): Promise<BarcodeImage> {
  const { qrcode, pdf417, azteccode, code128, drawingSVG } = await import("bwip-js/browser");
  const encoders = { qr: qrcode, pdf417, aztec: azteccode, code128 };
  const bcid = { qr: "qrcode", pdf417: "pdf417", aztec: "azteccode", code128: "code128" };
  const svg = encoders[barcode.format]({
    bcid: bcid[barcode.format],
    text: barcode.message,
    // Match the mapping contract: Latin-1 when possible, UTF-8 otherwise.
    binarytext: !/[^\u0000-\u00ff]/.test(barcode.message),
    parse: false,
    parsefnc: false,
    includetext: false,
    scale: 2,
    padding: 4,
    backgroundcolor: "FFFFFF",
    ...(barcode.format === "code128" ? { height: 16 } : {}),
  }, drawingSVG());
  const dimensions = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!dimensions) throw new Error("The barcode encoder did not return an image.");
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: Number(dimensions[1]),
    height: Number(dimensions[2]),
  };
}
