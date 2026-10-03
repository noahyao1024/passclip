import { readFileSync } from "node:fs";
import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { POST } from "./route";

const read = (name: string) => readFileSync(`examples/${name}.json`, "utf8");
const form = (text: string, headers: Record<string, string> = {}) =>
  new Request("https://passclip.example/api/ics", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin", ...headers },
    body: new URLSearchParams({ import: text, fallbackTimeZone: "Asia/Tokyo" }).toString(),
  });
const uidOf = (body: string) => new ICAL.Component(ICAL.parse(body)).getFirstSubcomponent("vevent")!.getFirstPropertyValue("uid");

describe("POST /api/ics", () => {
  it("returns a calendar file for a form navigation, without signing", async () => {
    const response = await POST(form(read("event-tickets")));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Jazz-Night.ics"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("SUMMARY:Jazz Night\r\n");
    expect(body).toContain("DTSTART:20261114T103000Z\r\n");
  });

  it("gives the same pass the same event ID, so adding it again updates the event", async () => {
    const first = uidOf(await (await POST(form(read("event-tickets")))).text());
    const again = uidOf(await (await POST(form(read("event-tickets")))).text());
    const flight = uidOf(await (await POST(form(read("flight")))).text());
    expect(first).toBe(again);
    expect(first).toMatch(/^[0-9a-f]{32}@passclip\.example$/);
    expect(flight).not.toBe(first);
  });

  it("explains passes without a start, invalid imports and requests from other sites", async () => {
    const coupon = await POST(form(read("coupon")));
    expect(coupon.status).toBe(400);
    expect(await coupon.json()).toEqual({ errors: [{ message: "This pass has no start time to add to a calendar." }] });
    const invalid = await POST(form('{"passes":[{"type":"generic"}]}'));
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(await invalid.json())).toContain("needs a title");
    const crossSite = await POST(form(read("event-tickets"), { "Sec-Fetch-Site": "cross-site" }));
    expect(crossSite.status).toBe(403);
  });
});
