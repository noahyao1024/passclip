// Checks an App Store listing file (scripts/app-store/metadata/<locale>.json) before it goes to App Store Connect.
// Search matches the name, subtitle and keywords together, so a word in two of them only wastes characters.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export const limits = { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000 };
// Guideline 2.3.7: Apple's own names and old trademarks in metadata can get an update rejected.
const reserved = ["apple", "iphone", "ipad", "ios", "passbook"];

const words = (text) => (text ?? "").toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean);

/** Problems with a listing, in plain English. An empty list means it's ready to send. */
export function checkListing(listing) {
  const problems = [];
  for (const [field, max] of Object.entries(limits)) {
    const value = listing[field];
    if (value !== undefined && typeof value !== "string") problems.push(`${field} must be text.`);
    else if (value && [...value].length > max) problems.push(`${field} is ${[...value].length} characters; the limit is ${max}.`);
  }
  if (!listing.name?.trim()) problems.push("name is required.");
  const keywords = (listing.keywords ?? "").split(",");
  if (keywords.some((k) => k !== k.trim())) problems.push("keywords: remove the spaces around commas; they count toward the 100 characters.");
  const titleWords = new Set([...words(listing.name), ...words(listing.subtitle)]);
  const seen = new Set();
  for (const word of keywords.flatMap((k) => words(k))) {
    if (titleWords.has(word)) problems.push(`keywords: "${word}" is already in the name or subtitle.`);
    else if (seen.has(word)) problems.push(`keywords: "${word}" appears twice.`);
    seen.add(word);
  }
  for (const word of new Set([...titleWords, ...seen])) {
    if (reserved.includes(word)) problems.push(`"${word}" is an Apple name; leave it out of the name, subtitle and keywords.`);
  }
  return problems;
}

/** Reads a listing file; its name is the App Store locale, like en-US.json. */
export function readListing(file) {
  return { locale: basename(file).replace(/\.json$/, ""), listing: JSON.parse(readFileSync(file, "utf8")) };
}
