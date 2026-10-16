import { authorize, apiError } from "@/lib/server/session";
import { db } from "@/lib/server/database";
import { health } from "@/lib/server/health";
export async function GET(req: Request) {
  try {
    authorize(req);
    const light=new URL(req.url).searchParams.has("light");
    const result=light?await db("mc_campaign_runtime?select=last_seen&limit=1").then((rows:any[])=>({DATABASE:{connected:true},WAHA:{connected:Boolean(rows[0]?.last_seen&&Date.now()-Date.parse(rows[0].last_seen)<90000)}})):await health();
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
