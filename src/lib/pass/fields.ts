import { DateTime } from "luxon";
import type { Warning } from "../import/notices";
import type { Money, Pass, Source, Stop } from "../import/types";

export type DateStyle = "PKDateStyleNone" | "PKDateStyleShort" | "PKDateStyleMedium" | "PKDateStyleLong" | "PKDateStyleFull";

/** Shared by the preview and the future pass.json builder; these are Wallet field keys. */
export interface PassField {
  key: string;
  label: string;
  value: string | number;
  dateStyle?: DateStyle;
  timeStyle?: DateStyle;
  ignoresTimeZone?: boolean;
  currencyCode?: string;
  attributedValue?: string;
}

export type TransitType = "PKTransitTypeAir" | "PKTransitTypeTrain" | "PKTransitTypeBus" | "PKTransitTypeBoat" | "PKTransitTypeGeneric";

export interface PassLayout {
  headerFields: PassField[];
  primaryFields: PassField[];
  secondaryFields: PassField[];
  auxiliaryFields: PassField[];
  backFields: PassField[];
  warnings: Warning[];
  transitType?: TransitType;
}

export interface LayoutOptions {
  source?: Source;
  publicBaseUrl?: string;
}

const NONE: DateStyle = "PKDateStyleNone";
const SHORT: DateStyle = "PKDateStyleShort";
const MEDIUM: DateStyle = "PKDateStyleMedium";
type FrontGroup = "headerFields" | "primaryFields" | "secondaryFields" | "auxiliaryFields";

function text(key: string, label: string, value: string | number | undefined): PassField | undefined {
  return value === undefined || value === "" ? undefined : { key, label, value };
}

function date(key: string, label: string, value: string | undefined, dateStyle: DateStyle, timeStyle: DateStyle = NONE): PassField | undefined {
  return value ? { key, label, value, dateStyle, timeStyle, ignoresTimeZone: true } : undefined;
}

function money(key: string, label: string, value: Money | undefined): PassField | undefined {
  return value ? { key, label, value: value.amount, currencyCode: value.currency } : undefined;
}

