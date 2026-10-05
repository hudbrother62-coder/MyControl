import { authorize, apiError } from "@/lib/server/session";
import { db } from "@/lib/server/database";
export async function GET(req: Request) {
  try {
    authorize(req);
    const [leads, incoming, outgoing] = await Promise.all([
      db("mc_lead_state?select=*&order=updated_at.desc&limit=300"),
      db(
        "mc_inbound_events?select=id,chat_id,phone,message_text,received_at&from_me=eq.false&is_group=eq.false&order=received_at.desc&limit=1000",
      ),
      db(
        "mc_outbound_jobs?select=id,chat_id,body,kind,status,created_at,sent_at&order=created_at.desc&limit=1000",
      ),
    ]);
    return Response.json(
      {
        leads: leads.map((l: any) => ({
          id: l.chat_id,
          name: l.display_name || l.phone || l.chat_id,
          phone: l.phone || "",
          product: l.product_id || "-",
          status:
            l.stage === "WON"
              ? "CLOSING"
              : ["HUMAN_HANDOFF", "DO_NOT_CONTACT"].includes(l.stage)
                ? "PENDING"
                : l.lead_status,
          value: Number(l.estimated_value || 0),
          note: l.notes || "WhatsApp lead",
          updatedAt: l.updated_at,
        })),
        conversations: leads.map((l: any) => ({
          id: l.chat_id,
          name: l.display_name || l.phone || l.chat_id,
          phone: l.phone || "",
          product: l.product_id || "-",
          aiEnabled: !(
            l.human_takeover_until === "infinity" ||
            (l.human_takeover_until &&
              new Date(l.human_takeover_until) > new Date())
          ),
          humanTakeover: Boolean(
            l.human_takeover_until === "infinity" ||
            (l.human_takeover_until &&
              new Date(l.human_takeover_until) > new Date()),
          ),
          updatedAt: l.updated_at,
        })),
        messages: [
          ...incoming.map((m: any) => ({
            id: m.id,
            conversationId: m.chat_id,
            direction: "IN",
            sender: "CUSTOMER",
            text: m.message_text,
            createdAt: m.received_at,
          })),
          ...outgoing.map((m: any) => ({
            id: m.id,
            conversationId: m.chat_id,
            direction: "OUT",
            sender: m.kind === "MANUAL" ? "OWNER" : "AI",
            text: m.body,
            createdAt: m.sent_at || m.created_at,
            status: m.status,
          })),
        ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
