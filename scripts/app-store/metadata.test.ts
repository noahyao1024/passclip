import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkListing, readListing } from "./metadata.mjs";

const folder = join(__dirname, "metadata");

describe("App Store listings", () => {
  it.each(readdirSync(folder).filter((f) => f.endsWith(".json")))("%s is within Apple's limits and repeats no words", (file) => {
    expect(checkListing(readListing(join(folder, file)).listing)).toEqual([]);
  });

  it("finds what held back the 1.0 and 1.1 listing", () => {
    const live = { name: "Passclip", subtitle: "Ticket emails to Wallet passes", keywords: "wallet,pass,ticket,e-ticket,boarding pass,concert,event,pkpass,email,pdf,barcode,qr,apple wallet" };
    expect(checkListing(live)).toEqual([
      'keywords: "wallet" is already in the name or subtitle.',
      'keywords: "ticket" is already in the name or subtitle.',
      'keywords: "pass" appears twice.',
      'keywords: "wallet" is already in the name or subtitle.',
      '"apple" is an Apple name; leave it out of the name, subtitle and keywords.',
    ]);
  });

  it("checks lengths and spacing", () => {
    expect(checkListing({ name: "A".repeat(31), keywords: "one, two" })).toEqual([
      "name is 31 characters; the limit is 30.",
      "keywords: remove the spaces around commas; they count toward the 100 characters.",
    ]);
    expect(checkListing({ subtitle: "Tickets" })).toEqual(["name is required."]);
  });
});
