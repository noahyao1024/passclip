import { DELETE_PAGE, isDeleteToken, isSafeFileName } from "@/lib/attachments/rules";
import { deleteUrlFor } from "@/lib/attachments/storage";
import { readStorageConfig } from "@/lib/storage/config";
import { allowRequest, apiError, readLimitedText, RequestProblem, requireSameSite } from "@/lib/server/import-request";

export const runtime = "nodejs";

// Deletes an uploaded file. Reached by the form on the delete page, so the browser shows the
// result. The token and file name are never logged.
export async function POST(request: Request) {
  try {
    if (!allowRequest(request)) throw new RequestProblem("Too many requests. Wait a minute and try again.", 429);
    requireSameSite(request, "Open your delete link to delete a file.");
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") {
      throw new RequestProblem("Open your delete link to delete a file.", 415);
    }
    const storage = readStorageConfig(process.env);
    if (!storage.ok) throw new RequestProblem("File uploads aren't set up on this site, so there's no file to delete.", 503);

    const form = new URLSearchParams(await readLimitedText(request, 1024, "This delete link is too long. Copy the whole link and open it again."));
    const token = form.get("token") ?? "";
    const fileName = form.get("file") ?? "";
    if (!isDeleteToken(token) || !isSafeFileName(fileName)) {
      throw new RequestProblem("This delete link is incomplete. Copy the whole link and open it again.");
    }

    let response: Response;
    try {
      response = await fetch(deleteUrlFor(storage.config, token, fileName), { method: "DELETE", signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new RequestProblem("Couldn't reach file storage. Try again in a moment.", 502);
    }
    // Storage answers 204 even when the file was already gone, so deleting twice is fine.
    if (!response.ok) throw new RequestProblem("Couldn't delete the file. Try again in a moment.", 502);
    return new Response(null, { status: 303, headers: { Location: `${DELETE_PAGE}?deleted=1`, "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, request, "Couldn't delete the file. Try again in a moment.");
  }
}
