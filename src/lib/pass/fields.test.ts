import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processImport } from "../import/process";
import type { Pass, PassclipImport } from "../import/types";
import { layoutPass, type PassLayout } from "./fields";

const read = (name: string): PassclipImport => JSON.parse(readFileSync(`examples/${name}.json`, "utf8"));
const allFields = (layout: PassLayout) => [layout.headerFields, layout.primaryFields, layout.secondaryFields, layout.auxiliaryFields, layout.backFields].flat();
const boardingPass = (fields: Partial<Pass> = {}): Pass => ({
  type: "boardingPass", title: "Tokyo → Paris", holderName: "Aiko Tanaka", start: "2026-12-03T10:25:00+09:00", end: "2026-12-03T16:40:00+01:00", timeZone: "Asia/Tokyo",
  transit: { mode: "air", from: { code: "HND", city: "Tokyo" }, to: { code: "CDG", city: "Paris" } },
  ...fields,
});

describe("layouts for all five pass styles", () => {
  it.each(["event-tickets", "flight", "loyalty-card", "coupon", "gym-membership"])("%s", (name) => {
    const result = processImport(readFileSync(`examples/${name}.json`, "utf8"), { fallbackTimeZone: "Asia/Tokyo" });
    if (!result.ok) throw new Error(`Example failed to process: ${name}`);
    const imported = result.value;
    expect(layoutPass(imported.passes[0], { source: imported.source, publicBaseUrl: "https://passclip.example" })).toMatchSnapshot();
  });

  it("every example respects the caps and has unique keys", () => {
    for (const name of ["event-tickets", "flight", "loyalty-card", "coupon", "gym-membership", "train-local-time", "grocery-card"]) {
      const result = processImport(readFileSync(`examples/${name}.json`, "utf8"), { fallbackTimeZone: "Asia/Tokyo" });
      if (!result.ok) throw new Error(`Example failed to process: ${name}`);
      const imported = result.value;
      for (const pass of imported.passes) {
        const layout = layoutPass(pass, { source: imported.source });
        expect(layout.headerFields.length).toBeLessThanOrEqual(2);
        expect(layout.primaryFields.length).toBeLessThanOrEqual(pass.type === "boardingPass" ? 2 : 1);
        expect(layout.secondaryFields.length).toBeLessThanOrEqual(3);
        // Event tickets may use a second row of four (fields marked row 1); other passes have one row.
        expect(layout.auxiliaryFields.length).toBeLessThanOrEqual(pass.type === "eventTicket" ? 8 : 4);
        expect(layout.auxiliaryFields.map((field) => field.row ?? 0)).toEqual(layout.auxiliaryFields.map((_, index) => (index >= 4 ? 1 : 0)));
        const keys = allFields(layout).map((field) => field.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(layout.primaryFields.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("front fields and overflow", () => {
  it("puts an event ticket's extra fields in a second row, and only what doesn't fit on the back", () => {
    const pass: Pass = {
      type: "eventTicket", title: "Jazz Night", seat: { section: "B", row: "F", number: "12", entrance: "East" },
      extraFields: [{ label: "Seat", value: "Standing area" }, { label: "Seat", value: "Balcony" }, { label: "Gate", value: "3" }, { label: "Bag", value: "Small" }, { label: "Doors", value: "6:30 PM" }],
    };
    const layout = layoutPass(pass);
    expect(layout.auxiliaryFields.map((field) => [field.key, field.row])).toEqual([["section", undefined], ["row", undefined], ["seat", undefined], ["entrance", undefined], ["x_1", 1], ["x_2", 1], ["x_3", 1], ["x_4", 1]]);
    expect(layout.backFields.filter((field) => field.key.startsWith("x_"))).toEqual([{ key: "x_5", label: "Doors", value: "6:30 PM" }]);
    expect(layout.warnings).toEqual([]);
  });

  it("shows the seat category and booking number on the front of a ticket without a seat number", () => {
    // A real ticket: only a category ("CAT 2") and a booking number, no section, row or seat.
    const layout = layoutPass({ type: "eventTicket", title: "Cross Talk Show", confirmationCode: "1004940771101", start: "2026-10-10T19:30:00+08:00", venue: { name: "Resorts World Convention Centre" }, seat: { description: "CAT 2" } });
    expect(layout.auxiliaryFields.map(({ key, label, value }) => [key, label, value])).toEqual([["category", "Category", "CAT 2"], ["booking", "Booking", "1004940771101"]]);
    // Nothing is shown twice.
    expect(layout.backFields.map((field) => field.key)).not.toContain("confirmation");
    expect(layout.backFields.map((field) => field.key)).not.toContain("seat_description");
  });

  it("moves the category, booking number and name to the second row instead of the back", () => {
    const layout = layoutPass({ type: "eventTicket", title: "Show", confirmationCode: "ABC123", holderName: "DAMAI", seat: { section: "B", row: "F", number: "12", entrance: "East door", description: "Balcony" } });
    expect(layout.auxiliaryFields.map((field) => [field.key, field.value, field.row])).toEqual([
      ["section", "B", undefined], ["row", "F", undefined], ["seat", "12", undefined], ["entrance", "East door", undefined],
      ["category", "Balcony", 1], ["booking", "ABC123", 1], ["name", "DAMAI", 1],
    ]);
    for (const key of ["confirmation", "seat_description", "holder_back"]) expect(layout.backFields.map((field) => field.key)).not.toContain(key);
  });

  it("keeps one row of auxiliary fields on other passes", () => {
    const layout = layoutPass({ type: "generic", title: "Gym", membership: { tier: "Gold" }, extraFields: Array.from({ length: 6 }, (_, index) => ({ label: `F${index}`, value: "x" })) });
    expect(layout.auxiliaryFields).toHaveLength(4);
    expect(layout.auxiliaryFields.every((field) => field.row === undefined)).toBe(true);
  });

  it("fills generic auxiliary fields in order and sends the remainder to the back", () => {
    const layout = layoutPass({
      type: "generic", title: "Gym", membership: { tier: "Gold" }, start: "2026-12-03T10:25:00+09:00",
      extraFields: [{ label: "One", value: "1" }, { label: "Two", value: "2" }, { label: "Three", value: "3" }],
    });
    expect(layout.auxiliaryFields.map((field) => field.key)).toEqual(["tier", "starts", "x_1", "x_2"]);
    expect(layout.backFields.find((field) => field.key === "x_3")).toEqual({ key: "x_3", label: "Three", value: "3" });
    expect(allFields(layout).filter((field) => field.key.startsWith("x_"))).toHaveLength(3);
  });

  it("never loses a boarding pass cabin or car when number, seat, group and boarding fill the row", () => {
    const pass = boardingPass({ seat: { number: "34K" }, transit: {
      mode: "air", from: { code: "HND" }, to: { code: "CDG" }, number: "NH 7", boardingGroup: "3", boardingTime: "2026-12-03T09:45:00+09:00", cabin: "Economy", car: "7",
    } });
    const layout = layoutPass(pass);
    expect(layout.auxiliaryFields.map((field) => field.key)).toEqual(["number", "seat", "group", "boarding"]);
    expect(layout.backFields.filter((field) => field.key === "cabin" || field.key === "car")).toEqual([
      { key: "cabin", label: "Cabin", value: "Economy" }, { key: "car", label: "Car", value: "7" },
    ]);
  });

  it("uses zero points before a balance, and a currency field when there are no points", () => {
    const pass: Pass = { type: "storeCard", title: "Rewards", holderName: "Aiko", membership: { points: 0, balance: { amount: 12.5, currency: "USD" } } };
    expect(layoutPass(pass).primaryFields).toEqual([{ key: "points", label: "Points", value: 0 }]);
    expect(layoutPass({ ...pass, membership: { balance: { amount: 0, currency: "JPY" } } }).primaryFields).toEqual([{ key: "balance", label: "Balance", value: 0, currencyCode: "JPY" }]);
    expect(layoutPass({ ...pass, membership: undefined }).primaryFields[0].value).toBe("Aiko");
    expect(layoutPass({ type: "storeCard", title: "Rewards" }).primaryFields[0].value).toBe("Rewards");
  });

  it.each([
    ["air", "PKTransitTypeAir", "Flight"], ["train", "PKTransitTypeTrain", "Train"], ["bus", "PKTransitTypeBus", "Bus"], ["boat", "PKTransitTypeBoat", "Boat"], ["other", "PKTransitTypeGeneric", "Service"],
  ] as const)("maps %s travel to its Wallet style", (mode, transitType, label) => {
    const layout = layoutPass(boardingPass({ transit: { mode, from: { city: "Tokyo" }, to: { city: "Paris" }, number: "101", gate: "2", platform: "16" } }));
    expect(layout.transitType).toBe(transitType);
    expect(layout.auxiliaryFields[0].label).toBe(label);
    expect(layout.headerFields[0].value).toBe(mode === "train" ? "16" : "2");
    expect(layout.primaryFields.map((field) => field.value)).toEqual(["Tokyo", "Paris"]);
  });
});

describe("dates and time zones", () => {
  it("shows only departure time on the front, and the full local departure with its zone on the back", () => {
    const layout = layoutPass(boardingPass());
    expect(layout.secondaryFields.find((field) => field.key === "departs")).toEqual({ key: "departs", label: "Departs", value: "2026-12-03T10:25:00+09:00", dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort", ignoresTimeZone: true });
    expect(layout.backFields.find((field) => field.key === "departure_back")).toEqual({ key: "departure_back", label: "Departs", value: "2026-12-03T10:25:00+09:00", dateStyle: "PKDateStyleMedium", timeStyle: "PKDateStyleShort", ignoresTimeZone: true });
    expect(layout.backFields.find((field) => field.key === "departure_timezone")?.value).toBe("Asia/Tokyo");
    expect(layout.backFields.find((field) => field.key === "arrival")?.value).toBe("2026-12-03T16:40:00+01:00");
    expect(layout.backFields.find((field) => field.key === "arrival_timezone")?.value).toBe("UTC+01:00");
  });

  it("shows explicit offsets when no departure IANA zone is available", () => {
    const layout = layoutPass(boardingPass({ timeZone: undefined, end: "2026-12-03T15:40:00Z" }));
    expect(layout.backFields.find((field) => field.key === "departure_timezone")?.value).toBe("UTC+09:00");
    expect(layout.backFields.find((field) => field.key === "arrival_timezone")?.value).toBe("UTC");
  });

  it.each([
    ["2026-12-03T10:25:00Z", "Asia/Tokyo", "UTC"],
    ["2026-12-03T10:25:00+09:00", "Asia/Tokyo", "Asia/Tokyo"],
    ["2026-01-03T10:25:00-05:00", "America/New_York", "America/New_York"],
    ["2026-07-03T10:25:00-05:00", "America/New_York", "UTC-05:00"],
    ["2026-01-03T10:25:00-04:00", "America/New_York", "UTC-04:00"],
    ["2026-11-01T01:30:00-04:00", "America/New_York", "America/New_York"],
    ["2026-11-01T01:30:00-05:00", "America/New_York", "America/New_York"],
    ["2026-12-03T10:25:00+05:45", "Unknown/Zone", "UTC+05:45"],
  ])("names the departure zone only when it agrees with the offset: %s in %s", (start, timeZone, expectedZone) => {
    const layout = layoutPass(boardingPass({ start, timeZone }));
    expect(layout.backFields.find((field) => field.key === "departure_timezone")?.value).toBe(expectedZone);
    expect(layout.backFields.find((field) => field.key === "departure_back")?.value).toBe(start);
    expect(layout.secondaryFields.find((field) => field.key === "departs")?.value).toBe(start);
  });

  it("keeps ISO values and marks all date fields to ignore the viewer's time zone", () => {
    const pass: Pass = { type: "generic", title: "Gym", expires: "2026-12-31T23:59:59+09:00", start: "2026-12-03T10:25:00+09:00", membership: { since: "2026-01-01" } };
    const dateFields = allFields(layoutPass(pass)).filter((field) => field.dateStyle);
    expect(dateFields).toHaveLength(3);
    for (const field of dateFields) expect(field.ignoresTimeZone).toBe(true);
    expect(dateFields.map((field) => field.value)).toEqual([pass.expires, pass.start, "2026-01-01"]);
  });
});

describe("safe back fields", () => {
  it("keeps the back-field order, monetary values, source and branding", () => {
    const layout = layoutPass({
      type: "generic", title: "Booking", notes: "Keep this note", attachments: [{ title: "Map", url: "https://example.com/map" }], holderName: "Aiko", confirmationCode: "A1", ticketNumber: "T1", price: { amount: 0, currency: "JPY" }, venue: { name: "Hall", address: "Street", room: "Room 3" },
      extraFields: [{ label: "One", value: "1" }, { label: "Two", value: "2" }, { label: "Three", value: "3" }, { label: "Four", value: "4" }, { label: "Five", value: "5" }],
    }, { source: { subject: "Booking email", sender: "tickets@example.com" }, publicBaseUrl: "https://passclip.example" });
    expect(layout.backFields.map((field) => field.key)).toEqual(["notes", "att_1", "holder_back", "confirmation", "ticket_number", "price", "venue_back", "address", "room", "x_5", "source", "made_with"]);
    expect(layout.backFields.find((field) => field.key === "price")).toMatchObject({ value: 0, currencyCode: "JPY" });
    expect(layout.backFields.find((field) => field.key === "source")?.value).toBe("Imported from Booking email\ntickets@example.com");
    expect(layout.backFields.at(-1)).toEqual({ key: "made_with", label: "Made with Passclip", value: "https://passclip.example", attributedValue: '<a href="https://passclip.example">Open</a>' });
  });

  it("escapes URL attributes and keeps user text as plain fields", () => {
    const url = `https://example.com/?q="'><x>&ok=1`;
    const layout = layoutPass({ type: "generic", title: "<script>alert(1)</script>", notes: "<img src=x onerror=alert(1)>", attachments: [{ title: "<b>Map</b>", url }] });
    expect(layout.backFields.find((field) => field.key === "att_1")).toEqual({ key: "att_1", label: "<b>Map</b>", value: url, attributedValue: '<a href="https://example.com/?q=&quot;&#39;&gt;&lt;x&gt;&amp;ok=1">Open</a>' });
    expect(layout.backFields.find((field) => field.key === "notes")).toEqual({ key: "notes", label: "Notes", value: "<img src=x onerror=alert(1)>" });
    expect(allFields(layout).filter((field) => field.attributedValue)).toHaveLength(1);
  });

  it.each(["http://example.com/file", "javascript:alert(1)", "data:text/html,<script>", "https://", "https://example.com/has space", "https://example.com/\u0000file"])("never creates a link for %j", (url) => {
    const layout = layoutPass({ type: "generic", title: "Booking", attachments: [{ title: "Unsafe", url }, { title: "Safe", url: "https://example.com/file" }] });
    expect(layout.backFields.some((field) => field.key === "att_1")).toBe(false);
    expect(layout.backFields.find((field) => field.key === "att_2")?.attributedValue).toBe('<a href="https://example.com/file">Open</a>');
    expect(layout.warnings).toEqual([{ kind: "fix", message: "Removed “Unsafe” because its link isn't a full https:// link." }]);
  });

  it("keeps an http development base URL as plain text", () => {
    const layout = layoutPass({ type: "generic", title: "Booking" }, { publicBaseUrl: "http://localhost:3000" });
    expect(layout.backFields.at(-1)).toEqual({ key: "made_with", label: "Made with Passclip", value: "http://localhost:3000" });
  });

  it("doesn't mutate the pass or source, and doesn't use barcode contents", () => {
    const imported = read("flight");
    const before = JSON.stringify(imported);
    const layout = layoutPass(imported.passes[0], { source: imported.source });
    expect(JSON.stringify(imported)).toBe(before);
    expect(allFields(layout).some((field) => field.value === imported.passes[0].barcode?.message)).toBe(false);
    expect(layoutPass({ ...imported.passes[0], barcode: { format: "qr", message: "different barcode" } }, { source: imported.source })).toEqual(layout);
  });
});

describe("estimated display limits", () => {
  it("warns without truncating a long front value, a long label or a multiline extra field", () => {
    const title = "A".repeat(60);
    const subtitle = "B".repeat(25);
    const layout = layoutPass({ type: "generic", title, subtitle, extraFields: [{ label: "Notes", value: "Line one\nLine two" }] });
    expect(layout.primaryFields[0]).toEqual({ key: "title", label: subtitle, value: title });
    expect(layout.auxiliaryFields[0].value).toBe("Line one\nLine two");
    expect(layout.warnings).toEqual([
      { message: `“${subtitle}” may be too long for the front of a Wallet pass. Check the preview; Wallet may shorten it.` },
      { message: "“Notes” may be too long for the front of a Wallet pass. Check the preview; Wallet may shorten it." },
    ]);
  });

  it("doesn't apply front limits to notes, ISO dates or overflow on the back", () => {
    const short = Array.from({ length: 4 }, (_, index) => ({ label: `F${index}`, value: "x" }));
    const layout = layoutPass({ type: "eventTicket", title: "Jazz", start: "2026-12-03T10:25:00+09:00", notes: "N".repeat(1000), seat: { section: "B", row: "F", number: "12", entrance: "East" }, extraFields: [...short, { label: "Details", value: "D".repeat(300) }] });
    expect(layout.warnings).toEqual([]);
    expect(layout.backFields.find((field) => field.key === "x_5")?.value).toBe("D".repeat(300));
  });

  it("puts the date and time in an event ticket's header and the venue in a row of its own", () => {
    const timed = layoutPass({ type: "eventTicket", title: "Jazz", start: "2026-12-03T19:30:00+09:00", venue: { name: "Hall" } });
    expect(timed.headerFields.map((field) => [field.key, field.dateStyle, field.timeStyle])).toEqual([["date", "PKDateStyleShort", "PKDateStyleNone"], ["time", "PKDateStyleNone", "PKDateStyleShort"]]);
    expect(timed.secondaryFields.map((field) => field.key)).toEqual(["venue"]);
    const allDay = layoutPass({ type: "eventTicket", title: "Fair", start: "2026-12-03", venue: { name: "Park" } });
    expect(allDay.headerFields.map((field) => field.key)).toEqual(["date"]);
    expect(allDay.secondaryFields.map((field) => field.key)).toEqual(["venue"]);
  });
});
