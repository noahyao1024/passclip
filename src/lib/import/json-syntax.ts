// Finds the first JSON syntax error and explains it in plain words.
// Browsers' own JSON.parse messages differ, and Safari's don't say where the problem is.

export interface JsonSyntaxError {
  /** Offset of the problem in the text (UTF-16 code units). */
  offset: number;
  reason: string;
}

const MAX_DEPTH = 256;

class SyntaxProblem {
  constructor(
    readonly offset: number,
    readonly reason: string,
  ) {}
}

/** Returns the first syntax error in `text`, or undefined if it's valid JSON. */
export function findJsonSyntaxError(text: string): JsonSyntaxError | undefined {
  let pos = 0;

  const fail = (reason: string, at = pos): never => {
    throw new SyntaxProblem(at, reason);
  };

  const skipWhitespace = () => {
    while (pos < text.length && " \t\n\r".includes(text[pos])) pos++;
  };

  const describe = (char: string) => {
    if (char === "'") return 'Use double quotes (") instead of single quotes.';
    if (char === "“" || char === "”") return 'Use straight double quotes (") instead of curly quotes.';
    return `Unexpected character "${char}".`;
  };

  const endOfText = () =>
    fail("The JSON ends too early. Check that you copied the whole reply, down to the last } or ].");

  const parseString = () => {
    const start = pos;
    pos++; // opening quote
    while (pos < text.length) {
      const char = text[pos];
      if (char === '"') {
        pos++;
        return;
      }
      if (char === "\\") {
        const next = text[pos + 1];
        if (next === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(pos + 2, pos + 6))) {
            fail("\\u must be followed by four hex digits, like \\u00e9.");
          }
          pos += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) {
          pos += 2;
        } else {
          fail(`"\\${next ?? ""}" isn't a valid escape. Write a backslash as \\\\.`);
        }
        continue;
      }
      if (char === "\n" || char === "\r") fail("A text value has a line break in it. Write line breaks as \\n.");
      if (char < " ") fail("A text value has an invisible control character in it. Remove it.");
      pos++;
    }
    fail("A text value is missing its closing quote.", start);
  };

  const parseNumber = () => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(pos));
    if (!match || match[0] === "-") fail("This number isn't written correctly. Use digits, like 8800 or 12.5.");
    pos += match![0].length;
  };

  const parseWord = () => {
    for (const word of ["true", "false", "null"]) {
      if (text.startsWith(word, pos)) {
        pos += word.length;
        return;
      }
    }
    const word = /^[A-Za-z_]\w*/.exec(text.slice(pos))?.[0];
    fail(word ? `"${word}" needs double quotes around it.` : describe(text[pos]));
  };

  const parseValue = (depth: number): void => {
    if (depth > MAX_DEPTH) fail("The JSON is nested too deeply.");
    skipWhitespace();
    if (pos >= text.length) endOfText();
    const char = text[pos];
    if (char === "{") return parseObject(depth);
    if (char === "[") return parseArray(depth);
    if (char === '"') return parseString();
    if (char === "-" || (char >= "0" && char <= "9")) return parseNumber();
    parseWord();
  };

  const parseObject = (depth: number) => {
    pos++; // {
    skipWhitespace();
    if (text[pos] === "}") {
      pos++;
      return;
    }
    for (;;) {
      skipWhitespace();
      if (pos >= text.length) endOfText();
      if (text[pos] !== '"') {
        if (text[pos] === "}") fail("Remove the comma before }.");
        const word = /^[A-Za-z_]\w*/.exec(text.slice(pos))?.[0];
        fail(word ? `Field names need double quotes, like "${word}".` : describe(text[pos]));
      }
      parseString();
      skipWhitespace();
      if (pos >= text.length) endOfText();
      if (text[pos] !== ":") fail("Expected a colon (:) after the field name.");
      pos++;
      parseValue(depth + 1);
      skipWhitespace();
      if (pos >= text.length) endOfText();
      if (text[pos] === ",") {
        pos++;
        continue;
      }
      if (text[pos] === "}") {
        pos++;
        return;
      }
      fail("Expected a comma or a closing } here.");
    }
  };

  const parseArray = (depth: number) => {
    pos++; // [
    skipWhitespace();
    if (text[pos] === "]") {
      pos++;
      return;
    }
    for (;;) {
      skipWhitespace();
      if (text[pos] === "]") fail("Remove the comma before ].");
      parseValue(depth + 1);
      skipWhitespace();
      if (pos >= text.length) endOfText();
      if (text[pos] === ",") {
        pos++;
        continue;
      }
      if (text[pos] === "]") {
        pos++;
        return;
      }
      fail("Expected a comma or a closing ] here.");
    }
  };

  try {
    parseValue(0);
    skipWhitespace();
    if (pos < text.length) fail("There's extra text after the end of the JSON. Remove it.");
    return undefined;
  } catch (error) {
    if (error instanceof SyntaxProblem) return { offset: error.offset, reason: error.reason };
    throw error;
  }
}
