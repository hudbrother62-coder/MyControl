import { authorize, apiError } from "@/lib/server/session";
import { chatId, rpc, db } from "@/lib/server/database";
export async function GET(req: Request) {
  try {
    authorize(req);
    const chat = await chatId(new URL(req.url).searchParams.get("chat") || "");
    const [data, products] = await Promise.all([
      rpc("mc_contact_control_snapshot", { p_chat_id: chat }),
      db("products?select=id,name,status&status=eq.ACTIVE&order=name&limit=150"),
    ]);
    return Response.json({ ...data, products }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return apiError(e); }
}
