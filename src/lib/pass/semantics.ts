import { DateTime } from "luxon";
import type { NormalizedPass } from "../import/normalize";
import type { Money, Seat, Stop, Transit } from "../import/types";

// Semantic tags (docs/SPEC.md §4.6): machine-readable details that iOS uses for suggestions and
// travel features. Key names, value shapes and which pass styles each key is for were checked in
// Apple's SemanticTags documentation on 2026-10-03 (docs/DECISIONS.md D13).

export interface SemanticCurrencyAmount {
  /** Apple documents the amount as a string. */
  amount: string;
  currencyCode: string;
}
export interface SemanticLocation {
  latitude: number;
  longitude: number;
}
export interface SemanticSeat {
  seatSection?: string;
  seatRow?: string;
  seatNumber?: string;
  seatType?: string;
}

export interface SemanticTags {
  // Any pass style.
  totalPrice?: SemanticCurrencyAmount;
  // Event tickets.
  eventName?: string;
  venueName?: string;
  venueLocation?: SemanticLocation;
  venueRoom?: string;
  venueEntrance?: string;
  eventStartDate?: string;
  eventEndDate?: string;
  attendeeName?: string;
  // Event tickets and boarding passes.
  seats?: SemanticSeat[];
  /** Seconds. */
  duration?: number;
  // Boarding passes of any kind.
  transitProvider?: string;
  confirmationNumber?: string;
  boardingGroup?: string;
  vehicleNumber?: string;
  originalDepartureDate?: string;
  originalArrivalDate?: string;
  originalBoardingDate?: string;
  departureLocation?: SemanticLocation;
  destinationLocation?: SemanticLocation;
  // Airline boarding passes only.
  airlineCode?: string;
  flightCode?: string;
  /** The numeric part of the flight code, as a number. */
  flightNumber?: number;
  departureAirportCode?: string;
  departureAirportName?: string;
  departureCityName?: string;
  departureGate?: string;
  departureTerminal?: string;
  destinationAirportCode?: string;
  destinationAirportName?: string;
  destinationCityName?: string;
  destinationTerminal?: string;
  // Train boarding passes only.
  departureStationName?: string;
  destinationStationName?: string;
  departurePlatform?: string;
  carNumber?: string;
  // Store cards only.
  balance?: SemanticCurrencyAmount;
}

const currency = (money: Money): SemanticCurrencyAmount => ({ amount: String(money.amount), currencyCode: money.currency });

const location = (place?: { latitude?: number; longitude?: number }): SemanticLocation | undefined =>
  place?.latitude !== undefined && place.longitude !== undefined ? { latitude: place.latitude, longitude: place.longitude } : undefined;

function durationSeconds(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const seconds = DateTime.fromISO(end).diff(DateTime.fromISO(start), "seconds").seconds;
  return seconds > 0 ? Math.round(seconds) : undefined;
}

function seats(seat?: Seat): SemanticSeat[] | undefined {
  if (!seat) return undefined;
  const details = withoutEmpty({ seatSection: seat.section, seatRow: seat.row, seatNumber: seat.number, seatType: seat.description });
  return details ? [details] : undefined;
}

/** "ZQ 101" with airline code "ZQ" gives flight code "ZQ101" and flight number 101. Anything else is left out. */
function flight(transit: Transit): Pick<SemanticTags, "flightCode" | "flightNumber"> {
  const code = transit.carrierCode;
  const compact = transit.number?.replace(/\s+/g, "").toUpperCase();
  if (!code || !compact) return {};
  const digits = compact.startsWith(code) ? compact.slice(code.length) : compact;
  if (!/^\d{1,4}$/.test(digits)) return {};
  return { flightCode: `${code}${digits}`, flightNumber: Number(digits) };
}

const stationName = (stop: Stop) => stop.name ?? stop.city;

function withoutEmpty<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

export function semanticsFor(pass: NormalizedPass): SemanticTags | undefined {
  const tags: SemanticTags = { totalPrice: pass.price && currency(pass.price) };

  if (pass.type === "eventTicket") {
    Object.assign(tags, {
      eventName: pass.title,
      venueName: pass.venue?.name,
      venueLocation: location(pass.venue),
      venueRoom: pass.venue?.room,
      venueEntrance: pass.seat?.entrance,
      eventStartDate: pass.start,
      eventEndDate: pass.end,
      duration: durationSeconds(pass.start, pass.end),
      attendeeName: pass.holderName,
      seats: seats(pass.seat),
    } satisfies SemanticTags);
  }

  if (pass.type === "boardingPass" && pass.transit) {
    const { transit } = pass;
    Object.assign(tags, {
      transitProvider: transit.carrier ?? pass.organization,
      confirmationNumber: pass.confirmationCode,
      boardingGroup: transit.boardingGroup,
      originalDepartureDate: pass.start,
      originalArrivalDate: pass.end,
      originalBoardingDate: transit.boardingTime,
      duration: durationSeconds(pass.start, pass.end),
      departureLocation: location(transit.from),
      destinationLocation: location(transit.to),
      seats: seats(pass.seat),
    } satisfies SemanticTags);

    if (transit.mode === "air") {
      Object.assign(tags, {
        airlineCode: transit.carrierCode,
        ...flight(transit),
        departureAirportCode: transit.from.code,
        departureAirportName: transit.from.name,
        departureCityName: transit.from.city,
        departureGate: transit.gate,
        departureTerminal: transit.from.terminal,
        destinationAirportCode: transit.to.code,
        destinationAirportName: transit.to.name,
        destinationCityName: transit.to.city,
        destinationTerminal: transit.to.terminal,
      } satisfies SemanticTags);
    } else {
      // For flights the number names the flight, not the plane, so it isn't a vehicle number.
      tags.vehicleNumber = transit.number;
    }
    if (transit.mode === "train") {
      Object.assign(tags, {
        departureStationName: stationName(transit.from),
        destinationStationName: stationName(transit.to),
        departurePlatform: transit.platform,
        carNumber: transit.car,
      } satisfies SemanticTags);
    }
  }

  if (pass.type === "storeCard" && pass.membership?.balance) tags.balance = currency(pass.membership.balance);

  return withoutEmpty(tags);
}
