import { authorize, apiError } from "@/lib/server/session";
import { db, rpc } from "@/lib/server/database";
export async function GET(req: Request) {
  try {
    authorize(req);
    const q=new URL(req.url).searchParams;
    const offset=Math.max(0,Math.min(100000,Number(q.get('offset'))||0));
    const chat=q.get('chat');
    if(chat){
      if(!/^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$/.test(chat)&&!/^[a-f0-9-]{36}$/i.test(chat))throw new Error('Percakapan tidak valid');
      if(q.has('meta')){
        if(chat.includes('@')){
          const rows=await db('mc_lead_state?select=*&chat_id=eq.'+encodeURIComponent(chat)+'&limit=1');
          const l=rows[0];if(!l)return Response.json({error:'Percakapan tidak ditemukan'},{status:404});
          const takeover=l.human_takeover_until==='infinity'||Boolean(l.human_takeover_until&&Date.parse(l.human_takeover_until)>Date.now());
          return Response.json({conversation:{id:chat,name:l.display_name||l.phone||chat,phone:l.phone||chat.split('@')[0],product:l.product_id||'-',aiEnabled:!takeover,humanTakeover:takeover,updatedAt:l.updated_at}});
        }
        const rows=await db('conversations?select=id,ai_enabled,human_takeover,updated_at,customer:customers(name,whatsapp_number),product:products(name)&id=eq.'+chat+'&limit=1');
        const c=rows[0];if(!c)return Response.json({error:'Percakapan tidak ditemukan'},{status:404});return Response.json({conversation:{id:c.id,name:c.customer?.name||'-',phone:c.customer?.whatsapp_number||'',product:c.product?.name||'-',aiEnabled:c.ai_enabled,humanTakeover:c.human_takeover,updatedAt:c.updated_at}});
      }
      const before=q.get('before'),beforeId=q.get('beforeId');
      if(before&&(!Number.isFinite(Date.parse(before))||!beforeId||!/^[a-f0-9-]{36}$/i.test(beforeId)))throw new Error('Cursor tidak valid');
      if(chat.includes('@'))return Response.json(await rpc('mc_chat_page',{p_chat:chat,p_before:before||null,p_before_id:beforeId||null}));
      const cursor=before?'&or=(created_at.lt.'+encodeURIComponent(before)+',and(created_at.eq.'+encodeURIComponent(before)+',id.lt.'+beforeId+'))':'';
      const rows=await db('messages?select=id,conversation_id,direction,sender_type,content,created_at&conversation_id=eq.'+chat+'&order=created_at.desc,id.desc&limit=51'+cursor);
      return Response.json({messages:rows.slice(0,50).reverse().map((m:any)=>({id:m.id,conversationId:m.conversation_id,direction:m.direction,sender:m.sender_type,text:m.content||'',createdAt:m.created_at})),hasMore:rows.length>50});
    }

    const [leads, incoming, outgoing] = await Promise.all([
      db("mc_lead_state?select=*&order=updated_at.desc,chat_id&limit=50&offset="+offset),
      Promise.resolve([]),
      Promise.resolve([]),
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
