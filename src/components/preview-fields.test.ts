import { Settings } from "luxon";
import { describe, expect, it } from "vitest";
import type { PassField } from "../lib/pass/fields";
import { fieldLink, formatFieldValue } from "./preview-fields";

const dateField: PassField = {
  key: "departs",
  label: "Departs",
  value: "2026-12-03T10:25:00+09:00",
  dateStyle: "PKDateStyleNone",
  timeStyle: "PKDateStyleShort",
  ignoresTimeZone: true,
};

describe("preview field formatting", () => {
  it("keeps departure and arrival wall times when the viewer is elsewhere", () => {
    const previousZone = Settings.defaultZone;
    Settings.defaultZone = "America/Los_Angeles";
    try {
      expect(formatFieldValue(dateField, { locale: "en-US" })).toBe("10:25 AM");
      expect(formatFieldValue({
        ...dateField,
        value: "2026-12-03T16:40:00+01:00",
        dateStyle: "PKDateStyleMedium",
      }, { locale: "en-US", showTimeZone: true })).toBe("Dec 3, 2026, 4:40 PM (UTC+01:00)");
    } finally {
      Settings.defaultZone = previousZone;
    }
  });

  it("shows the full departure date and explicit offset on the back", () => {
    expect(formatFieldValue({ ...dateField, dateStyle: "PKDateStyleMedium" }, {
      locale: "en-US",
      showTimeZone: true,
    })).toBe("Dec 3, 2026, 10:25 AM (UTC+09:00)");
  });

  it("localizes dates while preserving midnight and fractional-hour offsets", () => {
    expect(formatFieldValue({ ...dateField, value: "2026-12-03T00:05:00+05:45" }, {
      locale: "en-GB",
      showTimeZone: true,
    })).toBe("0:05 (UTC+05:45)");
    expect(formatFieldValue({ ...dateField, dateStyle: "PKDateStyleMedium", timeStyle: "PKDateStyleNone" }, {
      locale: "en-GB",
      showTimeZone: true,
    })).toBe("3 Dec 2026");
  });

  it("uses each currency's own fraction digits and groups plain numbers", () => {
    expect(formatFieldValue({ key: "balance", label: "Balance", value: 1234.5, currencyCode: "USD" }, { locale: "en-US" })).toBe("$1,234.50");
    expect(formatFieldValue({ key: "price", label: "Price", value: 1200, currencyCode: "JPY" }, { locale: "en-US" })).toBe("¥1,200");
    expect(formatFieldValue({ key: "points", label: "Points", value: 12345 }, { locale: "en-US" })).toBe("12,345");
  });

  it("keeps usable text if a currency, locale or date cannot be formatted", () => {
    expect(formatFieldValue({ key: "price", label: "Price", value: 12.5, currencyCode: "BAD CODE" }, { locale: "en-US" })).toBe("12.5 BAD CODE");
    expect(formatFieldValue({ key: "points", label: "Points", value: 12.5 }, { locale: "bad locale" })).toBe("12.5");
    expect(formatFieldValue({ ...dateField, value: "impossible-date" })).toBe("impossible-date");
    expect(formatFieldValue({ key: "notes", label: "Notes", value: "Line 1\n<em>Line 2</em>" })).toBe("Line 1\n<em>Line 2</em>");
  });
});

describe("preview links", () => {
  it("uses the https field value without interpreting attributed HTML", () => {
    const url = "https://tickets.example/open?ticket=12&show=34";
    expect(fieldLink({ key: "att_1", label: "Ticket", value: url, attributedValue: '<script>alert("ignored")</script>' })).toBe(url);
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "http://tickets.example/", "https:tickets.example", "https://tickets.example/\nnext", "https://"])('does not activate unsafe or incomplete link "%s"', (value) => {
    expect(fieldLink({ key: "att_1", label: "Ticket", value, attributedValue: "<a>Open</a>" })).toBeUndefined();
  });

  it("keeps ordinary text and numbers as fields", () => {
    expect(fieldLink({ key: "notes", label: "Notes", value: "https://tickets.example/" })).toBeUndefined();
    expect(fieldLink({ key: "points", label: "Points", value: 12, attributedValue: "<a>Open</a>" })).toBeUndefined();
  });
});
