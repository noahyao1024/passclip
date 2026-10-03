// A real navigation to a calendar file, like Wallet passes (CLAUDE.md rule 6). It needs no
// signing, so it works in preview-only mode too.
export function AddToCalendar({ importText, fallbackTimeZone }: { importText: string; fallbackTimeZone: string }) {
  return (
    <form method="post" action="/api/ics" target="_self">
      <input type="hidden" name="import" value={importText} />
      <input type="hidden" name="fallbackTimeZone" value={fallbackTimeZone} />
      <button className="button button-secondary" type="submit">Add to calendar</button>
    </form>
  );
}
