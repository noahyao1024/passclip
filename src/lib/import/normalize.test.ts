import { describe, expect, it } from "vitest";
import { normalizeImport, type NormalizeResult } from "./normalize";
import type { Pass, PassclipImport } from "./types";

function data(fields: Partial<Pass> = {}): PassclipImport {
  return { schemaVersion: "1.0", passes: [{ type: "generic", title: "Test pass", ...fields }] };
}

function success(result: NormalizeResult) {
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join("\n"));
  return result;
}

describe("time normalization", () => {
  it("adds a supplied zone's offset to local times, including boarding", () => {
    const result = success(normalizeImport(data({
      start: "2026-11-20T08:03", end: "2026-11-20T10:18", timeZone: "Asia/Tokyo",
      transit: { mode: "train", from: { name: "Tokyo" }, to: { name: "Kyoto" }, boardingTime: "2026-11-20T07:53:00.125" },
    })));
    expect(result.value.passes[0]).toMatchObject({
      start: "2026-11-20T08:03:00+09:00", end: "2026-11-20T10:18:00+09:00", needsTimeZone: false,
      transit: { boardingTime: "2026-11-20T07:53:00.125+09:00" },
    });
    expect(result.warnings).toEqual([]);
  });

  it("keeps explicit offsets unchanged, including a different arrival zone", () => {
    const result = success(normalizeImport(data({
      start: "2026-11-20T08:00:00+09:00", end: "2026-11-20T08:30:00-08:00", timeZone: "Asia/Tokyo",
      expires: "2026-11-21T04:00Z",
    })));
    expect(result.value.passes[0]).toMatchObject({
      start: "2026-11-20T08:00:00+09:00", end: "2026-11-20T08:30:00-08:00", expires: "2026-11-21T04:00Z", needsTimeZone: false,
    });
    expect(result.warnings).toEqual([]);
  });

  it("warns when an explicit start offset conflicts with the supplied event zone, preserving the time", () => {
    const result = success(normalizeImport(data({ start: "2026-12-03T10:25:00Z", timeZone: "Asia/Tokyo" })));
    expect(result.value.passes[0]).toMatchObject({ start: "2026-12-03T10:25:00Z", timeZone: "Asia/Tokyo", needsTimeZone: false });
    expect(result.warnings).toEqual([{ pass: 0, message: expect.stringMatching(/start UTC offset \(\+00:00\).*doesn't match Asia\/Tokyo.*Check the time and time zone.*kept the time/) }]);
  });

  it("warns independently about a conflicting boarding offset without flagging arrival or expiry", () => {
    const result = success(normalizeImport(data({
      start: "2026-12-03T10:25:00+09:00", end: "2026-12-03T08:30:00-08:00", timeZone: "Asia/Tokyo",
      expires: "2026-12-04T00:00:00Z",
      transit: { mode: "air", from: { code: "HND" }, to: { code: "SFO" }, boardingTime: "2026-12-03T10:00:00+08:00" },
    })));
    expect(result.value.passes[0]).toMatchObject({
      start: "2026-12-03T10:25:00+09:00", end: "2026-12-03T08:30:00-08:00", expires: "2026-12-04T00:00:00Z",
      transit: { boardingTime: "2026-12-03T10:00:00+08:00" },
    });
    expect(result.warnings).toEqual([{ pass: 0, message: expect.stringMatching(/boarding time UTC offset \(\+08:00\).*doesn't match Asia\/Tokyo/) }]);
  });

  it.each([
    ["2026-01-03T12:00:00+02:00", true],
    ["2026-07-03T12:00:00+01:00", true],
    ["2026-01-03T12:00:00+01:00", false],
    ["2026-07-03T12:00:00+02:00", false],
  ] as const)("compares an explicit offset with the zone at that instant: %s", (start, warns) => {
    const result = success(normalizeImport(data({ start, timeZone: "Europe/Paris" })));
    expect(result.value.passes[0].start).toBe(start);
    expect(result.warnings).toHaveLength(warns ? 1 : 0);
  });

  it.each(["2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00"])("accepts either explicit occurrence of a DST overlap: %s", (start) => {
    const result = success(normalizeImport(data({ start, timeZone: "America/New_York" })));
    expect(result.value.passes[0].start).toBe(start);
    expect(result.warnings).toEqual([]);
  });

  it("doesn't compare an explicit offset against the browser fallback when no zone was supplied", () => {
    const result = success(normalizeImport(data({ start: "2026-12-03T10:25:00Z" }), { fallbackTimeZone: "Asia/Tokyo" }));
    expect(result.value.passes[0].start).toBe("2026-12-03T10:25:00Z");
    expect(result.warnings).toEqual([]);
  });

  it("uses the fallback and asks for confirmation only once per pass", () => {
    const result = success(normalizeImport(data({ start: "2026-07-04T12:00", end: "2026-07-04T15:00" }), { fallbackTimeZone: "Europe/Paris" }));
    expect(result.value.passes[0]).toMatchObject({ start: "2026-07-04T12:00:00+02:00", end: "2026-07-04T15:00:00+02:00", timeZone: "Europe/Paris", needsTimeZone: true });
    expect(result.warnings).toEqual([{ pass: 0, message: expect.stringContaining("Used Europe/Paris") }]);
  });

  it("ignores an unknown supplied zone with a fix warning, then uses the fallback", () => {
    const result = success(normalizeImport(data({ start: "2026-01-04T12:00", timeZone: "Moon/Base" }), { fallbackTimeZone: "Asia/Singapore" }));
    expect(result.value.passes[0]).toMatchObject({ start: "2026-01-04T12:00:00+08:00", timeZone: "Asia/Singapore", needsTimeZone: true });
    expect(result.warnings).toEqual([
      { kind: "fix", pass: 0, message: expect.stringContaining("unknown time zone") },
      { pass: 0, message: expect.stringContaining("Used Asia/Singapore") },
    ]);
  });

  it("doesn't ask for a zone when every operational time already has an offset", () => {
    const result = success(normalizeImport(data({ start: "2026-01-04T12:00Z", timeZone: "Moon/Base" })));
    expect(result.value.passes[0].needsTimeZone).toBe(false);
    expect(result.value.passes[0]).not.toHaveProperty("timeZone");
    expect(result.warnings).toHaveLength(1);
  });

  it("uses UTC with warnings if the caller supplied an unknown fallback", () => {
    const result = success(normalizeImport(data({ start: "2026-01-04T12:00" }), { fallbackTimeZone: "Moon/Base" }));
    expect(result.value.passes[0]).toMatchObject({ timeZone: "UTC", needsTimeZone: true, start: "2026-01-04T12:00:00Z" });
    expect(result.warnings).toHaveLength(2);
  });

  it("moves a DST gap forward with a warning that asks the user to check", () => {
    const result = success(normalizeImport(data({ start: "2026-03-08T02:30", timeZone: "America/New_York" })));
    expect(result.value.passes[0].start).toBe("2026-03-08T03:30:00-04:00");
    expect(result.warnings).toEqual([{ pass: 0, message: expect.stringMatching(/clock change.*Moved it to 2026-03-08 03:30:00 -04:00/) }]);
  });

  it("chooses the earlier occurrence of a DST overlap and warns", () => {
    const result = success(normalizeImport(data({ start: "2026-11-01T01:30", timeZone: "America/New_York" })));
    expect(result.value.passes[0].start).toBe("2026-11-01T01:30:00-04:00");
    expect(result.warnings).toEqual([{ pass: 0, message: expect.stringMatching(/happens twice.*earlier occurrence \(-04:00\)/) }]);
  });

  it("uses the expiry date's offset at 23:59:59, even on a DST transition day", () => {
    const result = success(normalizeImport(data({ expires: "2026-03-08", timeZone: "America/New_York" })));
    expect(result.value.passes[0].expires).toBe("2026-03-08T23:59:59-04:00");
    expect(result.warnings).toEqual([]);
  });

  it("uses the fallback for a date-only expiry", () => {
    const result = success(normalizeImport(data({ expires: "2026-12-31" }), { fallbackTimeZone: "Asia/Tokyo" }));
    expect(result.value.passes[0]).toMatchObject({ expires: "2026-12-31T23:59:59+09:00", needsTimeZone: true });
  });

  it.each(["2026-13-40T12:00", "2026-02-29T12:00", "2026-04-31T12:00Z", "2026-11-01T25:00", "2026-11-01T12:60", "2026-11-01T12:00+25:00", "2026-11-01T12:00+05:99"])("rejects impossible date or time %s", (start) => {
    const result = normalizeImport(data({ start }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual([{ pass: 0, message: "Pass 1: start isn't a real date or time. Check the day, month and UTC offset." }]);
  });

  it("accepts leap-day dates in leap years", () => {
    expect(success(normalizeImport(data({ start: "2028-02-29T12:00", timeZone: "UTC" }))).value.passes[0].start).toBe("2028-02-29T12:00:00Z");
  });

  it("rejects historical offsets with seconds instead of silently changing the instant", () => {
    const result = normalizeImport(data({ start: "1900-01-01T12:00", timeZone: "Europe/Paris" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual([{ pass: 0, message: expect.stringContaining("historical time zone offset that includes seconds") }]);
    // An explicit UTC timestamp can represent the exact instant without this limitation.
    expect(success(normalizeImport(data({ start: "1900-01-01T11:50:39Z", timeZone: "Europe/Paris" }))).value.passes[0].start).toBe("1900-01-01T11:50:39Z");
  });

  it("reports all impossible fields with their pass indexes", () => {
    const input = data({ end: "2026-02-30T12:00", expires: "2026-13-01", membership: { since: "2026-02-29" } });
    input.passes.unshift({ type: "generic", title: "Valid" });
    const result = normalizeImport(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(3);
      expect(result.errors.every((error) => error.pass === 1 && error.message.startsWith("Pass 2:"))).toBe(true);
    }
  });

  it("leaves display-only dates unchanged and doesn't ask for a zone", () => {
    const input = data({ membership: { since: "2024-02-29" } });
    input.source = { receivedAt: "2026-10-03T10:00" };
    const result = success(normalizeImport(input));
    expect(result.value.source).toEqual(input.source);
    expect(result.value.passes[0].membership?.since).toBe("2024-02-29");
    expect(result.value.passes[0].needsTimeZone).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("still rejects an impossible display-only received date", () => {
    const input = data();
    input.source = { receivedAt: "2026-02-30" };
    const result = normalizeImport(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toEqual({ message: expect.stringContaining("received date isn't a real date") });
  });
});

describe("normalization notices and input integrity", () => {
  it("collects import and per-pass AI warnings, including an empty import", () => {
    const input = data({ warnings: ["Check the time."] });
    input.warnings = ["Read the original ticket."];
    expect(success(normalizeImport(input)).warnings).toEqual([
      { from: "ai", message: "Read the original ticket." },
      { from: "ai", pass: 0, message: "Check the time." },
    ]);
    input.passes = [];
    expect(success(normalizeImport(input)).warnings).toEqual([{ from: "ai", message: "Read the original ticket." }]);
  });

  it("warns about Code 128 without changing a single character of barcode data", () => {
    const message = "  ABC\u0000\t123\n ";
    const input = data({ barcode: { format: "code128", message } });
    const result = success(normalizeImport(input));
    expect(result.value.passes[0].barcode?.message).toBe(message);
    expect(result.warnings).toEqual([{ pass: 0, message: expect.stringContaining("Apple Watch can't display Code 128") }]);
  });

  it("says which barcode types need iOS 27, without changing the data", () => {
    for (const [format, name] of [["ean13", "EAN-13"], ["code39", "Code 39"], ["codabar", "Codabar"], ["itf", "ITF"]] as const) {
      const result = success(normalizeImport(data({ barcode: { format, message: "A40156B" } })));
      expect(result.value.passes[0].barcode?.message).toBe("A40156B");
      expect(result.warnings).toEqual([{ pass: 0, message: `Wallet shows ${name} barcodes on iOS 27 and later. On older iPhones the pass has no barcode.` }]);
    }
    expect(success(normalizeImport(data({ barcode: { format: "qr", message: "X" } }))).warnings).toEqual([]);
  });

  it("doesn't mutate input objects when normalizing dates, zones or colors", () => {
    const input = data({ start: "2026-11-01T12:00", style: { backgroundColor: "#ffffff", foregroundColor: "#eeeeee" } });
    const before = structuredClone(input);
    const result = success(normalizeImport(input, { fallbackTimeZone: "Europe/Paris" }));
    result.value.passes[0].title = "Edited later";
    expect(input).toEqual(before);
    expect(result.warnings.some((warning) => warning.kind === "fix" && warning.pass === 0 && /text color/.test(warning.message))).toBe(true);
  });
});
