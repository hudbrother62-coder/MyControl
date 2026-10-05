import { authorize, apiError } from "@/lib/server/session";
import { health } from "@/lib/server/health";
export async function GET(req: Request) {
  try {
    authorize(req);
    return Response.json(await health(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
