import { authorize, apiError } from "@/lib/server/session";
import { health } from "@/lib/server/health";
export async function GET(req: Request) {
  try {
    authorize(req);
    const light=new URL(req.url).searchParams.has("light");
    const result=await health(light?["DATABASE","WAHA"]:undefined);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
