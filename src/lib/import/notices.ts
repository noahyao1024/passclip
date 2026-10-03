/** Something Passclip fixed, or wants the user to check, before they add the pass. */
export interface Warning {
  message: string;
  /** Index of the pass it's about (0-based). Missing when it's about the whole import. */
  pass?: number;
  /** "fix": Passclip already fixed it, so it's for information. Otherwise the user should check it. */
  kind?: "fix";
  /** "ai" when the AI that wrote the JSON listed it in its own warnings. */
  from?: "ai";
}

/** A problem that stops Passclip from making passes until the JSON is fixed. */
export interface ImportError {
  message: string;
  /** Index of the pass it's about (0-based), when there is one. */
  pass?: number;
  /** For JSON syntax errors: where the problem is in the pasted text. */
  location?: TextLocation;
}

export interface TextLocation {
  /** Offset in the pasted text, in UTF-16 code units (what textarea selection uses). */
  offset: number;
  /** 1-based line and column. */
  line: number;
  column: number;
  /** The line with the problem, shortened around the problem if it's long. */
  snippet: string;
  /** 1-based column of the problem within `snippet`. */
  snippetColumn: number;
}
