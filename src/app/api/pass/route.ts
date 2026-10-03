import { buildPass, requireSigning } from "@/lib/pass/build";
import { fileSlug } from "@/lib/server/filename";
import { allowRequest, apiError, readImportRequest, RequestProblem } from "@/lib/server/import-request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (!allowRequest(request)) throw new RequestProblem("Too many pass requests. Wait a minute and try again.", 429);
    const { result, index } = await readImportRequest(request);
    if (!result.ok) return Response.json({ errors: result.errors }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const pass = result.value.passes[index];
    if (!pass) throw new RequestProblem("Choose a pass from your import.");
    let config;
    try { config = requireSigning(process.env); } catch { throw new RequestProblem("Pass signing isn't set up yet.", 503); }
    const buffer = await buildPass(pass, config, { source: result.value.source, publicBaseUrl: process.env.PUBLIC_BASE_URL });
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.apple.pkpass", "Content-Disposition": `attachment; filename="${fileSlug(pass.title)}.pkpass"`, "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
