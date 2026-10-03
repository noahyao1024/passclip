import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NormalizedPass } from "../import/normalize";
import { processImport } from "../import/process";
import { semanticsFor } from "./semantics";

const fixture = (name: string): NormalizedPass => {
  const result = processImport(readFileSync(`examples/${name}.json`, "utf8"), { fallbackTimeZone: "Asia/Tokyo" });
  if (!result.ok) throw new Error(`Invalid fixture ${name}`);
  return result.value.passes[0];
};

describe("semanticsFor", () => {
  it("leaves out tags it has no data for, and returns nothing when nothing applies", () => {
    expect(semanticsFor(fixture("coupon"))).toBeUndefined();
    expect(semanticsFor(fixture("gym-membership"))).toBeUndefined();
    expect(semanticsFor(fixture("loyalty-card"))).toBeUndefined();
  });

  it("writes money as a string amount with its currency code, as Apple documents", () => {
    const card = { ...fixture("loyalty-card"), membership: { balance: { amount: 12.5, currency: "USD" } } };
    expect(semanticsFor(card)).toEqual({ balance: { amount: "12.5", currencyCode: "USD" } });
    const ticket = fixture("event-tickets");
    expect(semanticsFor(ticket)?.totalPrice).toEqual({ amount: "8800", currencyCode: "JPY" });
  });

  it("adds venue coordinates, including zero", () => {
    const ticket = { ...fixture("event-tickets"), venue: { name: "Null Island Hall", latitude: 0, longitude: 0 } };
    expect(semanticsFor(ticket)?.venueLocation).toEqual({ latitude: 0, longitude: 0 });
  });

  it("splits a printed flight number only when it clearly matches the airline code", () => {
    const flight = fixture("flight");
    const tagsFor = (number: string | undefined, carrierCode: string | undefined) =>
      semanticsFor({ ...flight, transit: { ...flight.transit!, number, carrierCode } });
    expect(tagsFor("ZQ 101", "ZQ")).toMatchObject({ flightCode: "ZQ101", flightNumber: 101 });
    expect(tagsFor("101", "ZQ")).toMatchObject({ flightCode: "ZQ101", flightNumber: 101 });
    expect(tagsFor("zq101", "ZQ")).toMatchObject({ flightCode: "ZQ101", flightNumber: 101 });
    for (const [number, code] of [["NH 7", "ZQ"], ["Shuttle", "ZQ"], ["ZQ 101", undefined], [undefined, "ZQ"]] as const) {
      const tags = tagsFor(number, code);
      expect(tags).not.toHaveProperty("flightCode");
      expect(tags).not.toHaveProperty("flightNumber");
    }
  });

  it("uses airline-only keys for flights and rail-only keys for trains", () => {
    const flight = semanticsFor(fixture("flight"))!;
    expect(flight).not.toHaveProperty("vehicleNumber");
    expect(flight).not.toHaveProperty("departureStationName");
    const train = semanticsFor(fixture("train-local-time"))!;
    expect(train).not.toHaveProperty("airlineCode");
    expect(train).not.toHaveProperty("departureAirportCode");
    expect(train).toMatchObject({ vehicleNumber: "Express 503", departurePlatform: "16", carNumber: "7" });
  });

  it("gives buses and ferries only the keys meant for every boarding pass", () => {
    const train = fixture("train-local-time");
    const bus = semanticsFor({ ...train, transit: { ...train.transit!, mode: "bus" } })!;
    expect(Object.keys(bus).sort()).toEqual([
      "confirmationNumber",
      "duration",
      "originalArrivalDate",
      "originalDepartureDate",
      "seats",
      "transitProvider",
      "vehicleNumber",
    ]);
  });

  it("never adds a confirmation number to event tickets (Apple lists it for boarding passes)", () => {
    expect(semanticsFor(fixture("event-tickets"))).not.toHaveProperty("confirmationNumber");
  });
});
