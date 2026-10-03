import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateImport, type ValidationResult } from "./validate";

const read = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

function errors(result: ValidationResult) {
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors.map((error) => error.message);
}

const pass = (fields: Record<string, unknown>) => ({ schemaVersion: "1.0", passes: [fields] });

describe("invalid examples get the messages from examples/README.md", () => {
  it("missing-title.json", () => {
    expect(errors(validateImport(read("examples/invalid/missing-title.json")))).toEqual([
      "Pass 1 needs a title, for example the event name.",
    ]);
  });

  it("bad-date-and-color.json", () => {
    expect(errors(validateImport(read("examples/invalid/bad-date-and-color.json")))).toEqual([
      "Pass 1: start must look like 2026-11-14T19:30:00+09:00.",
      "Pass 1: background color must be a hex color like #2D1E4A.",
    ]);
  });

  it("boarding-pass-without-transit.json", () => {
    expect(errors(validateImport(read("examples/invalid/boarding-pass-without-transit.json")))).toEqual([
      "Pass 1 is a boarding pass, so it needs travel details (transit with mode, from and to).",
    ]);
  });

  it("records the pass number on each error", () => {
    const result = validateImport({ schemaVersion: "1.0", passes: [{ type: "generic", title: "A" }, { type: "generic" }] });
    expect(result.ok ? [] : result.errors).toEqual([{ pass: 1, message: "Pass 2 needs a title, for example the event name." }]);
  });
});

describe("unknown keys", () => {
  it("unknown-keys.json: removes eventDate, color and venue.parking with a warning each", () => {
    const result = validateImport(read("examples/recoverable/unknown-keys.json"));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      { kind: "fix", pass: 0, message: 'Removed "eventDate", which isn\'t a Passclip field.' },
      { kind: "fix", pass: 0, message: 'Removed "color", which isn\'t a Passclip field.' },
      { kind: "fix", pass: 0, message: 'Removed "venue.parking", which isn\'t a Passclip field.' },
    ]);
    expect(result.ok && result.value.passes[0]).toEqual({
      type: "eventTicket",
      title: "Spring Football Final",
      start: "2027-03-14T15:00:00+09:00",
      venue: { name: "Example Stadium" },
      seat: { section: "112", row: "8", number: "21" },
    });
  });

  it("removes unknown keys at the top level too, and still reports real problems", () => {
    const result = validateImport({ schemaVersion: "1.0", passes: [{ type: "generic" }], extra: true });
    expect(result.warnings).toEqual([{ kind: "fix", message: 'Removed "extra", which isn\'t a Passclip field.' }]);
    expect(errors(result)).toEqual(["Pass 1 needs a title, for example the event name."]);
  });

  it("doesn't change the data it was given", () => {
    const data = pass({ type: "generic", title: "A", color: "red" });
    validateImport(data);
    expect(data.passes[0]).toHaveProperty("color", "red");
  });
});

describe("messages", () => {
  it.each([
    [pass({ type: "ticket", title: "A" }), "Pass 1: type must be eventTicket, boardingPass, storeCard, coupon or generic."],
    [pass({ title: "A" }), "Pass 1 needs a type: eventTicket, boardingPass, storeCard, coupon or generic."],
    [pass({ type: "generic", title: 5 }), "Pass 1: title must be text in double quotes."],
    [pass({ type: "generic", title: "A", expires: "31 Dec" }), "Pass 1: expiry date must look like 2026-12-31, or a date and time like 2026-12-31T23:59:00+09:00."],
    [pass({ type: "generic", title: "A", timeZone: "Tokyo time" }), "Pass 1: time zone must be a time zone name like Asia/Tokyo or Europe/Paris."],
    [pass({ type: "generic", title: "A", price: { amount: "¥8,800", currency: "JPY" } }), "Pass 1: price amount must be a number without quotes or currency symbols, like 8800."],
    [pass({ type: "generic", title: "A", price: { amount: 10, currency: "yen" } }), "Pass 1: price currency must be a three-letter currency code like JPY, USD or EUR."],
    [pass({ type: "generic", title: "A", price: { amount: -1, currency: "JPY" } }), "Pass 1: price amount must be 0 or more."],
    [pass({ type: "generic", title: "A".repeat(81) }), "Pass 1: title is too long. Use 80 characters at most."],
    [pass({ type: "generic", title: "A", venue: { name: "Hall", latitude: 35.6 } }), "Pass 1: venue latitude needs venue longitude too."],
    [pass({ type: "generic", title: "A", barcode: { format: "qr" } }), "Pass 1 is missing barcode message (barcode.message)."],
    [pass({ type: "generic", title: "A", extraFields: [{ label: "Gate" }] }), "Pass 1 is missing extra field 1 value (extraFields[0].value)."],
    [pass({ type: "generic", title: "A", attachments: [{ title: "Map", url: "https://a b" }] }), "Pass 1: attachment 1 link must be a full https:// link with no spaces."],
    [pass({ type: "generic", title: "A", calendar: { alertMinutesBefore: [30, 30] } }), "Pass 1: calendar alert times has the same value twice."],
    [pass({ type: "generic", title: "A", style: { foregroundColor: "white" } }), "Pass 1: text color must be a hex color like #FFFFFF."],
    [
      pass({ type: "boardingPass", title: "A", transit: { mode: "plane", from: { code: "HND" }, to: { code: "CDG" } } }),
      "Pass 1: travel mode must be air, train, bus, boat or other.",
    ],
    [
      pass({ type: "boardingPass", title: "A", transit: { mode: "air", from: { terminal: "1" }, to: { code: "CDG" } } }),
      "Pass 1: departure (transit.from) needs a code, name or city.",
    ],
    [pass({ type: "boardingPass", title: "A", transit: { mode: "air", to: { code: "CDG" } } }), "Pass 1 is missing departure (transit.from)."],
    [pass({ type: "boardingPass", title: "A", transit: { mode: "air", carrierCode: "zq", from: { code: "HND" }, to: { code: "CDG" } } }), "Pass 1: airline code must be the 2- or 3-character airline code in capitals, like NH."],
    [{ schemaVersion: "2.0", passes: [] }, '"schemaVersion" must be "1.0", the only format version Passclip reads.'],
    [{ schemaVersion: "1.0" }, 'The JSON needs a list of passes, like "passes": [ ... ]. Use the format from the AI prompt.'],
    [{ schemaVersion: "1.0", passes: {} }, "Passes must be a list in square brackets [ ]."],
    [{ schemaVersion: "1.0", passes: ["ticket"] }, "Pass 1 must be a group of fields in curly braces { }, with at least a type and a title."],
    [["not", "an", "import"], 'The JSON must be a group of fields in curly braces, like { "schemaVersion": "1.0", "passes": [ ... ] }.'],
    [{ schemaVersion: "1.0", passes: [], source: { sender: 42 } }, "Source sender must be text in double quotes."],
    [
      { schemaVersion: "1.0", passes: Array.from({ length: 21 }, () => ({ type: "generic", title: "A" })) },
      "An import can have 20 passes at most. Split the JSON into smaller imports.",
    ],
  ])("%j", (data, message) => {
    expect(errors(validateImport(data))).toEqual([message]);
  });

  it("accepts every valid example as-is, without warnings", () => {
    for (const name of ["coupon", "event-tickets", "flight", "gym-membership", "loyalty-card", "train-local-time"]) {
      expect(validateImport(read(`examples/${name}.json`))).toMatchObject({ ok: true, warnings: [] });
    }
  });
});
