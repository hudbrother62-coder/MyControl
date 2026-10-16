import { authorize, apiError } from "@/lib/server/session";
import { db, rpc } from "@/lib/server/database";
import { normalizePhone, validateSteps } from "@/lib/campaigns";
const uuid = (id: unknown) => {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))
    throw new Error("ID tidak valid");
  return id;
};
export async function GET(req: Request) {
  try {
    authorize(req);
    const q = new URL(req.url).searchParams;
    const view = q.get("view");
    if (view === "contacts") {
      const offset = Math.max(
        0,
        Math.min(100000, Number(q.get("offset")) || 0),
      );
      const search = (q.get("q") || "").replace(/[%_*,().]/g, "").slice(0, 80);
      return Response.json({
        contacts: await db(
          "mc_campaign_contacts?select=*&order=created_at.desc&limit=1000&offset=" +
            offset +
            (search
              ? "&or=(name.ilike.*" +
                encodeURIComponent(search) +
                "*,phone.ilike.*" +
                encodeURIComponent(search) +
                "*,tags.ilike.*" +
                encodeURIComponent(search) +
                "*)"
              : ""),
        ),
      });
    }
    if (view === "detail") {
      const id = uuid(q.get("id"));
      const [campaign, recipients, jobs, audit] = await Promise.all([
        db("mc_campaigns?id=eq." + id),
        db(
          "mc_campaign_recipients?campaign_id=eq." +
            id +
            "&order=phone&limit=1000",
        ),
        Promise.all(
          [0, 1000].map((offset) =>
            db(
              "mc_outbound_jobs?select=id,recipient_id,chat_id,body,step_no,status,delivery_status,last_error,media_url&campaign_id=eq." +
                id +
                "&order=step_no,chat_id&limit=1000&offset=" +
                offset,
            ),
          ),
        ).then((x) => x.flat()),
        db(
          "mc_campaign_audit?campaign_id=eq." +
            id +
            "&order=created_at.desc&limit=30",
        ),
      ]);
      return Response.json({ campaign: campaign[0], recipients, jobs, audit });
    }
    if (view === "crm")
      return Response.json({
        opportunities: await db(
          "mc_opportunities?select=*&order=updated_at.desc&limit=1000",
        ),
      });
    const [campaigns, runtime, products] = await Promise.all([
      rpc("mc_campaign_overview"),
      db("mc_campaign_runtime?select=*"),
      db(
        "mc_runtime_knowledge?select=source_key,payload&kind=eq.PRODUCT&active=eq.true",
      ),
    ]);
    return Response.json({ campaigns, runtime, products });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(req: Request) {
  try {
    authorize(req, true);
    if (Number(req.headers.get("content-length")) > 2_000_000)
      return Response.json({ error: "Data terlalu besar" }, { status: 413 });
    const raw = await req.text();
    if (raw.length > 2_000_000)
      return Response.json({ error: "Data terlalu besar" }, { status: 413 });
    const b = JSON.parse(raw);
    if (b.action === "import") {
      if (!Array.isArray(b.contacts) || b.contacts.length > 1000)
        throw new Error("Maksimal 1000 kontak");
      const contacts = b.contacts.map((c: any) => ({
        phone: normalizePhone(c.phone),
        name: String(c.name || "").trim(),
        tags: String(c.tags || "").slice(0, 500),
        source: String(c.source || "").slice(0, 500),
        consent: c.consent === true,
      }));
      return Response.json(
        await rpc("mc_campaign_contact_import", { p_contacts: contacts }),
      );
    }
    if (b.action === "pause_all") {
      await rpc("mc_campaign_pause_all");
      return Response.json({ ok: true });
    }
    if (b.action === "test")
      return Response.json(
        await rpc("mc_campaign_test", {
          p_id: uuid(b.id),
          p_phone: normalizePhone(b.phone),
        }),
      );
    if (b.action === "create") {
      validateSteps(b.campaign?.steps);
      return Response.json(
        await rpc("mc_save_campaign", { p_campaign: b.campaign }),
      );
    }
    if (["START", "SCHEDULE", "PAUSE", "RESUME", "CANCEL"].includes(b.action))
      return Response.json(
        await rpc("mc_campaign_action", {
          p_id: uuid(b.id),
          p_action: b.action,
          p_schedule: b.schedule || null,
        }),
      );
    if (b.action === "optout") {
      const phone = normalizePhone(b.phone);
      await rpc("mc_campaign_optout", { p_phone: phone });
      return Response.json({ ok: true });
    }
    if (b.action === "opportunity") {
      if (
        ![
          "NEW",
          "INTERESTED",
          "FOLLOW_UP",
          "AWAITING_PAYMENT",
          "WON",
          "LOST",
        ].includes(b.stage)
      )
        throw new Error("Tahap tidak valid");
      await rpc("mc_campaign_opportunity_update", {
        p_id: uuid(b.id),
        p_stage: b.stage,
        p_note: String(b.note || "").slice(0, 4000),
        p_due: b.next_followup_at || null,
      });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Tindakan tidak tersedia" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
