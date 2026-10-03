import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processImport } from "../import/process";
import { layoutPass } from "./fields";
import { mapToPassJson } from "./map";

const config = { passTypeIdentifier: "pass.com.example.test", teamIdentifier: "ABCDE12345", serialNumber: "fixed-test-serial", publicBaseUrl: "https://passclip.example" };
const fixture = (name: string) => {
  const result = processImport(readFileSync(`examples/${name}.json`, "utf8"), { fallbackTimeZone: "Asia/Tokyo" });
  if (!result.ok) throw new Error("Invalid fixture");
  return result.value;
};
describe("mapToPassJson", () => {
  for (const name of ["event-tickets", "flight", "train-local-time", "loyalty-card", "coupon", "gym-membership"]) {
    it(`maps ${name} with the exact preview fields`, () => {
      const { passes, source } = fixture(name);
      const pass = passes[0];
      const mapped = mapToPassJson(pass, { ...config, source });
      const { warnings: _warnings, ...layout } = layoutPass(pass, { source, publicBaseUrl: config.publicBaseUrl });
      void _warnings;
      expect(mapped[pass.type]).toEqual(layout);
      expect(mapped).toMatchSnapshot();
      expect(mapped.serialNumber).toBe(config.serialNumber);
      expect(mapped.backgroundColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      expect(mapped).not.toHaveProperty("webServiceURL");
      if (pass.barcode) expect(mapped.barcodes![0].message).toBe(pass.barcode.message);
    });
  }
  it("sets relevance and expiration using absolute times across zones", () => {
    const pass = fixture("flight").passes[0];
    const mapped = mapToPassJson(pass, config);
    expect(Date.parse(mapped.expirationDate!)).toBe(Date.parse(pass.end!) + 6 * 3600000);
    expect(Date.parse(mapped.relevantDates![0].startDate)).toBe(Date.parse(pass.transit!.boardingTime!) - 3 * 3600000);
    expect(Date.parse(mapped.relevantDates![0].endDate)).toBe(Date.parse(pass.start!) + 3600000);
  });
  it("uses UTF-8 only when the exact barcode data needs it", () => {
    const pass = fixture("loyalty-card").passes[0];
    for (const [message, encoding] of [["  ^FNC1 Café  ", "iso-8859-1"], ["東京 🎟", "utf-8"]]) {
      const mapped = mapToPassJson({ ...pass, barcode: { format: "qr", message } }, config);
      expect(mapped.barcodes![0]).toMatchObject({ message, messageEncoding: encoding });
    }
  });
  it("keeps explicit expiry and omits unsupported long relevance intervals", () => {
    const pass = fixture("event-tickets").passes[0];
    const mapped = mapToPassJson({ ...pass, start: "2026-11-01T12:00:00Z", end: "2026-11-03T12:00:00Z", expires: "2026-11-04T23:59:59Z" }, config);
    expect(mapped).not.toHaveProperty("relevantDates");
    expect(mapped.relevantDate).toBe("2026-11-01T12:00:00Z");
    expect(mapped.expirationDate).toBe("2026-11-04T23:59:59Z");
  });
  it("preserves zero coordinates and never adds grouping to unrelated styles", () => {
    const pass = fixture("gym-membership").passes[0];
    const mapped = mapToPassJson({ ...pass, confirmationCode: "BOOKING", venue: { name: "Origin", latitude: 0, longitude: 0 } }, config);
    expect(mapped.locations).toEqual([{ latitude: 0, longitude: 0, relevantText: pass.title }]);
    expect(mapped).not.toHaveProperty("groupingIdentifier");
  });
});
