import { authorize, apiError } from "@/lib/server/session";
import { db } from "@/lib/server/database";
export async function GET(req: Request) {
  try {
    authorize(req);
    await db("products?select=id&limit=1");
    return Response.json({
      publicConnected: true,
      projectRef: new URL(
        process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      ).hostname.split(".")[0],
    });
  } catch (e) {
    return apiError(e);
  }
}
