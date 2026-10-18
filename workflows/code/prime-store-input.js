const job = $('Claim AI Job').first().json;
const ctx = $json ?? {}, lead = ctx.lead_state ?? {};
const arr = value => Array.isArray(value) ? value : [];
const cut = (value, length = 600) => typeof value === 'string' ? value.slice(0, length) : value ?? null;
const same = (a,b) => a === b || (/@(c\.us|s\.whatsapp\.net)$/.test(a||'') && /@(c\.us|s\.whatsapp\.net)$/.test(b||'') && a.split('@')[0] === b.split('@')[0]);
for (const scope of [lead, ctx.memory, lead.PRIME_STORE_MEMORY]) {
 if (scope?.chat_id && !same(scope.chat_id,job.chat_id)) throw new Error('CONTACT_MEMORY_SCOPE_MISMATCH');
}
const message = String(job.message_text || '').slice(0,4000);
const official = arr(ctx.knowledge), catalog = official.filter(k => k.kind === 'PRODUCT');
const focus = lead.CS_PRODUCT_FOCUS ?? null;
const explicit = catalog.filter(k => [k.payload?.product_name,...arr(k.payload?.aliases)].filter(Boolean).some(name => message.toLowerCase().includes(name.toLowerCase())));
const selectedIds = new Set(explicit.length ? explicit.map(k => k.source_key) : [focus?.product_id].filter(Boolean));
const selected = catalog.filter(k => selectedIds.has(k.source_key));
const products = (selected.length ? selected : catalog).slice(0,6).map(k => ({
 product_id:k.source_key, name:k.payload?.product_name, price:k.payload?.price,
 promo_price:k.payload?.promo_price, promo_status:k.payload?.promo_status,
 description:cut(k.payload?.full_description || k.payload?.description,2200),
 delivery:k.payload?.delivery
}));
const faqNumbers = new Set([12,22,25,27,62,63]);
const issues = [
 [35,/unduh|download/i], [36,/instal|pasang/i], [37,/protect|peringatan|aman|keamanan/i],
 [38,/samsung|blocker|one ui/i], [39,/app not installed|tidak terpasang/i],
 [40,/parse|parsing/i], [41,/ikon|launcher|menu tv/i], [42,/stb|box/i],
 [43,/laptop|pc|emulator/i], [44,/loading/i], [45,/channel|hitam|guide tv/i],
 [46,/pertandingan|jadwal|olahraga/i], [47,/film|drakor|hitv|subtitle/i],
 [48,/kasir|printer|struk|kembalian/i], [49,/dunokids|layar anak/i],
 [51,/garansi|refund/i], [52,/trial|coba gratis/i], [54,/iphone|ipad|ios/i],
 [56,/link|akses|tunggu|2 jam/i], [57,/kecewa|marah|komplain/i]
];
const subject = message + ' ' + selected.map(k => k.payload?.product_name || '').join(' ');
for (const [number, pattern] of issues) if(pattern.test(subject))faqNumbers.add(number);
const faqs = official.filter(k => k.kind === 'FAQ' && /^PRIME_STORE_/.test(k.source_key) && faqNumbers.has(Number(k.source_key.split('_').pop()))).map(k => ({question:k.payload?.question,answer:cut(k.payload?.answer,2000)}));
const history = arr(ctx.history).filter(h => !h.chat_id || same(h.chat_id,job.chat_id)).slice(-12).map(h => ({role:h.role,content:cut(h.content),ts:h.ts}));
const memory = lead.PRIME_STORE_MEMORY ?? {};
const input = {
 mode:'INBOUND_SALES',chat_id:job.chat_id,current_customer_message:message,
 'PRIME STORE TRANSACTION':ctx.prime_store ?? {payment_verified:false},
 promotional_opt_out:Boolean(ctx.promotional_opt_out),
 lead:{stage:lead.stage,product_id:lead.product_id,lead_status:lead.lead_status,CS_PRODUCT_FOCUS:focus,
 CS_LAST_CUSTOMER_MESSAGE:cut(lead.CS_LAST_CUSTOMER_MESSAGE),CS_CUSTOMER_INTENT_HINT:lead.CS_CUSTOMER_INTENT_HINT,
 OWNER_REPLY_POLICY:lead.OWNER_REPLY_POLICY,OWNER_CONTACT_AI_GUIDANCE:lead.OWNER_CONTACT_AI_GUIDANCE},
 customer_memory:{summary:cut(ctx.memory?.summary,2500),rule:memory.continuity_rule,
 customer_excerpts:arr(memory.recent_customer_excerpts).slice(-16).map(e => ({event_id:e.event_id,at:e.at,text:cut(e.text,500)})),payment_claim_is_proof:false},
 history,official_products:products,official_faq:faqs,
 campaigns:arr(ctx.campaigns).filter(c => !c.chat_id || same(c.chat_id,job.chat_id)).slice(0,2).map(c => ({name:cut(c.name,120),product_id:c.product_id,attribution:c.attribution})),
 crm:arr(ctx.opportunities).slice(0,3).map(o => ({product_id:o.product_id,stage:o.stage})),
 subscriptions:ctx.subscriptions ?? []
};
return [{json:{job_id:job.job_id,inbound_event_id:job.inbound_event_id,chat_id:job.chat_id,attempt_count:job.attempt_count??1,agent_input:JSON.stringify(input)}}];
