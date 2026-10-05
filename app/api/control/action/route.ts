import { authorize, apiError } from "@/lib/server/session";
import { chatId, rpc, db } from "@/lib/server/database";
export async function POST(req: Request) {
  try {
    authorize(req, true);
    const b = await req.json();
    if (b.action === "contact") {
      let phone = String(b.phone || "").replace(/[ +()-]/g, "");
      if (phone.startsWith("0")) phone = "62" + phone.slice(1);
      if (!/^[1-9][0-9]{7,14}$/.test(phone))
        throw new Error("Nomor WhatsApp tidak valid");
      const name = String(b.name || "")
        .trim()
        .slice(0, 100);
      if (!name) throw new Error("Nama wajib diisi");
      await db("mc_lead_state?on_conflict=chat_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          chat_id: phone + "@c.us",
          phone,
          display_name: name,
          product_id: b.productId || null,
        }),
      });
      return Response.json({ ok: true, conversationId: phone + "@c.us" });
    }
    const chat = await chatId(String(b.conversationId || ""));
    if (b.action === "lead") {
      const statuses = [
        "NEW",
        "CONTACTED",
        "INTERESTED",
        "FOLLOW_UP",
        "PENDING",
        "STALE",
        "CHECKOUT",
        "AWAITING_PAYMENT",
        "PAYMENT_SUBMITTED",
        "PAYMENT_MATCHED",
        "WAITING_OWNER_APPROVAL",
        "VERIFIED",
        "CLOSING",
        "FULFILLED",
        "LOST",
      ];
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (b.status !== undefined) {
        if (!statuses.includes(b.status)) throw new Error("Status tidak valid");
        patch.lead_status = b.status;
        patch.stage = ["CLOSING", "FULFILLED"].includes(b.status)
          ? "WON"
          : b.status;
      }
      if (b.value !== undefined) {
        if (!Number.isFinite(b.value) || b.value < 0)
          throw new Error("Nilai tidak valid");
        patch.estimated_value = b.value;
      }
      if (b.note !== undefined) patch.notes = String(b.note).slice(0, 4000);
      if (b.status === "LOST")
        await rpc("mc_control_takeover", { p_chat_id: chat, p_enabled: true });
      await db("mc_lead_state?chat_id=eq." + encodeURIComponent(chat), {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return Response.json({ ok: true });
    }
    if (b.action === "send") {
      const text = String(b.text || "").trim();
      if (!text || text.length > 4000)
        throw new Error("Pesan harus berisi 1–4000 karakter");
      if (
        typeof b.requestId !== "string" ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(b.requestId)
      )
        throw new Error("Request ID tidak valid");
      return Response.json(
        await rpc("mc_manual_send", {
          p_chat_id: chat,
          p_body: text,
          p_request_id: b.requestId,
        }),
      );
    }
    if (b.action === "takeover") {
      return Response.json(
        await rpc("mc_control_takeover", {
          p_chat_id: chat,
          p_enabled: Boolean(b.enabled),
        }),
      );
    }
    return Response.json({ error: "Action tidak diizinkan" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
