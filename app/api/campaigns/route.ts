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
    const offset=Math.max(0,Math.min(100000,Number(q.get("offset"))||0));
    if (view === "contacts" || view === "selection") {
      const search = (q.get("q") || "").replace(/[%_*,().]/g, "").slice(0, 80);
      const rows=await db(
          "mc_campaign_contacts?select="+(view==='selection'?'phone':'phone,name,tags,consent,opted_out_at,created_at')+"&order=created_at.desc,phone&limit="+(view==='selection'?1000:50)+"&offset=" +
            (view==='selection'?0:offset) + (view==='selection'?'&consent=eq.true&opted_out_at=is.null':'')+
            (search
              ? "&or=(name.ilike.*" +
                encodeURIComponent(search) +
                "*,phone.ilike.*" +
                encodeURIComponent(search) +
                "*,tags.ilike.*" +
                encodeURIComponent(search) +
                "*)"
              : ""),
        );
      return Response.json(view==='selection'?{phones:rows.map((c:any)=>c.phone)}:{contacts:rows});
    }
    if (view === "detail") {
      const id = uuid(q.get("id"));
      const [campaign, recipients, audit]=await Promise.all([
        db('mc_campaigns?id=eq.'+id),
        db('mc_campaign_recipients?campaign_id=eq.'+id+'&order=phone&limit=50&offset='+offset),
        db('mc_campaign_audit?campaign_id=eq.'+id+'&order=created_at.desc&limit=20')
      ]);
      const jobs=recipients.length?await db('mc_outbound_jobs?select=id,recipient_id,step_no,status,delivery_status,last_error&recipient_id=in.('+recipients.map((r:any)=>r.id).join(',')+')&order=step_no&limit=100'):[];
      return Response.json({ campaign: campaign[0], recipients, jobs, audit });
    }
    if (view === "crm"){
      const stage=q.get('stage');if(stage&&!['NEW','INTERESTED','FOLLOW_UP','AWAITING_PAYMENT','WON','LOST'].includes(stage))throw new Error('Tahap tidak valid');
      const rows=await db('mc_opportunities?select=id,chat_id,product_id,stage,note,next_followup_at,updated_at&order=updated_at.desc,id&limit=50&offset='+offset+(stage?'&stage=eq.'+stage:''));
      const phones=rows.map((o:any)=>o.chat_id.split('@')[0]).filter((p:string)=>/^[0-9]+$/.test(p));
      const contacts=phones.length?await db('mc_campaign_contacts?select=phone,name&phone=in.('+phones.join(',')+')&limit=50'):[];
      return Response.json({opportunities:rows.map((o:any)=>({...o,display_name:contacts.find((c:any)=>c.phone===o.chat_id.split('@')[0])?.name})),stages:(await rpc('mc_dashboard_summary')).crm_stages});
    }
    const [campaigns, runtime, products] = await Promise.all([
      rpc("mc_campaign_list",{p_offset:offset}),
      db("mc_campaign_runtime?select=*"),
      db(
        "mc_runtime_knowledge?select=source_key,payload:payload->product_name&kind=eq.PRODUCT&active=eq.true&limit=200",
      ),
    ]);
    return Response.json({ campaigns, runtime, products:products.map((p:any)=>({...p,payload:{product_name:p.payload}})) });
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
