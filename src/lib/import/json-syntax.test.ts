import { describe, expect, it } from "vitest";
import { findJsonSyntaxError } from "./json-syntax";

function errorAt(text: string) {
  const error = findJsonSyntaxError(text);
  if (!error) throw new Error("expected a syntax error");
  return { ...error, at: text.slice(error.offset, error.offset + 8) };
}

describe("findJsonSyntaxError", () => {
  it("accepts valid JSON", () => {
    expect(findJsonSyntaxError('{"a": [1, -2.5e3, true, false, null, "x\\n\\u00e9"], "b": {}}')).toBeUndefined();
    expect(findJsonSyntaxError("  [ ]  ")).toBeUndefined();
  });

  it.each([
    ['{"a": 1 "b": 2}', '"b": 2}', "Expected a comma or a closing } here."],
    ['{"a": [1, 2}', "}", "Expected a comma or a closing ] here."],
    ["{a: 1}", "a: 1}", 'Field names need double quotes, like "a".'],
    ["{'a': 1}", "'a': 1}", 'Use double quotes (") instead of single quotes.'],
    ['{"a": “x”}', "“x”}", 'Use straight double quotes (") instead of curly quotes.'],
    ['{"a": tru}', "tru}", '"tru" needs double quotes around it.'],
    ['{"a": 1,}', "}", "Remove the comma before }."],
    ["[1,]", "]", "Remove the comma before ]."],
    ['{"a" 1}', "1}", "Expected a colon (:) after the field name."],
    ['{"a": "x\\q"}', '\\q"}', '"\\q" isn\'t a valid escape. Write a backslash as \\\\.'],
    ['{"a": "two\nlines"}', "\nlines\"}", "A text value has a line break in it. Write line breaks as \\n."],
    ['{"a": -}', "-}", "This number isn't written correctly. Use digits, like 8800 or 12.5."],
    ["{} {}", "{}", "There's extra text after the end of the JSON. Remove it."],
  ])("explains %j", (text, at, reason) => {
    expect(errorAt(text)).toMatchObject({ reason, at: at.slice(0, 8) });
  });

  it("points at the start of an unclosed string", () => {
    expect(errorAt('{"a": "never closed}')).toMatchObject({ offset: 6, reason: "A text value is missing its closing quote." });
  });

  it("says when the JSON is cut off", () => {
    expect(findJsonSyntaxError('{"passes": [{"type": "coupon"')?.reason).toBe(
      "The JSON ends too early. Check that you copied the whole reply, down to the last } or ].",
    );
  });

  it("stops at absurd nesting instead of overflowing the stack", () => {
    expect(findJsonSyntaxError("[".repeat(100_000))?.reason).toBe("The JSON is nested too deeply.");
  });
});
