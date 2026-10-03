import { createHash } from "node:crypto";
import { buildIcs, calendarEventFor } from "@/lib/calendar/ics";
import type { NormalizedPass } from "@/lib/import/normalize";
import { fileSlug } from "@/lib/server/filename";
import { allowRequest, apiError, readImportRequest, RequestProblem } from "@/lib/server/import-request";

// Add to calendar (docs/SPEC.md §8): reached by a real form navigation, like Wallet passes,
// and needs no signing. Nothing is stored or logged.
export const runtime = "nodejs";

/**
 * The same pass always gets the same event ID, so adding it again updates the event instead of
 * duplicating it. A hash, so the ID doesn't spell out ticket details.
 */
function eventId(pass: NormalizedPass, host: string) {
  const identity = [pass.type, pass.title, pass.start, pass.ticketNumber ?? pass.confirmationCode ?? pass.holderName ?? ""].join("\n");
  return `${createHash("sha256").update(identity).digest("hex").slice(0, 32)}@${host}`;
}

function host(request: Request) {
  try {
    if (process.env.PUBLIC_BASE_URL) return new URL(process.env.PUBLIC_BASE_URL).hostname;
  } catch {
    // An invalid optional setting falls back to the request's own host.
  }
  return new URL(request.url).hostname;
}

export async function POST(request: Request) {
  try {
    if (!allowRequest(request)) throw new RequestProblem("Too many requests. Wait a minute and try again.", 429);
    const { result, index } = await readImportRequest(request);
    if (!result.ok) return Response.json({ errors: result.errors }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const pass = result.value.passes[index];
    if (!pass) throw new RequestProblem("Choose a pass from your import.");
    const event = calendarEventFor(pass);
    if (!event) throw new RequestProblem("This pass has no start time to add to a calendar.");
    const body = buildIcs(event, { uid: eventId(pass, host(request)), now: new Date() });
    return new Response(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileSlug(pass.title)}.ics"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
