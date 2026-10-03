/** A safe download name from a pass title, like "Jazz-Night". */
export function fileSlug(title: string): string {
  return title.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "passclip";
}
