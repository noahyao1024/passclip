import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_INPUT_BYTES, parseImportText, type ParseResult } from "./parse";

function parsed(result: ParseResult) {
  if (!result.ok) throw new Error(`expected the text to parse: ${result.error.message}`);
  return result;
}

function failed(result: ParseResult) {
  if (result.ok) throw new Error("expected a parse error");
  return result;
}

const messages = (result: ParseResult) => result.warnings.map((warning) => warning.message);
const fixture = (name: string) => readFileSync(`examples/recoverable/${name}`, "utf8");

describe("recoverable examples (examples/README.md)", () => {
  it("fenced-with-prose.txt: takes the JSON out of the fence and ignores the text around it", () => {
    const result = parsed(parseImportText(fixture("fenced-with-prose.txt")));
    expect(messages(result)).toEqual(["Took the JSON out of the code block and ignored the text around it."]);
    expect(result.data).toMatchObject({ schemaVersion: "1.0", passes: [{ title: "City Library" }] });
  });

  it("single-pass-root.json: wraps a single pass in the import format", () => {
    const result = parsed(parseImportText(fixture("single-pass-root.json")));
    expect(messages(result)).toEqual(["The JSON was a single pass, so Passclip wrapped it in the import format."]);
    expect(result.data).toMatchObject({ schemaVersion: "1.0", passes: [{ type: "coupon", title: "Corner Bakery" }] });
  });

  it("curly-quotes.txt: replaces curly quotes, then parses", () => {
    const result = parsed(parseImportText(fixture("curly-quotes.txt")));
    expect(messages(result)).toEqual(["Replaced curly quotes with straight quotes."]);
    expect(result.data).toMatchObject({ passes: [{ title: "Film Night", seat: { row: "H", number: "7" } }] });
  });

  it("trailing-comma-no-version.txt: removes trailing commas and adds the schemaVersion", () => {
    const result = parsed(parseImportText(fixture("trailing-comma-no-version.txt")));
    expect(messages(result)).toEqual([
      "Removed commas that came right before a } or ].",
      'Added the missing "schemaVersion": "1.0".',
    ]);
    expect(result.data).toMatchObject({ schemaVersion: "1.0", passes: [{ title: "Harbor Parking" }] });
  });

  it("unknown-keys.json: parses as-is (validation removes the unknown keys)", () => {
    expect(messages(parsed(parseImportText(fixture("unknown-keys.json"))))).toEqual([]);
  });

  it("marks every recovery as a fix", () => {
    const result = parsed(parseImportText(fixture("trailing-comma-no-version.txt")));
    expect(result.warnings.every((warning) => warning.kind === "fix")).toBe(true);
  });
});

describe("parseImportText", () => {
  it("parses valid JSON without warnings, ignoring a byte-order mark and whitespace", () => {
    const result = parsed(parseImportText('﻿\n  {"schemaVersion": "1.0", "passes": []}  \n'));
    expect(result).toEqual({ ok: true, data: { schemaVersion: "1.0", passes: [] }, warnings: [] });
  });

  it("takes JSON out of surrounding text without a fence, even with brackets inside strings", () => {
    const result = parsed(
      parseImportText('Sure! {"schemaVersion": "1.0", "passes": [{"type": "generic", "title": "a } b ] \\" c"}]} Hope this helps.'),
    );
    expect(messages(result)).toEqual(["Ignored the text around the JSON."]);
    expect(result.data).toMatchObject({ passes: [{ title: 'a } b ] " c' }] });
  });

  it("reads an unclosed code block to the end, for replies that got cut off after the JSON", () => {
    const result = parsed(parseImportText('```json\n{"schemaVersion": "1.0", "passes": []}\n'));
    expect(messages(result)).toEqual(["Took the JSON out of the code block."]);
  });

  it("wraps a list of passes", () => {
    const result = parsed(parseImportText('[{"type": "generic", "title": "A"}, {"type": "generic", "title": "B"}]'));
    expect(messages(result)).toEqual(["The JSON was a list of passes, so Passclip wrapped it in the import format."]);
    expect(result.data).toMatchObject({ schemaVersion: "1.0", passes: [{ title: "A" }, { title: "B" }] });
  });

  it("leaves commas and curly quotes inside text values alone", () => {
    const result = parsed(
      parseImportText('{"passes": [{"type": "generic", "title": "The “Big” Show", "notes": "a, ]",}]}'),
    );
    expect(messages(result)).toEqual([
      "Removed commas that came right before a } or ].",
      'Added the missing "schemaVersion": "1.0".',
    ]);
    expect(result.data).toMatchObject({ passes: [{ title: "The “Big” Show", notes: "a, ]" }] });
  });

  it("says where the problem is in the pasted text, counting the lines around the JSON", () => {
    const input = [
      "Here you go:",
      "```json",
      "{",
      '  "schemaVersion": "1.0",',
      '  "passes": [',
      '    { "type": "coupon" "title": "Corner Bakery" }',
      "  ]",
      "}",
      "```",
    ].join("\n");
    const { error } = failed(parseImportText(input));
    expect(error.message).toBe("Expected a comma or a closing } here.");
    const line = '    { "type": "coupon" "title": "Corner Bakery" }';
    expect(error.location).toMatchObject({ line: 6, column: line.indexOf('"title"') + 1, snippet: line });
    expect(input.slice(error.location!.offset).startsWith('"title"')).toBe(true);
  });

  it("finds the remaining problem after fixing curly quotes", () => {
    const input = "{“passes”: [ {“type”: “generic” “title”: “A”} ]}";
    const { error } = failed(parseImportText(input));
    expect(error.message).toBe("Expected a comma or a closing } here.");
    expect(error.location?.column).toBe(input.indexOf("“title”") + 1);
  });

  it("shortens long lines around the problem", () => {
    const input = `{"passes": [{"type": "generic", "title": "${"x".repeat(100)}" "notes": "${"y".repeat(100)}"}]}`;
    const { error } = failed(parseImportText(input));
    expect(error.location?.snippet).toMatch(/^….{80}…$/);
    expect(error.location?.snippet.slice(error.location.snippetColumn - 1)).toMatch(/^"notes"/);
  });

  it.each([
    ["", "Paste the JSON from your AI chat, or drop a .json or .txt file."],
    ["   \n ", "Paste the JSON from your AI chat, or drop a .json or .txt file."],
    ["I couldn't find a ticket in this email.", "There's no JSON here. Paste the AI's reply: it starts with { and ends with }."],
  ])("explains input that has no JSON: %j", (input, message) => {
    expect(failed(parseImportText(input)).error.message).toBe(message);
  });

  it("refuses more than 256 KB", () => {
    const input = `{"passes": [], "warnings": ["${"é".repeat(MAX_INPUT_BYTES / 2)}"]}`;
    expect(failed(parseImportText(input)).error.message).toBe(
      "This is over 256 KB, which is more than one import can be. Paste only the JSON from the AI's reply.",
    );
  });
});