function stop(key: string, fallbackLabel: string, value: Stop): PassField {
  return {
    key,
    label: value.city ?? value.name ?? fallbackLabel,
    value: value.code ?? value.name ?? value.city ?? "",
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function isHttpsLink(value: string): boolean {
  if (!/^https:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function link(key: string, label: string, url: string): PassField {
  return { key, label, value: url, attributedValue: `<a href="${escapeHtml(url)}">Open</a>` };
}

function offsetLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const offset = /([+-]\d{2}:\d{2}|Z)$/i.exec(value)?.[1];
  return offset ? offset.toUpperCase() === "Z" || offset === "+00:00" || offset === "-00:00" ? "UTC" : `UTC${offset}` : undefined;
}

function departureZone(value: string | undefined, timeZone: string | undefined): string | undefined {
  if (!value) return undefined;
  const offset = offsetLabel(value);
  if (!offset) return timeZone;
  const date = DateTime.fromISO(value, { setZone: true });
  const inZone = timeZone ? date.setZone(timeZone) : undefined;
  // Explicit offsets are authoritative. Only name an IANA zone when it actually
  // matches this instant, including that zone's daylight-saving rules.
  return timeZone && date.isValid && inZone?.isValid && inZone.offset === date.offset ? timeZone : offset;
}

/**
 * SPEC §4.2 and §4.4. Input is normalized before layout; no text, time or barcode is
 * rewritten here. Anything that exceeds a row's field cap moves to the back.
 */
export function layoutPass(pass: Pass, options: LayoutOptions = {}): PassLayout {
  const layout: PassLayout = { headerFields: [], primaryFields: [], secondaryFields: [], auxiliaryFields: [], backFields: [], warnings: [] };
  const overflow: PassField[] = [];
  const caps: Record<FrontGroup, number> = { headerFields: 2, primaryFields: pass.type === "boardingPass" ? 2 : 1, secondaryFields: 3, auxiliaryFields: 4 };
  const front = (group: FrontGroup, ...fields: (PassField | undefined)[]) => {
    for (const field of fields) {
      if (!field) continue;
      if (layout[group].length < caps[group]) layout[group].push(field);
      else overflow.push(field);
    }
  };
  const hasRoom = (group: FrontGroup) => layout[group].length < caps[group];
  const back = (...fields: (PassField | undefined)[]) => {
    for (const field of fields) if (field) layout.backFields.push(field);
  };
  const extraFields = pass.extraFields?.map((field, index) => ({ key: `x_${index + 1}`, ...field })) ?? [];

  switch (pass.type) {
    case "eventTicket":
      // Date and time sit in the header, so they stay visible when the pass is stacked in Wallet.
      front("headerFields", date("date", "Date", pass.start, SHORT), pass.start?.includes("T") ? date("time", "Time", pass.start, NONE, SHORT) : undefined);
      front("primaryFields", text("title", pass.subtitle ?? "Event", pass.title));
      // A venue name is long. Next to another field, Wallet runs the two together, so it gets a row to itself.
      front("secondaryFields", text("venue", "Venue", pass.venue?.name));
      front("auxiliaryFields", text("section", "Section", pass.seat?.section), text("row", "Row", pass.seat?.row), text("seat", "Seat", pass.seat?.number), text("entrance", "Entrance", pass.seat?.entrance));
      // The seat category (like "CAT 2") and the booking number fill spare room on the front, so a
      // ticket without a seat number isn't left nearly empty. When the row is full they stay on the back.
      if (hasRoom("auxiliaryFields")) front("auxiliaryFields", text("category", "Category", pass.seat?.description));
      if (hasRoom("auxiliaryFields")) front("auxiliaryFields", text("booking", "Booking", pass.confirmationCode));
      front("auxiliaryFields", ...extraFields);
      break;
    case "boardingPass": {
      const transit = pass.transit;
      if (transit) {
        const transitTypes: Record<typeof transit.mode, TransitType> = { air: "PKTransitTypeAir", train: "PKTransitTypeTrain", bus: "PKTransitTypeBus", boat: "PKTransitTypeBoat", other: "PKTransitTypeGeneric" };
        const numberLabels = { air: "Flight", train: "Train", bus: "Bus", boat: "Boat", other: "Service" };
        layout.transitType = transitTypes[transit.mode];
        front("headerFields", transit.mode === "train" ? text("platform", "Platform", transit.platform) : text("gate", "Gate", transit.gate));
        front("primaryFields", stop("from", "From", transit.from), stop("to", "To", transit.to));
        front("auxiliaryFields", text("number", numberLabels[transit.mode], transit.number), text("seat", "Seat", pass.seat?.number), text("group", "Group", transit.boardingGroup), date("boarding", "Boarding", transit.boardingTime, NONE, SHORT), text("cabin", "Cabin", transit.cabin), text("car", "Car", transit.car));
      }
      front("secondaryFields", text("passenger", "Passenger", pass.holderName), date("departs", "Departs", pass.start, NONE, SHORT));
      overflow.push(...extraFields);
      break;
    }
    case "storeCard":
      front("primaryFields", pass.membership?.points !== undefined ? text("points", "Points", pass.membership.points) : pass.membership?.balance ? money("balance", "Balance", pass.membership.balance) : text("member_primary", "Member", pass.holderName ?? pass.title));
      front("secondaryFields", text("member", "Member", pass.holderName), text("member_id", "Member ID", pass.membership?.memberId));
      front("auxiliaryFields", text("tier", "Tier", pass.membership?.tier), date("expires", "Expires", pass.expires, MEDIUM));
      overflow.push(...extraFields);
      break;
    case "coupon":
      front("primaryFields", text("offer", pass.organization ?? "Offer", pass.offer?.headline ?? pass.title));
      front("secondaryFields", date("expires", "Expires", pass.expires, MEDIUM));
      front("auxiliaryFields", text("code", "Code", pass.offer?.code));
      overflow.push(...extraFields);
      break;
    case "generic":
      front("headerFields", date("expires", "Expires", pass.expires, SHORT));
      front("primaryFields", text("title", pass.subtitle ?? "", pass.title));
      front("secondaryFields", text("name", "Name", pass.holderName), text("member_id", "Member ID", pass.membership?.memberId));
      front("auxiliaryFields", text("tier", "Tier", pass.membership?.tier), date("starts", "Starts", pass.start, MEDIUM, SHORT), ...extraFields);
      break;
  }

  back(text("notes", "Notes", pass.notes));
  pass.attachments?.forEach((attachment, index) => {
    if (isHttpsLink(attachment.url)) back(link(`att_${index + 1}`, attachment.title, attachment.url));
    else layout.warnings.push({ kind: "fix", message: `Removed “${attachment.title}” because its link isn't a full https:// link.` });
  });
  const onFront = (key: string) => layout.auxiliaryFields.some((field) => field.key === key);
  back(text("holder_back", "Name", pass.holderName), onFront("booking") ? undefined : text("confirmation", "Confirmation", pass.confirmationCode), text("ticket_number", "Ticket number", pass.ticketNumber), money("price", "Price", pass.price));
  back(text("venue_back", "Venue", pass.venue?.name), text("address", "Address", pass.venue?.address), text("room", "Room", pass.venue?.room));
  if (pass.type === "boardingPass") {
    back(text("from_back", "From", pass.transit?.from.name ?? pass.transit?.from.city ?? pass.transit?.from.code), text("departure_terminal", "Departure terminal", pass.transit?.from.terminal), text("to_back", "To", pass.transit?.to.name ?? pass.transit?.to.city ?? pass.transit?.to.code), text("arrival_terminal", "Arrival terminal", pass.transit?.to.terminal));
    back(date("departure_back", "Departs", pass.start, MEDIUM, SHORT), text("departure_timezone", "Departure time zone", departureZone(pass.start, pass.timeZone)), date("arrival", "Arrives", pass.end, MEDIUM, SHORT), text("arrival_timezone", "Arrival time zone", offsetLabel(pass.end)));
  }
  back(text("terms", "Terms", pass.offer?.terms), onFront("category") ? undefined : text("seat_description", "Seating", pass.seat?.description), text("program", "Program", pass.membership?.programName), date("member_since", "Member since", pass.membership?.since, MEDIUM), ...overflow);
  const source = options.source;
  if (source) {
    const origin = source.subject ?? source.sender ?? source.kind;
    back(text("source", "Source", origin ? `Imported from ${origin}${source.subject && source.sender ? `\n${source.sender}` : ""}` : undefined));
    back(date("received_at", "Received", source.receivedAt, MEDIUM, source.receivedAt?.includes("T") ? SHORT : NONE));
  }
  const baseUrl = options.publicBaseUrl;
  back(baseUrl && isHttpsLink(baseUrl) ? link("made_with", "Made with Passclip", baseUrl) : text("made_with", "Made with Passclip", baseUrl ?? "Passclip"));

  // These are conservative estimates, not schema limits. Keep the complete text and
  // ask the user to check it; actual fitting still needs confirmation on an iPhone.
  const displayLimits: Record<FrontGroup, number> = { headerFields: 16, primaryFields: pass.type === "boardingPass" ? 18 : 40, secondaryFields: 36, auxiliaryFields: 20 };
  for (const group of Object.keys(displayLimits) as FrontGroup[]) {
    for (const field of layout[group]) {
      const labelTooLong = [...field.label].length > 20;
      const valueTooLong = !field.dateStyle && !field.currencyCode && ([...String(field.value)].length > displayLimits[group] || /\r|\n/.test(String(field.value)));
      if (labelTooLong || valueTooLong) layout.warnings.push({ message: `“${field.label || "Main field"}” may be too long for the front of a Wallet pass. Check the preview; Wallet may shorten it.` });
    }
  }
  return layout;
}
