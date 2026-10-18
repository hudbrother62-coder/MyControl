const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),test=require('node:test'),assert=require('node:assert/strict');
let db;
test.before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table bot_settings(key text primary key,value jsonb,updated_at timestamptz default now());
 create table customers(id uuid primary key,whatsapp_number text,name text);
 create table conversations(customer_id uuid,external_chat_id text);
 create table orders(id uuid primary key,customer_id uuid,product_id text,status text,created_at timestamptz);
 create table payment_verifications(order_id uuid,status text,owner_id uuid,approved_at timestamptz);
 create table products(id text primary key,name text,status text,base_price numeric default 0,promo_price numeric default 0,short_description text,full_description text,benefits text,demo_url text,checkout_url text,keywords text[],delivery_type text,source text,updated_at timestamptz default now());
 create table product_faq(id uuid primary key default gen_random_uuid(),external_id text unique,product_id text,category text,question text,answer text,ai_can_use boolean default true,active boolean default true,updated_at timestamptz default now());`);
 for(const n of ['001_queue','002_reliability','003_business_sync','005_campaigns','006_web_controls'])await db.exec(fs.readFileSync('database/'+n+'.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(`create or replace function mc_get_ai_context_before_prime_store(text,integer default 30) returns jsonb language sql as $$select jsonb_build_object('history','[]'::jsonb,'lead_state','{}'::jsonb,'memory',coalesce((select to_jsonb(m) from mc_contact_memories m where m.chat_id=$1),'{}'::jsonb),'knowledge','[]'::jsonb)$$;`);
 if(fs.existsSync('database/036_prime_store_memory.sql')) await db.exec(fs.readFileSync('database/036_prime_store_memory.sql','utf8'));
 if(fs.existsSync('database/037_prime_store_catalog_copy.sql')) await db.exec(fs.readFileSync('database/037_prime_store_catalog_copy.sql','utf8'));
});
test.after(async()=>db?.close());
test('each PRIME STORE product carries its own approved features without access links or unrelated copy',async()=>{
 const expected={PS_KASIR:/transaksi penjualan/i,PS_TV:/channel lokal dan internasional/i,PS_FILM:/drama Korea/i,PS_SPORT:/hasil pertandingan/i,PS_DUNOKIDS:/waktu layar/i};
 for(const [id,feature] of Object.entries(expected)){
  const row=(await db.query("select p.full_description,k.payload from products p join mc_runtime_knowledge k on k.source_key=p.id and k.kind='PRODUCT' where p.id=$1",[id])).rows[0];
  assert.match(row.full_description,feature,id);assert.match(row.payload.full_description,feature,id);
  assert.equal(row.payload.full_description,row.full_description);
  assert.doesNotMatch(row.full_description,/https?:\/\/|Harga promo Oktober/);
 }
 const kasir=(await db.query("select full_description from products where id='PS_KASIR'")).rows[0].full_description;
 assert.doesNotMatch(kasir,/film|drakor/i);
});
async function ctx(chat){return(await db.query('select mc_get_ai_context($1,30) c',[chat])).rows[0].c;}
async function inbound(chat,msg,date){await db.query('insert into mc_inbound_events(external_message_id,chat_id,message_text,received_at)values($1,$2,$3,$4)',[crypto.randomUUID(),chat,msg,date]);}
test('rollout keeps automation paused and installs only PRIME STORE active catalog',async()=>{
 assert.equal((await db.query('select mc_bot_enabled() b')).rows[0].b,false);
 assert.deepEqual((await db.query("select id from products where status='ACTIVE' order by id")).rows.map(x=>x.id),['PS_BUNDLE2','PS_DUNOKIDS','PS_FILM','PS_KASIR','PS_SPORT','PS_TV']);
 const c=await ctx('1@c.us');assert.equal(c.prime_store.brand,'PRIME STORE');
 assert.ok(!JSON.stringify(c.knowledge).includes('chat.whatsapp.com'));
 assert.ok(!JSON.stringify(c.knowledge).includes('.apk'));
 const kasir=c.knowledge.find(k=>k.source_key==='PS_KASIR');assert.equal(Number(kasir.payload.price),94000);assert.equal(kasir.payload.promo_price,null);
});
test('short replies retain product from the same contact, aliases switch product, memory stays isolated',async()=>{
 await inbound('11@lid','Saya pakai Android TV untuk HiTV','2026-10-18T10:00:00Z');
 await inbound('11@lid','lanjut','2026-10-18T10:01:00Z');
 await inbound('22@lid','Kasir Kilat bisa printer?','2026-10-18T10:01:00Z');
 await db.query("insert into mc_contact_memories(chat_id,summary)values('11@lid','Sudah coba buka melalui Setelan > Aplikasi')");
 const a=await ctx('11@lid'),b=await ctx('22@lid');
 assert.equal(a.lead_state.CS_PRODUCT_FOCUS.product_id,'PS_FILM');
 assert.equal(b.lead_state.CS_PRODUCT_FOCUS.product_id,'PS_KASIR');
 assert.match(a.lead_state.PRIME_STORE_MEMORY.summary,/Setelan/);
 assert.ok(!JSON.stringify(b.lead_state.PRIME_STORE_MEMORY).includes('HiTV'));
 await inbound('11@lid','Sekarang Guide TV ya','2026-10-18T10:02:00Z');
 assert.equal((await ctx('11@lid')).lead_state.CS_PRODUCT_FOCUS.product_id,'PS_TV');
});
test('amount-only and transfer claims cannot pick product or verify payment',async()=>{
 await inbound('33@c.us','mau yang 79 ribu, sudah transfer','2026-10-18T11:00:00Z');
 const c=await ctx('33@c.us');assert.equal(c.lead_state.CS_PRODUCT_FOCUS,null);
 assert.equal(c.prime_store.payment_verified,false);
 assert.equal(c.lead_state.PRIME_STORE_MEMORY.payment_claim_is_proof,false);
});
test('database blocks automatic access links and false payment success while allowing manual delivery',async()=>{
 for(const [key,body,kind,status]of[
 ['prime-test-apk','https://example.org/app.apk','AI_REPLY','CANCELLED'],
 ['prime-test-group','https://chat.whatsapp.com/secret','FOLLOW_UP','CANCELLED'],
 ['prime-test-payment','Terima kasih Kak, pembayarannya sudah berhasil kami terima.','AI_REPLY','CANCELLED'],
 ['prime-test-normal','Baik Kak, bukti akan diperiksa terlebih dahulu.','AI_REPLY','PENDING'],
 ['prime-test-manual','https://example.org/app.apk','MANUAL','PENDING']]){
 await db.query('insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key)values($1,$2,$3,$4)',['44@c.us',body,kind,key]);
 assert.equal((await db.query('select status from mc_outbound_jobs where idempotency_key=$1',[key])).rows[0].status,status,key);
 }
});
test('proof receipt is allowed and only owner approval on latest order verifies payment',async()=>{
 await db.exec(`insert into customers(id,whatsapp_number)values('00000000-0000-0000-0000-000000000001','55');
 insert into orders(id,customer_id,product_id,status,created_at)values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','PS_TV','PAID','2026-10-18');
 insert into payment_verifications(order_id,status,owner_id,approved_at)values('00000000-0000-0000-0000-000000000002','APPROVED','00000000-0000-0000-0000-000000000009',now());`);
 await inbound('55@c.us','Guide TV ya','2026-10-18T12:00:00Z');
 assert.equal((await ctx('55@c.us')).prime_store.payment_verified,true);
 assert.equal((await ctx('55@c.us')).lead_state.OWNER_REPLY_POLICY['PRIME STORE TRANSACTION'].payment_verified,true);
 await db.exec(`insert into orders(id,customer_id,product_id,status,created_at)values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','PS_TV','PAYMENT_SUBMITTED',now());`);
 assert.equal((await ctx('55@c.us')).prime_store.payment_verified,false);
 await db.query("insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key)values('55@c.us','Bukti pembayarannya sudah kami terima untuk diperiksa.','AI_REPLY','prime-receipt-only')");
 assert.equal((await db.query("select status from mc_outbound_jobs where idempotency_key='prime-receipt-only'")).rows[0].status,'PENDING');
});
test('all model slots use PRIME STORE and forward trusted context to agent',()=>{
 const vm=require('node:vm');const w=JSON.parse(fs.readFileSync('workflows/production/02-ai-worker.json','utf8'));
 const agents=w.nodes.filter(n=>n.parameters?.options?.systemMessage);
 assert.equal(agents.length,4);for(const n of agents){assert.match(n.parameters.options.systemMessage,/PRIME STORE/);assert.ok(!n.parameters.options.systemMessage.includes('Customer Service Bantu Beres'));}
 const prepare=w.nodes.find(n=>n.name==='Prepare Agent Input').parameters.jsCode;
 const data=vm.runInNewContext('(function(){'+prepare+'})()',{$json:{prime_store:{brand:'PRIME STORE',payment_verified:false},subscriptions:[]},$:()=>({first:()=>({json:{chat_id:'11@lid'}})})})[0].json;
 assert.match(data.agent_input,/PRIME STORE TRANSACTION/);
});
