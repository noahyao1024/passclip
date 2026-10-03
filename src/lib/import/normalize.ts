import { DateTime, IANAZone } from "luxon";
import { normalizeColors, type ResolvedStyle } from "../pass/colors";
import type { ImportError, Warning } from "./notices";
import type { Pass, PassclipImport } from "./types";

export interface NormalizedPass extends Pass {
  style: ResolvedStyle;
  /** Local times used a fallback zone: show the picker so the user can confirm it. */
  needsTimeZone: boolean;
}

export interface NormalizedImport extends PassclipImport {
  passes: NormalizedPass[];
}

export interface NormalizeOptions {
  /** The caller supplies the browser's zone or the user's selection. Defaults to UTC. */
  fallbackTimeZone?: string;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedImport; warnings: Warning[] }
  | { ok: false; errors: ImportError[]; warnings: Warning[] };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET = /(Z|([+-])(\d{2}):(\d{2}))$/;

/** A timestamp may match the schema while still containing an impossible date or UTC offset. */
function validDate(value: string): boolean {
  const offset = OFFSET.exec(value);
  if (offset && offset[1] !== "Z" && (Number(offset[3]) > 23 || Number(offset[4]) > 59)) return false;
  return DateTime.fromISO(value, { zone: "UTC", setZone: true }).isValid;
}

/** Pure normalization after clean-up and schema validation; the input is never changed. */
export function normalizeImport(input: PassclipImport, options: NormalizeOptions = {}): NormalizeResult {
  const value = structuredClone(input);
  const warnings: Warning[] = (value.warnings ?? []).map((message) => ({ from: "ai", message }));
  const errors: ImportError[] = [];
  const requestedFallback = options.fallbackTimeZone ?? "UTC";
  const fallback = IANAZone.isValidZone(requestedFallback) ? requestedFallback : "UTC";

  if (value.source?.receivedAt && !validDate(value.source.receivedAt)) {
    errors.push({ message: "Source: received date isn't a real date or time. Check the day, month and UTC offset." });
  }

  const passes = value.passes.map((pass, index): NormalizedPass => {
    const colors = normalizeColors(pass.type, pass.style);
    warnings.push(...colors.warnings.map((message): Warning => ({ kind: "fix", pass: index, message })));
    warnings.push(...(pass.warnings ?? []).map((message): Warning => ({ from: "ai", pass: index, message })));
    const normalized: NormalizedPass = { ...pass, style: colors.style, needsTimeZone: false };
    const suppliedZone = pass.timeZone;
    const zone = suppliedZone && IANAZone.isValidZone(suppliedZone) ? suppliedZone : undefined;

    if (suppliedZone && !zone) {
      delete normalized.timeZone;
      warnings.push({ kind: "fix", pass: index, message: `Ignored the unknown time zone “${suppliedZone}”. Choose the time zone where the event or departure happens.` });
    }

    const invalidDate = (label: string) => {
      errors.push({ pass: index, message: `Pass ${index + 1}: ${label} isn't a real date or time. Check the day, month and UTC offset.` });
    };

    const normalizeTime = (
      original: string | undefined,
      label: string,
      { expiry = false, departureZone = false }: { expiry?: boolean; departureZone?: boolean } = {},
    ): string | undefined => {
      if (original === undefined) return undefined;
      if (!validDate(original)) {
        invalidDate(label);
        return original;
      }
      // Preserve every explicit offset. Start and boarding belong to the supplied departure
      // zone, so flag conflicting wall times; arrival and expiry may use another zone.
      if (OFFSET.test(original)) {
        if (zone && departureZone) {
          const explicit = DateTime.fromISO(original, { setZone: true });
          if (explicit.offset !== explicit.setZone(zone).offset) {
            warnings.push({
              pass: index,
              message: `The ${label} UTC offset (${explicit.toFormat("ZZ")}) doesn't match ${zone} at that time. Check the time and time zone against the source; kept the time as written.`,
            });
          }
        }
        return original;
      }
      const local = expiry && DATE_ONLY.test(original) ? `${original}T23:59:59` : original;
      const selectedZone = zone ?? fallback;
      if (!zone && !normalized.needsTimeZone) {
        normalized.needsTimeZone = true;
        normalized.timeZone = fallback;
        if (requestedFallback !== fallback) {
          warnings.push({ kind: "fix", pass: index, message: `Ignored the unknown fallback time zone “${requestedFallback}” and used UTC.` });
        }
        warnings.push({ pass: index, message: `The times have no UTC offset or valid time zone. Used ${fallback}; choose the time zone where the event or departure happens.` });
      }

      const wallTime = DateTime.fromISO(local, { zone: "UTC" });
      let date = DateTime.fromISO(local, { zone: selectedZone });
      if (!date.isValid) {
        invalidDate(label);
        return original;
      }
      // Luxon moves a nonexistent wall time forward across a daylight-saving gap.
      if (date.toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS") !== wallTime.toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS")) {
        warnings.push({ pass: index, message: `${label} falls in a clock change in ${selectedZone}. Moved it to ${date.toFormat("yyyy-MM-dd HH:mm:ss ZZ")}; check the original time.` });
      }
      const possibilities = date.getPossibleOffsets();
      if (possibilities.length > 1) {
        // The earlier occurrence is deterministic, independent of today's zone offset.
        date = possibilities.reduce((earlier, candidate) => candidate.toMillis() < earlier.toMillis() ? candidate : earlier);
        warnings.push({ pass: index, message: `${label} happens twice during a clock change in ${selectedZone}. Used the earlier occurrence (${date.toFormat("ZZ")}); check the UTC offset.` });
      }
      // Historical zones sometimes have a seconds component. Luxon's ISO output drops it,
      // and our schema only permits minute offsets, so emitting it would change the instant.
      if (!Number.isInteger(date.offset)) {
        errors.push({ pass: index, message: `Pass ${index + 1}: ${label} uses a historical time zone offset that includes seconds. Give the exact UTC time with Z instead.` });
        return original;
      }
      return date.toISO({ suppressMilliseconds: true }) ?? original;
    };

    if (pass.start !== undefined) normalized.start = normalizeTime(pass.start, "start", { departureZone: true });
    if (pass.end !== undefined) normalized.end = normalizeTime(pass.end, "end");
    if (pass.expires !== undefined) normalized.expires = normalizeTime(pass.expires, "expiry date", { expiry: true });
    if (pass.transit?.boardingTime !== undefined) {
      normalized.transit = { ...pass.transit, boardingTime: normalizeTime(pass.transit.boardingTime, "boarding time", { departureZone: true }) };
    }
    if (pass.membership?.since && !validDate(pass.membership.since)) invalidDate("member since date");
    if (pass.barcode?.format === "code128") {
      warnings.push({ pass: index, message: "Apple Watch can't display Code 128 barcodes. Use this pass on your iPhone." });
    }
    return normalized;
  });

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, value: { ...value, passes }, warnings };
}
