import { authorize, apiError } from "@/lib/server/session";
import { db, rpc, chatId } from "@/lib/server/database";

const noStore = { "Cache-Control": "no-store" };
export async function GET(req: Request) {
  try {
    authorize(req);
    const q = new URL(req.url).searchParams;
    const requested = q.get("chat");
    if (requested) {
      if (!/^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$/.test(requested) &&
          !/^[a-f0-9-]{36}$/i.test(requested)) throw new Error("Percakapan tidak valid");
      const chat = await chatId(requested);
      const account = await rpc("mc_active_account");
      if (!account) return Response.json({ error: "Nomor bot belum dikonfigurasi" }, { status: 503, headers: noStore });
      const rows = await db("mc_lead_state?select=*&chat_id=eq." + encodeURIComponent(chat) +
        "&account_id=eq." + encodeURIComponent(account) + "&limit=1");
      const lead = rows[0];
      if (!lead) return Response.json({ error: "Percakapan tidak tersedia untuk nomor bot aktif" }, { status: 404, headers: noStore });
      if (q.has("meta")) return Response.json({ conversation: conversation(lead), account }, { headers: noStore });
      const before = q.get("before"), beforeId = q.get("beforeId");
      if (before && (!Number.isFinite(Date.parse(before)) || !beforeId || !/^[a-f0-9-]{36}$/i.test(beforeId)))
        throw new Error("Cursor tidak valid");
      return Response.json(await rpc("mc_chat_page", { p_chat: chat, p_before: before || null, p_before_id: beforeId || null }), { headers: noStore });
    }
    const offset = Math.max(0, Math.min(100000, Number(q.get("offset")) || 0));
    // The database scopes before LIMIT/OFFSET; old accounts cannot consume this page.
    const [leads, account] = await Promise.all([
      rpc("mc_account_inbox", { p_offset: offset }), rpc("mc_active_account"),
    ]);
    return Response.json({
      account,
      leads: leads.map((l: any) => ({
        id: l.chat_id, name: l.display_name || l.phone || l.chat_id, phone: l.phone || "",
        product: l.product_id || "-", status: l.stage === "WON" ? "CLOSING" :
          ["HUMAN_HANDOFF", "DO_NOT_CONTACT"].includes(l.stage) ? "PENDING" : l.lead_status,
        value: Number(l.estimated_value || 0), note: l.notes || "WhatsApp lead", updatedAt: l.updated_at,
      })),
      conversations: leads.map(conversation), messages: [],
    }, { headers: noStore });
  } catch (e) { return apiError(e); }
}
function conversation(l: any) {
  const takeover = l.human_takeover_until === "infinity" ||
    Boolean(l.human_takeover_until && Date.parse(l.human_takeover_until) > Date.now());
  return { id: l.chat_id, name: l.display_name || l.phone || l.chat_id, phone: l.phone || l.chat_id.split("@")[0],
    product: l.product_id || "-", aiEnabled: !takeover, humanTakeover: takeover, updatedAt: l.updated_at };
}
