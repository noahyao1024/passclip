import { DateTime } from "luxon";
import type { NormalizedPass } from "../import/normalize";

// Add to calendar (docs/SPEC.md §8): one event per pass, as an RFC 5545 .ics file.
// Times are written in UTC, so every calendar app shows the right local time without
// time zone definitions.

export interface CalendarEvent {
  summary: string;
  /** ISO timestamps with offsets, as normalization produces them. */
  start: string;
  end: string;
  location?: string;
  description?: string;
  geo?: { latitude: number; longitude: number };
  /** Minutes before the start; 0 means at the start. */
  alertMinutes: number[];
}

/** Calendar files are offered for passes with a start: by default for event tickets and travel, or when the import asks. */
export function offersCalendar(pass: NormalizedPass): boolean {
  return Boolean(pass.start) && (pass.calendar?.add ?? (pass.type === "eventTicket" || pass.type === "boardingPass"));
}

const plus = (iso: string, hours: number) => DateTime.fromISO(iso, { setZone: true }).plus({ hours }).toISO({ suppressMilliseconds: true })!;
const after = (a: string, b: string) => DateTime.fromISO(a) > DateTime.fromISO(b);

function stopName(stop: { code?: string; name?: string; city?: string }) {
  return stop.name ?? stop.city ?? stop.code ?? "";
}

function seatLine(pass: NormalizedPass): string | undefined {
  const parts = [
    pass.transit?.car && `car ${pass.transit.car}`,
    pass.seat?.section && `section ${pass.seat.section}`,
    pass.seat?.row && `row ${pass.seat.row}`,
    pass.seat?.number && `seat ${pass.seat.number}`,
    pass.seat?.description,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return undefined;
  const text = parts.join(", ");
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

export function calendarEventFor(pass: NormalizedPass): CalendarEvent | undefined {
  if (!offersCalendar(pass) || !pass.start) return undefined;
  const travel = pass.type === "boardingPass";
  const end = pass.end && after(pass.end, pass.start) ? pass.end : plus(pass.start, travel ? 1 : 2);

  const summary = pass.calendar?.title ?? (travel && pass.transit?.number ? `${pass.transit.number} ${pass.title}` : pass.title);

  const venue = pass.venue && [pass.venue.name, pass.venue.room, pass.venue.address, pass.venue.city, pass.venue.country].filter(Boolean).join(", ");
  const route = pass.transit && `${stopName(pass.transit.from)} → ${stopName(pass.transit.to)}`;
  const location = travel ? route : venue;

  const place = travel ? pass.transit?.from : pass.venue;
  const geo = place?.latitude !== undefined && place.longitude !== undefined ? { latitude: place.latitude, longitude: place.longitude } : undefined;

  const description = [
    seatLine(pass),
    pass.transit?.gate && `Gate: ${pass.transit.gate}`,
    pass.transit?.platform && `Platform: ${pass.transit.platform}`,
    pass.confirmationCode && `Confirmation: ${pass.confirmationCode}`,
    pass.notes,
    ...(pass.attachments ?? []).map((attachment) => `${attachment.title}: ${attachment.url}`),
  ].filter(Boolean).join("\n");

  const defaultAlert = !travel ? 120 : pass.transit?.mode === "air" ? 180 : 30;
  return {
    summary,
    start: pass.start,
    end,
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(geo ? { geo } : {}),
    alertMinutes: pass.calendar?.alertMinutesBefore ?? [defaultAlert],
  };
}

/** RFC 5545 TEXT: backslashes, semicolons, commas and line breaks are escaped. */
export function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/** RFC 5545 line folding: at most 75 octets per line, never splitting a character. */
export function foldLine(line: string): string {
  const lines: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // Continuation lines start with a space, which counts toward their 75 octets.
    const limit = lines.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      lines.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  lines.push(current);
  return lines.join("\r\n ");
}

const utc = (iso: string) => DateTime.fromISO(iso, { setZone: true }).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

export function buildIcs(event: CalendarEvent, { uid, now }: { uid: string; now: Date }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Passclip//Passclip//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${utc(now.toISOString())}`,
    `DTSTART:${utc(event.start)}`,
    `DTEND:${utc(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    ...(event.geo ? [`GEO:${event.geo.latitude};${event.geo.longitude}`] : []),
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    ...event.alertMinutes.flatMap((minutes) => [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.summary)}`,
      `TRIGGER:${minutes === 0 ? "PT0M" : `-PT${minutes}M`}`,
      "END:VALARM",
    ]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
