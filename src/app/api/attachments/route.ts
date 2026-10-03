import type { FileFacts } from "@/lib/attachments/rules";
import { planUpload } from "@/lib/attachments/storage";
import { readStorageConfig } from "@/lib/storage/config";
import { allowRequest, apiError, readLimitedText, RequestProblem, requireSameSite } from "@/lib/server/import-request";

export const runtime = "nodejs";

// Signs a one-file upload link (docs/SPEC.md §9). The file itself never passes through here:
// the browser sends it straight to the bucket. Only the name, type and size arrive, and they're
// never logged.
export async function POST(request: Request) {
  try {
    if (!allowRequest(request)) throw new RequestProblem("Too many uploads. Wait a minute and try again.", 429);
    requireSameSite(request, "Open Passclip to attach a file.");
    const storage = readStorageConfig(process.env);
    if (!storage.ok) throw new RequestProblem("File uploads aren't set up yet.", 503);

    const facts = readFacts(await readLimitedText(request, 2048, "Send only the file's name, type and size."));
    const result = planUpload(storage.config, facts);
    if (!result.ok) throw new RequestProblem(result.message);
    return Response.json(result.plan, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, request, "Couldn't start the upload. Try again in a moment.");
  }
}

function readFacts(body: string): FileFacts {
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { throw new RequestProblem("Send the file's name, type and size as JSON."); }
  const { name, type, size } = (payload ?? {}) as Partial<Record<keyof FileFacts, unknown>>;
  if (typeof name !== "string" || typeof type !== "string" || typeof size !== "number" || name.length > 255 || type.length > 100) {
    throw new RequestProblem("Send the file's name, type and size as JSON.");
  }
  return { name, type, size };
}
