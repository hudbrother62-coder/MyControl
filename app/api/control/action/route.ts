import { authorize, apiError } from "@/lib/server/session";
import { activeChatId, rpc, db } from "@/lib/server/database";
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
    const chat = await activeChatId(String(b.conversationId || ""));
    if (b.action === "contact_mode") {
      if (!["AI", "HYBRID", "MANUAL"].includes(b.mode))
        throw new Error("Mode tidak valid");
      return Response.json(await rpc("mc_set_contact_mode", {
        p_chat_id: chat, p_mode: b.mode,
      }));
    }
    if (b.action === "sales_profile") {
      if (!["CONSULTATIVE","CONCISE","PERSUASIVE"].includes(b.responseStyle) ||
          !["PROSPECT","BUYER","ACTIVE","DUE_SOON","OVERDUE","CHURNED"].includes(b.lifecycle) ||
          !Number.isInteger(b.maxFollowups) || b.maxFollowups < 0 || b.maxFollowups > 3 ||
          typeof b.customInstruction !== "string" || b.customInstruction.length > 1500 ||
          typeof b.customerProfile !== "string" || b.customerProfile.length > 2000)
        throw new Error("Profil tidak valid");
      return Response.json(await rpc("mc_set_contact_sales_profile", {
        p_chat_id: chat, p_style: b.responseStyle, p_instruction: b.customInstruction,
        p_profile: b.customerProfile, p_lifecycle: b.lifecycle, p_max_followups: b.maxFollowups,
      }));
    }
    if (b.action === "reply_policy") {
      if (typeof b.enabled !== "boolean" ||
          typeof b.start !== "string" || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(b.start) ||
          typeof b.end !== "string" || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(b.end) ||
          !Number.isInteger(b.cooldown) || b.cooldown < 0 || b.cooldown > 120 ||
          !Number.isInteger(b.maxChars) || b.maxChars < 80 || b.maxChars > 1200)
        throw new Error("Jam respons atau cooldown tidak valid");
      return Response.json(await rpc("mc_set_contact_reply_policy", {
        p_chat_id: chat, p_enabled: b.enabled, p_start: b.start, p_end: b.end,
        p_cooldown: b.cooldown, p_max_chars: b.maxChars,
      }));
    }
    if (b.action === "promo_consent") {
      if (typeof b.allowed !== "boolean" || typeof b.evidence !== "string" || b.evidence.length > 500)
        throw new Error("Izin promosi tidak valid");
      return Response.json(await rpc("mc_record_contact_promo_consent", {
        p_chat_id: chat, p_allowed: b.allowed, p_evidence: b.evidence,
      }));
    }
    if (b.action === "review_draft") {
      if (typeof b.draftId !== "string" || !/^[a-f0-9-]{36}$/i.test(b.draftId) ||
          typeof b.approve !== "boolean") throw new Error("Draft tidak valid");
      return Response.json(await rpc("mc_review_contact_draft", {
        p_draft_id: b.draftId, p_approve: b.approve,
      }));
    }
    if (b.action === "subscription_save") {
      if (b.id != null && (typeof b.id !== "string" || !/^[a-f0-9-]{36}$/i.test(b.id)))
        throw new Error("ID langganan tidak valid");
      if (typeof b.planName !== "string" || b.planName.length > 100 ||
          typeof b.productId !== "string" || !/^[A-Za-z0-9_-]{2,80}$/.test(b.productId) ||
          typeof b.dueAt !== "string" || !Number.isFinite(Date.parse(b.dueAt)) ||
          !Number.isFinite(b.amount) || b.amount <= 0 ||
          !Number.isInteger(b.graceDays) || b.graceDays < 0 || b.graceDays > 30 ||
          typeof b.reminderEnabled !== "boolean" || typeof b.serviceOptIn !== "boolean" ||
          typeof b.evidence !== "string" || b.evidence.length > 500)
        throw new Error("Langganan tidak valid");
      return Response.json(await rpc("mc_upsert_subscription", {
        p_id: b.id || null, p_chat_id: chat, p_product_id: b.productId, p_plan_name: b.planName,
        p_amount: b.amount, p_due_at: b.dueAt, p_reminder_enabled: b.reminderEnabled,
        p_service_opt_in: b.serviceOptIn, p_evidence: b.evidence, p_grace_days: b.graceDays,
      }));
    }
    if (b.action === "subscription_payment") {
      if (typeof b.id !== "string" || !/^[a-f0-9-]{36}$/i.test(b.id) ||
          !Number.isFinite(b.amount) || b.amount <= 0 ||
          typeof b.paidAt !== "string" || !Number.isFinite(Date.parse(b.paidAt)) ||
          typeof b.reference !== "string" || b.reference.length > 500)
        throw new Error("Pembayaran tidak valid");
      return Response.json(await rpc("mc_confirm_subscription_payment", {
        p_id: b.id, p_amount: b.amount, p_paid_at: b.paidAt, p_reference: b.reference,
      }));
    }
    if (b.action === "subscription_cancel") {
      if (typeof b.id !== "string" || !/^[a-f0-9-]{36}$/i.test(b.id))
        throw new Error("ID langganan tidak valid");
      return Response.json(await rpc("mc_cancel_subscription", { p_id: b.id }));
    }
    if (b.action === "contact_pause") {
      if (!Number.isInteger(b.minutes) || !(b.minutes === -1 || b.minutes === 0 || (b.minutes >= 5 && b.minutes <= 10080)))
        throw new Error("Durasi jeda tidak valid");
      return Response.json(await rpc("mc_set_contact_bot_pause", {
        p_chat_id: chat,
        p_minutes: b.minutes,
      }));
    }
    if (b.action === "contact_preferences") {
      const args: Record<string, unknown> = { p_chat_id: chat };
      if (Object.hasOwn(b, "followupEnabled")) {
        if (typeof b.followupEnabled !== "boolean") throw new Error("Follow-up tidak valid");
        args.p_followup_enabled = b.followupEnabled;
      }
      if (Object.hasOwn(b, "priority")) {
        if (!["NORMAL", "IMPORTANT"].includes(b.priority)) throw new Error("Prioritas tidak valid");
        args.p_priority = b.priority;
      }
      if (Object.hasOwn(b, "note")) {
        if (typeof b.note !== "string" || b.note.length > 2000)
          throw new Error("Catatan maksimal 2000 karakter");
        args.p_note = b.note.trim();
      }
      if (Object.keys(args).length === 1) throw new Error("Tidak ada perubahan");
      return Response.json(await rpc("mc_set_contact_preferences", args));
    }
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
