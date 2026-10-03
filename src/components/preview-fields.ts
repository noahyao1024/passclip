import { DateTime } from "luxon";
import type { PassField } from "../lib/pass/fields";

export interface FormatFieldOptions {
  locale?: string;
  /** The back makes the local offset explicit, including the departure date. */
  showTimeZone?: boolean;
}

function numberText(value: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

function dateOptions(field: PassField): Intl.DateTimeFormatOptions {
  const options: Intl.DateTimeFormatOptions = {};
  switch (field.dateStyle) {
    case "PKDateStyleShort":
      options.year = "2-digit";
      options.month = "numeric";
      options.day = "numeric";
      break;
    case "PKDateStyleMedium":
      options.year = "numeric";
      options.month = "short";
      options.day = "numeric";
      break;
    case "PKDateStyleLong":
    case "PKDateStyleFull":
      options.year = "numeric";
      options.month = "long";
      options.day = "numeric";
      if (field.dateStyle === "PKDateStyleFull") options.weekday = "long";
      break;
  }
  switch (field.timeStyle) {
    case "PKDateStyleShort":
      options.hour = "numeric";
      options.minute = "2-digit";
      break;
    case "PKDateStyleMedium":
    case "PKDateStyleLong":
    case "PKDateStyleFull":
      options.hour = "numeric";
      options.minute = "2-digit";
      options.second = "2-digit";
      break;
  }
  return options;
}

/** Format Wallet fields without moving an event or arrival into the viewer's time zone. */
export function formatFieldValue(field: PassField, options: FormatFieldOptions = {}): string {
  if (typeof field.value === "number") {
    if (field.currencyCode) {
      try {
        return new Intl.NumberFormat(options.locale, {
          style: "currency",
          currency: field.currencyCode,
        }).format(field.value);
      } catch {
        return `${numberText(field.value, options.locale)} ${field.currencyCode}`;
      }
    }
    return numberText(field.value, options.locale);
  }

  if (!field.dateStyle && !field.timeStyle) return field.value;
  const date = DateTime.fromISO(field.value, { setZone: true });
  if (!date.isValid) return field.value;
  const format = dateOptions(field);
  if (Object.keys(format).length === 0) return field.value;
  let value: string;
  try {
    value = date.toLocaleString(format, { locale: options.locale });
  } catch {
    value = date.toLocaleString(format);
  }
  if (options.showTimeZone && field.timeStyle && field.timeStyle !== "PKDateStyleNone") {
    value += ` (UTC${date.toFormat("ZZ")})`;
  }
  return value;
}

/** Read the link URL, never the attributedValue HTML. Text is rendered by React. */
export function fieldLink(field: PassField): string | undefined {
  if (!field.attributedValue || typeof field.value !== "string") return undefined;
  if (!/^https:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(field.value)) return undefined;
  try {
    const url = new URL(field.value);
    return url.protocol === "https:" && url.hostname ? field.value : undefined;
  } catch {
    return undefined;
  }
}
