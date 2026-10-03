import { DateTime } from "luxon";
import type { NormalizedPass } from "../import/normalize";
import type { Source } from "../import/types";
import { layoutPass, type PassField, type TransitType } from "./fields";
import { semanticsFor, type SemanticTags } from "./semantics";

export interface PassConfig {
  passTypeIdentifier: string;
  teamIdentifier: string;
  serialNumber: string;
  publicBaseUrl?: string;
  source?: Source;
}
export interface WalletFields {
  headerFields: PassField[]; primaryFields: PassField[]; secondaryFields: PassField[];
  auxiliaryFields: PassField[]; backFields: PassField[]; transitType?: TransitType;
}
export interface WalletPass {
  formatVersion: 1; passTypeIdentifier: string; teamIdentifier: string; serialNumber: string;
  organizationName: string; description: string; logoText: string;
  backgroundColor: string; foregroundColor: string; labelColor: string;
  groupingIdentifier?: string;
  barcodes?: { format: "PKBarcodeFormatQR" | "PKBarcodeFormatPDF417" | "PKBarcodeFormatAztec" | "PKBarcodeFormatCode128"; message: string; messageEncoding: "iso-8859-1" | "utf-8"; altText?: string }[];
  relevantDate?: string; relevantDates?: { startDate: string; endDate: string }[];
  expirationDate?: string;
  locations?: { latitude: number; longitude: number; relevantText: string }[];
  semantics?: SemanticTags;
  eventTicket?: WalletFields; boardingPass?: WalletFields; storeCard?: WalletFields; coupon?: WalletFields; generic?: WalletFields;
}
const stopName = (stop: { code?: string; name?: string; city?: string }) => stop.city ?? stop.name ?? stop.code ?? "";
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const shift = (value: string, hours: number) => DateTime.fromISO(value, { setZone: true }).plus({ hours }).toISO({ suppressMilliseconds: true })!;

/** Pure mapping: randomness, certificates and file I/O belong in the server builder. */
export function mapToPassJson(pass: NormalizedPass, config: PassConfig): WalletPass {
  const layout = layoutPass(pass, config);
  const descriptions = {
    eventTicket: `Event ticket for ${pass.title}`,
    boardingPass: pass.transit ? `Boarding pass from ${stopName(pass.transit.from)} to ${stopName(pass.transit.to)}` : `Boarding pass for ${pass.title}`,
    storeCard: `Loyalty card for ${pass.title}`, coupon: `Coupon from ${pass.organization ?? pass.title}`, generic: `Pass for ${pass.title}`,
  };
  const output: WalletPass = {
    formatVersion: 1, passTypeIdentifier: config.passTypeIdentifier, teamIdentifier: config.teamIdentifier,
    serialNumber: config.serialNumber, organizationName: pass.organization ?? pass.title,
    description: pass.description ?? descriptions[pass.type], logoText: pass.organization ?? pass.title,
    backgroundColor: rgb(pass.style.backgroundColor), foregroundColor: rgb(pass.style.foregroundColor), labelColor: rgb(pass.style.labelColor),
    [pass.type]: { headerFields: layout.headerFields, primaryFields: layout.primaryFields, secondaryFields: layout.secondaryFields, auxiliaryFields: layout.auxiliaryFields, backFields: layout.backFields, ...(layout.transitType ? { transitType: layout.transitType } : {}) },
  };
  if ((pass.type === "eventTicket" || pass.type === "boardingPass") && pass.confirmationCode) output.groupingIdentifier = pass.confirmationCode;
  if (pass.barcode) {
    const formats = { qr: "PKBarcodeFormatQR", pdf417: "PKBarcodeFormatPDF417", aztec: "PKBarcodeFormatAztec", code128: "PKBarcodeFormatCode128" } as const;
    output.barcodes = [{ format: formats[pass.barcode.format], message: pass.barcode.message, messageEncoding: /[^\u0000-\u00ff]/.test(pass.barcode.message) ? "utf-8" : "iso-8859-1", ...(pass.barcode.altText ? { altText: pass.barcode.altText } : {}) }];
  }
  if (pass.start && (pass.type === "eventTicket" || pass.type === "boardingPass")) {
    output.relevantDate = pass.start;
    const startDate = shift(pass.type === "boardingPass" ? pass.transit?.boardingTime ?? pass.start : pass.start, -3);
    const endDate = pass.type === "boardingPass" ? shift(pass.start, 1) : pass.end ?? shift(pass.start, 3);
    const duration = DateTime.fromISO(endDate).diff(DateTime.fromISO(startDate), "hours").hours;
    // Apple documents no maximum interval length (checked 2026-10-03, D13). Until multi-day
    // intervals are checked on a device, those keep only the legacy relevantDate.
    if (duration > 0 && duration <= 24) output.relevantDates = [{ startDate, endDate }];
    output.expirationDate = pass.expires ?? shift(pass.end ?? pass.start, 6);
  } else if (pass.expires) output.expirationDate = pass.expires;
  const place = pass.type === "boardingPass" ? pass.transit?.from : pass.venue;
  if (place?.latitude !== undefined && place.longitude !== undefined) output.locations = [{ latitude: place.latitude, longitude: place.longitude, relevantText: pass.title }];
  const semantics = semanticsFor(pass);
  if (semantics) output.semantics = semantics;
  return output;
}
