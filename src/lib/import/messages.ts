import type { ErrorObject } from "ajv";
import type { ImportError } from "./notices";
import { fieldPath, parsePointer, splitPassPath, type Path } from "./paths";

// Turns Ajv's validation errors into plain messages with the pass number and field
// (docs/SPEC.md §3.2), for people who may never have seen JSON before.

const PASS_TYPES = "eventTicket, boardingPass, storeCard, coupon or generic";

// How a field is named when it holds other fields. "" leaves it out: "style.backgroundColor"
// reads as "background color".
const GROUP_NAMES: Record<string, string> = {
  style: "",
  membership: "",
  transit: "",
  from: "departure",
  to: "arrival",
  extraFields: "extra field",
  attachments: "attachment",
  alertMinutesBefore: "alert",
};

// How a field is named when it's the one with the problem.
const FIELD_NAMES: Record<string, string> = {
  transit: "travel details",
  from: "departure",
  to: "arrival",
  memberId: "member ID",
  url: "link",
  altText: "text under the code",
  foregroundColor: "text color",
  carrierCode: "airline code",
  expires: "expiry date",
  alertMinutesBefore: "alert times",
  extraFields: "extra fields",
};

// Whole paths with a better name than their parts give.
const PATH_NAMES: Record<string, string> = {
  "transit.mode": "travel mode",
  "transit.number": "flight or train number",
  "transit.cabin": "travel class",
  "membership.since": "member since date",
};

const humanize = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/** A readable name for a field, like "seat number" or "attachment 2 link". */
export function fieldLabel(path: Path): string {
  const named = PATH_NAMES[path.map((segment) => (typeof segment === "number" ? "*" : segment)).join(".")];
  if (named) return named;
  const words: string[] = [];
  path.forEach((segment, i) => {
    if (typeof segment === "number") {
      words.push(String(segment + 1));
      return;
    }
    const names = i === path.length - 1 ? FIELD_NAMES : GROUP_NAMES;
    const name = segment in names ? names[segment] : humanize(segment);
    if (name) words.push(name);
  });
  return words.join(" ");
}

// What a field must look like, for fields with a pattern in the schema.
const FORMAT_HINTS: Record<string, string> = {
  start: "must look like 2026-11-14T19:30:00+09:00",
  end: "must look like 2026-11-14T22:00:00+09:00",
  boardingTime: "must look like 2026-12-03T09:45:00+09:00",
  expires: "must look like 2026-12-31, or a date and time like 2026-12-31T23:59:00+09:00",
  since: "must look like 2026-10-01",
  receivedAt: "must look like 2026-10-01 or 2026-10-01T09:12:00+09:00",
  backgroundColor: "must be a hex color like #2D1E4A",
  foregroundColor: "must be a hex color like #FFFFFF",
  labelColor: "must be a hex color like #CDBEF0",
  timeZone: "must be a time zone name like Asia/Tokyo or Europe/Paris",
  currency: "must be a three-letter currency code like JPY, USD or EUR",
  carrierCode: "must be the 2- or 3-character airline code in capitals, like NH",
  url: "must be a full https:// link with no spaces",
};

const TYPE_HINTS: Record<string, string> = {
  string: "must be text in double quotes",
  number: "must be a number without quotes or currency symbols, like 8800",
  integer: "must be a whole number",
  boolean: "must be true or false",
  array: "must be a list in square brackets [ ]",
  object: "must be a group of fields in curly braces { }",
};

const listOr = (values: unknown[]) => {
  const items = values.map(String);
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
};

/** Describes one problem with a field: everything after "{field} ". */
function predicate(error: ErrorObject, field: Path): string {
  const params = error.params as Record<string, unknown>;
  const last = field[field.length - 1];
  switch (error.keyword) {
    case "pattern":
      return (typeof last === "string" && FORMAT_HINTS[last]) || "isn't written in the expected format";
    case "type":
      return TYPE_HINTS[String(params.type)] ?? "has the wrong kind of value";
    case "enum":
      return `must be ${listOr(params.allowedValues as unknown[])}`;
    case "const":
      return `must be "${String(params.allowedValue)}"`;
    case "minLength":
    case "minProperties":
    case "minItems":
      return "can't be empty";
    case "maxLength":
      return `is too long. Use ${String(params.limit)} characters at most`;
    case "maxItems":
      return `has too many items. Use ${String(params.limit)} at most`;
    case "minimum":
      return `must be ${String(params.limit)} or more`;
    case "maximum":
      return `must be ${String(params.limit)} or less`;
    case "uniqueItems":
      return "has the same value twice";
    default:
      return "isn't valid";
  }
}

