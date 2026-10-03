import { layoutPass } from "@/lib/pass/fields";
import { signingAvailable } from "@/lib/pass/build";
import { allowRequest, apiError, readImportRequest, RequestProblem } from "@/lib/server/import-request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (!allowRequest(request)) throw new RequestProblem("Too many import requests. Wait a minute and try again.", 429);
    const { result } = await readImportRequest(request);
    if (!result.ok) return Response.json(result, { status: 400, headers: { "Cache-Control": "no-store" } });
    return Response.json({ ...result, signingAvailable: signingAvailable(process.env), layouts: result.value.passes.map((pass) => layoutPass(pass, { source: result.value.source, publicBaseUrl: process.env.PUBLIC_BASE_URL })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
