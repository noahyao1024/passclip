/** A location in the import JSON, like ["passes", 0, "seat", "row"]. */
export type Path = (string | number)[];

/** Turns a JSON pointer like "/passes/0/seat" (as Ajv reports it) into a path. */
export function parsePointer(pointer: string): Path {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/** The field as written in the JSON, like "attachments[1].url". */
export function fieldPath(path: Path): string {
  return path.reduce<string>(
    (text, segment) => (typeof segment === "number" ? `${text}[${segment}]` : text ? `${text}.${segment}` : segment),
    "",
  );
}

/** Splits a path inside a pass into the pass index and the path within the pass. */
export function splitPassPath(path: Path): { pass: number; field: Path } | undefined {
  return path[0] === "passes" && typeof path[1] === "number" ? { pass: path[1], field: path.slice(2) } : undefined;
}
