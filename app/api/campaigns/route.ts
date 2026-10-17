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
    if(view==='exclusions')return Response.json({exclusions:await db('mc_contact_exclusions?select=phone,scope,reason,updated_at&order=updated_at.desc,phone&limit=50&offset='+offset)});
    if (view === "contacts" || view === "selection" || view === "selection_all") {
      const search = (q.get("q") || "").replace(/[%_*,().]/g, "").slice(0, 80);
      if(view==='selection')return Response.json(await rpc('mc_campaign_contact_selection',{p_search:search}));
      if(view==='selection_all')return Response.json(await rpc('mc_campaign_select_all_visible',{p_search:search}));
      return Response.json(await rpc('mc_contact_directory',{p_search:search,p_limit:50,p_offset:offset}));
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
      const stage=q.get('stage');if(stage&&!['NEW','INTERESTED','FOLLOW_UP','PENDING','AWAITING_PAYMENT','WON','LOST'].includes(stage))throw new Error('Tahap tidak valid');
      const rows=await db('mc_opportunities?select=id,chat_id,product_id,stage,note,next_followup_at,updated_at&order=updated_at.desc,id&limit=50&offset='+offset+(stage?'&stage=eq.'+stage:''));
      const phones=rows.map((o:any)=>o.chat_id.split('@')[0]).filter((p:string)=>/^[0-9]+$/.test(p));
      const leads=rows.length?await db('mc_lead_state?select=chat_id,display_name&chat_id=in.('+rows.map((o:any)=>encodeURIComponent(o.chat_id)).join(',')+')&limit=50'):[];
      const contacts=phones.length?await db('mc_campaign_contacts?select=phone,name&phone=in.('+phones.join(',')+')&limit=50'):[];
      return Response.json({opportunities:rows.map((o:any)=>({...o,display_name:leads.find((l:any)=>l.chat_id===o.chat_id)?.display_name||contacts.find((c:any)=>c.phone===o.chat_id.split('@')[0])?.name})),stages:(await rpc('mc_dashboard_summary')).crm_stages});
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
    if(b.action==='exclusion'){
      if(b.scope!==null&&!['PROMOTION','ALL_AUTOMATION'].includes(b.scope))throw new Error('Jenis pengecualian tidak valid');
      return Response.json(await rpc('mc_set_contact_exclusion',{p_phone:normalizePhone(b.phone),p_scope:b.scope,p_reason:String(b.reason||'').slice(0,500)}));
    }
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
      const campaign = b.campaign;
      if (!campaign || !Array.isArray(campaign.phones) || campaign.phones.length > 1000 ||
          !Array.isArray(campaign.import_contacts || []) || (campaign.import_contacts || []).length > 1000 ||
          !Array.isArray(campaign.excluded_phones || []) || (campaign.excluded_phones || []).length > 1000)
        throw new Error("Daftar penerima tidak valid (maksimal 1.000)");
      const phones = [...new Set(campaign.phones.map((v: unknown) => normalizePhone(String(v))))];
      const imported = (campaign.import_contacts || []).map((c: any) => ({
        phone: normalizePhone(c.phone), name: String(c.name || "").trim().slice(0, 100),
        tags: String(c.tags || "").slice(0, 500), consent: c.consent === true,
        consent_evidence: String(c.consent_evidence || "").slice(0, 500),
      }));
      if (imported.some((c: any) => !c.name || (c.consent && c.consent_evidence.trim().length < 12)))
        throw new Error("Kontak impor perlu nama dan bukti izin bila promosi diizinkan");
      const excluded = [...new Set((campaign.excluded_phones || []).map((v: unknown) => normalizePhone(String(v))))];
      return Response.json(
        await rpc("mc_save_campaign", {
          p_campaign: {name:campaign.name,product_id:campaign.product_id,
            steps:campaign.steps,bot_enabled:campaign.bot_enabled,phones,
            import_contacts:imported,excluded_phones:excluded},
        }),
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
          "PENDING",
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