function describe(error: ErrorObject): ImportError {
  const path = parsePointer(error.instancePath);
  const params = error.params as Record<string, unknown>;
  const inPass = splitPassPath(path);
  const pass = inPass?.pass;
  const field = inPass ? inPass.field : path;
  const subject = pass === undefined ? "" : `Pass ${pass + 1}`;
  const withPass = (message: string): ImportError => (pass === undefined ? { message } : { message, pass });
  const sentence = (text: string) => withPass(subject ? `${subject}: ${text}.` : `${text[0].toUpperCase()}${text.slice(1)}.`);

  if (error.keyword === "required") {
    const missing = String(params.missingProperty);
    if (pass === undefined && field.length === 0) {
      return withPass(
        missing === "passes"
          ? 'The JSON needs a list of passes, like "passes": [ ... ]. Use the format from the AI prompt.'
          : `The JSON needs "${missing}".`,
      );
    }
    if (pass !== undefined && field.length === 0) {
      if (missing === "title") return withPass(`${subject} needs a title, for example the event name.`);
      if (missing === "type") return withPass(`${subject} needs a type: ${PASS_TYPES}.`);
      if (missing === "transit") {
        return withPass(`${subject} is a boarding pass, so it needs travel details (transit with mode, from and to).`);
      }
    }
    const full = [...field, missing];
    return withPass(`${subject || "The JSON"} is missing ${fieldLabel(full)} (${fieldPath(full)}).`);
  }

  if (error.keyword === "dependentRequired") {
    const property = [...field, String(params.property)];
    const missing = [...field, String(params.missingProperty)];
    return sentence(`${fieldLabel(property)} needs ${fieldLabel(missing)} too`);
  }

  if (field.length === 0) {
    if (pass === undefined && error.keyword === "type") {
      return withPass('The JSON must be a group of fields in curly braces, like { "schemaVersion": "1.0", "passes": [ ... ] }.');
    }
    if (pass !== undefined && error.keyword === "type") {
      return withPass(`${subject} must be a group of fields in curly braces { }, with at least a type and a title.`);
    }
  }

  if (pass === undefined && field.length === 1 && field[0] === "passes" && error.keyword === "maxItems") {
    return withPass(`An import can have ${String(params.limit)} passes at most. Split the JSON into smaller imports.`);
  }
  if (pass === undefined && field.length === 1 && field[0] === "schemaVersion") {
    return withPass(`"schemaVersion" must be "1.0", the only format version Passclip reads.`);
  }
  if (pass !== undefined && field.length === 1 && field[0] === "type" && error.keyword === "enum") {
    return withPass(`${subject}: type must be ${PASS_TYPES}.`);
  }
  if (error.keyword === "anyOf") {
    // The only anyOf in the schema: a stop needs at least one way to name it.
    return sentence(`${fieldLabel(field)} (${fieldPath(field)}) needs a code, name or city`);
  }
  if (error.keyword === "additionalProperties") {
    return sentence(`remove "${fieldPath([...field, String(params.additionalProperty)])}", which isn't a Passclip field`);
  }

  return sentence(`${fieldLabel(field)} ${predicate(error, field)}`);
}

/** Plain messages for Ajv errors, one per problem, with errors about the whole import first. */
export function describeErrors(errors: readonly ErrorObject[]): ImportError[] {
  // An anyOf error comes with one error per alternative it tried; the anyOf error says it all.
  const anyOfPaths = new Set(errors.filter((e) => e.keyword === "anyOf").map((e) => e.instancePath));
  const relevant = errors.filter(
    (e) => e.keyword !== "if" && !(e.schemaPath.includes("/anyOf/") && anyOfPaths.has(e.instancePath)),
  );

  const seen = new Set<string>();
  const messages: ImportError[] = [];
  for (const error of relevant) {
    const described = describe(error);
    if (seen.has(described.message)) continue;
    seen.add(described.message);
    messages.push(described);
  }
  // Stable sort: the whole import first, then by pass.
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => (a.message.pass ?? -1) - (b.message.pass ?? -1) || a.index - b.index)
    .map(({ message }) => message);
}
