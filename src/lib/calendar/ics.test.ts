import { readFileSync } from "node:fs";
import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import type { NormalizedPass } from "../import/normalize";
import { processImport } from "../import/process";
import { buildIcs, calendarEventFor, escapeText, foldLine, offersCalendar } from "./ics";

const fixture = (name: string): NormalizedPass => {
  const result = processImport(readFileSync(`examples/${name}.json`, "utf8"), { fallbackTimeZone: "Asia/Tokyo" });
  if (!result.ok) throw new Error(`Invalid fixture ${name}`);
  return result.value.passes[0];
};
const options = { uid: "test-serial@passclip.example", now: new Date("2026-10-03T12:00:00Z") };
const ics = (pass: NormalizedPass) => buildIcs(calendarEventFor(pass)!, options);

/** Reads the file back with ical.js, the standards-based parser Thunderbird uses. */
function parse(text: string) {
  const calendar = new ICAL.Component(ICAL.parse(text));
  const vevent = calendar.getFirstSubcomponent("vevent")!;
  const event = new ICAL.Event(vevent);
  return {
    calendar,
    summary: event.summary,
    start: event.startDate.toJSDate().toISOString(),
    end: event.endDate.toJSDate().toISOString(),
    location: event.location,
    description: event.description,
    uid: event.uid,
    geo: vevent.getFirstPropertyValue("geo"),
    // Alarm offsets in seconds before (negative) the start.
    alarms: vevent.getAllSubcomponents("valarm").map((alarm) => (alarm.getFirstPropertyValue("trigger") as ICAL.Duration).toSeconds()),
  };
}

describe("calendar events", () => {
  it("makes an event ticket's calendar file with UTC times, venue, details and a 2-hour alert", () => {
    const text = ics(fixture("event-tickets"));
    expect(parse(text)).toMatchObject({
      summary: "Jazz Night",
      start: "2026-11-14T10:30:00.000Z",
      end: "2026-11-14T13:00:00.000Z",
      location: "Blue Lantern Hall, 2-1 Example-dori, Minato-ku, Tokyo, Japan",
      description: "Section B, row F, seat 12\nConfirmation: BL-48213\nDoors open 18:30. One drink order required at the bar.\nVenue map: https://bluelantern.example/map.pdf",
      uid: "test-serial@passclip.example",
      alarms: [-7200],
    });
    expect(text).toContain("DTSTART:20261114T103000Z\r\n");
    expect(text).toContain("PRODID:-//Passclip//Passclip//EN\r\n");
    expect(text).toContain("DTSTAMP:20261003T120000Z\r\n");
  });

  it("names flights by number and route, crosses time zones correctly, and alerts 3 hours ahead", () => {
    expect(parse(ics(fixture("flight")))).toMatchObject({
      summary: "ZQ 101 Tokyo → Paris",
      start: "2026-12-03T01:25:00.000Z",
      end: "2026-12-03T15:40:00.000Z",
      location: "Tokyo Haneda → Paris Charles de Gaulle",
      description: "Seat 34K\nGate: 112\nConfirmation: Q7XK2P\nBag drop closes 60 minutes before departure.\nManage booking: https://skylane.example/manage/Q7XK2P",
      alarms: [-10800],
    });
  });

  it("uses the train's local times in its own zone and alerts 30 minutes ahead", () => {
    expect(parse(ics(fixture("train-local-time")))).toMatchObject({
      summary: "Express 503 Tokyo → Kyoto",
      start: "2026-11-19T23:03:00.000Z",
      end: "2026-11-20T01:18:00.000Z",
      description: "Car 7, row 12, seat D\nPlatform: 16\nConfirmation: R-55120",
      alarms: [-1800],
    });
  });

  it("fills in a missing end: two hours for events, one for travel", () => {
    const ticket = { ...fixture("event-tickets"), end: undefined };
    expect(calendarEventFor(ticket)?.end).toBe("2026-11-14T21:30:00+09:00");
    const flight = { ...fixture("flight"), end: undefined };
    expect(calendarEventFor(flight)?.end).toBe("2026-12-03T11:25:00+09:00");
    const backwards = { ...fixture("event-tickets"), end: "2026-11-14T18:00:00+09:00" };
    expect(calendarEventFor(backwards)?.end).toBe("2026-11-14T21:30:00+09:00");
  });

  it("offers files for event tickets and travel by default, and follows calendar.add", () => {
    expect(offersCalendar(fixture("event-tickets"))).toBe(true);
    expect(offersCalendar(fixture("flight"))).toBe(true);
    expect(offersCalendar(fixture("coupon"))).toBe(false); // no start
    const gym = fixture("gym-membership");
    expect(offersCalendar({ ...gym, start: "2026-10-05T07:00:00+09:00" })).toBe(false);
    expect(offersCalendar({ ...gym, start: "2026-10-05T07:00:00+09:00", calendar: { add: true } })).toBe(true);
    expect(offersCalendar({ ...fixture("event-tickets"), calendar: { add: false } })).toBe(false);
    expect(calendarEventFor({ ...fixture("event-tickets"), calendar: { add: false } })).toBeUndefined();
  });

  it("uses the import's own title, alerts and coordinates", () => {
    const pass = {
      ...fixture("event-tickets"),
      calendar: { title: "Jazz with Ken", alertMinutesBefore: [0, 1440] },
      venue: { name: "Blue Lantern Hall", latitude: 35.66, longitude: 139.73 },
    };
    const parsed = parse(ics(pass));
    expect(parsed).toMatchObject({ summary: "Jazz with Ken", alarms: [0, -86400], geo: [35.66, 139.73] });
  });
});

describe("RFC 5545 text rules", () => {
  it("escapes commas, semicolons, backslashes and line breaks, and round-trips through a parser", () => {
    expect(escapeText("a,b;c\\d\ne\r\nf")).toBe("a\\,b\\;c\\\\d\\ne\\nf");
    const tricky = { ...fixture("event-tickets"), title: "Rock; Roll, \\o/", notes: "Line 1\nLine 2; with, punctuation" };
    expect(parse(ics(tricky))).toMatchObject({ summary: "Rock; Roll, \\o/", description: expect.stringContaining("Line 1\nLine 2; with, punctuation") });
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const text of ["SUMMARY:" + "x".repeat(200), "DESCRIPTION:" + "東京駅で乗り換え🎟".repeat(12)]) {
      const folded = foldLine(text);
      for (const line of folded.split("\r\n")) {
        const bytes = encoder.encode(line);
        expect(bytes.length).toBeLessThanOrEqual(75);
        expect(() => decoder.decode(bytes)).not.toThrow();
      }
      expect(folded.replace(/\r\n /g, "")).toBe(text);
    }
  });

  it("uses CRLF line endings throughout", () => {
    const text = ics({ ...fixture("event-tickets"), notes: "x".repeat(300) });
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("produces a file ical.js reads for every example that offers one", () => {
    for (const name of ["event-tickets", "flight", "train-local-time"]) {
      const parsed = parse(ics(fixture(name)));
      expect(parsed.calendar.getFirstPropertyValue("version")).toBe("2.0");
      expect(Date.parse(parsed.end)).toBeGreaterThan(Date.parse(parsed.start));
    }
  });
});
