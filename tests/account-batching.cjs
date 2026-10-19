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
 if(fs.existsSync('database/038_multi_product_payment_safety.sql')) await db.exec(fs.readFileSync('database/038_multi_product_payment_safety.sql','utf8'));
 await db.exec(fs.readFileSync('database/039_reply_delivery_policy.sql','utf8'));
 await db.exec(fs.readFileSync('database/041_prime_store_correct_prices_and_welcome.sql','utf8'));
 await db.exec(fs.readFileSync('database/047_live_catalog_no_duplicate_faq.sql','utf8'));
 await db.exec(fs.readFileSync('database/048_dynamic_policy_no_stale_bot_settings.sql','utf8'));
 await db.exec(fs.readFileSync('database/007_efficient_reads.sql','utf8').match(/create or replace function public[.]mc_chat_page[\s\S]*?\$\$;/)[0]);
 if(fs.existsSync('database/050_account_scope_and_burst.sql'))await db.exec(fs.readFileSync('database/050_account_scope_and_burst.sql','utf8'));
 if(fs.existsSync('database/051_restricted_live_test.sql'))await db.exec(fs.readFileSync('database/051_restricted_live_test.sql','utf8'));
 await db.query("insert into bot_settings(key,value)values('prime_store_waha_cutover',$1)on conflict(key)do update set value=excluded.value",[JSON.stringify({target_session:'CSNEW2',target_me_id:'6283186750567@c.us',target_lid:'208770441470075@lid',route_active:false})]);
 await db.exec("update mc_runtime_knowledge set payload='{\"value\":true}' where kind='BOT_SETTING' and source_key in('bot_enabled','ai_auto_reply')");
});
test.after(async()=>db?.close());

const current='6283186750567@c.us',old='6285167465305@c.us';
async function ingest(chat,text,account=current,session='CSNEW2',id=crypto.randomUUID()){
 return(await db.query("select mc_ingest_whatsapp($1,'message',$2,$3,$4,false,false,$5) r",[id,chat,chat.split('@')[0],text,JSON.stringify({session,me:{id:account,lid:'208770441470075@lid'}})])).rows[0].r;
}
async function age(chat){await db.query("update mc_inbound_events set received_at=received_at-interval '3 seconds' where chat_id=$1",[chat]);}
async function claim(){return(await db.query("select * from mc_claim_ai_job('test')")).rows;}
const decision={should_reply:true,needs_human:false,should_followup:false,reply:'Baik Kak, saya jelaskan.',stage:'PRODUCT_INTEREST',lead_status:'INTERESTED',followup_plan:[]};
test('wrong sender is rejected before ingest and cannot create AI work',async()=>{
 const r=await ingest('1001@c.us','lama',old);assert.equal(r.reason,'ACCOUNT_MISMATCH');
 assert.equal((await db.query("select count(*)::int n from mc_inbound_events where chat_id='1001@c.us'")).rows[0].n,0);
});
test('inbox and paginated transcript hide another bot account',async()=>{
 await db.exec('alter table mc_inbound_events disable trigger mc_00_scope_inbound');
 await db.query("insert into mc_inbound_events(external_message_id,chat_id,message_text,payload,account_id)values('old-only','1002@c.us','old private',$1,'6285167465305@c.us')",[JSON.stringify({session:'old',me:{id:old}})]);
 await db.exec("alter table mc_inbound_events enable trigger mc_00_scope_inbound;insert into mc_lead_state(chat_id,phone,account_id)values('1002@c.us','1002','6285167465305@c.us')");
 const list=(await db.query('select * from mc_account_inbox(0)')).rows;
 assert.ok(!JSON.stringify(list).includes('1002@c.us'));
 const history=(await db.query("select mc_chat_page('1002@c.us') r")).rows[0].r;
 assert.deepEqual(history.messages,[]);
});
test('burst waits briefly, combines bubbles in order and deduplicates webhook retries',async()=>{
 const id=crypto.randomUUID();await ingest('1003@c.us','Saya mau Sekolapro',current,'CSNEW2',id);
 assert.equal((await ingest('1003@c.us','Saya mau Sekolapro',current,'CSNEW2',id)).duplicate,true);
 await ingest('1003@c.us','untuk sekolah');await ingest('1003@c.us','berapa per bulan?');
 assert.deepEqual(await claim(),[]);
 await age('1003@c.us');const jobs=await claim();assert.equal(jobs.length,1);
 assert.equal(jobs[0].message_text,'Saya mau Sekolapro\nuntuk sekolah\nberapa per bulan?');
 assert.equal(jobs[0].inbound_payload.batch_count,3);
 assert.deepEqual(await claim(),[]);
 await db.query("select mc_commit_claimed_ai_job($1,$2,'test',1::smallint,$3,$4,$5)",[jobs[0].job_id,JSON.stringify(decision),jobs[0].chat_id,decision.reply,jobs[0].attempt_count]);
 assert.equal((await db.query("select count(*)::int n from mc_outbound_jobs where chat_id='1003@c.us' and kind='AI_REPLY' and status='PENDING'")).rows[0].n,1);
});
test('new bubble during inference suppresses stale answer and next claim retains all unanswered bubbles',async()=>{
 await ingest('1004@c.us','Saya butuh kasir');await age('1004@c.us');const [j]=await claim();
 await ingest('1004@c.us','bisa printer bluetooth?');
 const r=(await db.query("select mc_commit_claimed_ai_job($1,$2,'test',1::smallint,$3,$4,$5) r",[j.job_id,JSON.stringify(decision),j.chat_id,decision.reply,j.attempt_count])).rows[0].r;
 assert.equal(r.suppressed,true);await age('1004@c.us');const [next]=await claim();
 assert.match(next.message_text,/Saya butuh kasir\nbisa printer bluetooth/);
 await db.query("update mc_ai_jobs set status='DONE' where id=$1",[next.job_id]);
});
test('context excludes old bot history, memory and product focus for same customer',async()=>{
 await db.exec('alter table mc_inbound_events disable trigger mc_00_scope_inbound');
 await db.query("insert into mc_inbound_events(external_message_id,chat_id,message_text,payload,account_id)values('old-focus','1005@c.us','HiTV untuk drakor',$1,'6285167465305@c.us')",[JSON.stringify({me:{id:old}})]);
 await db.exec("alter table mc_inbound_events enable trigger mc_00_scope_inbound;insert into mc_lead_state(chat_id,phone,product_id,notes,account_id)values('1005@c.us','1005','PS_FILM','old private note','6285167465305@c.us');insert into mc_contact_memories(chat_id,summary,source_event_id)select '1005@c.us','old private memory',id from mc_inbound_events where external_message_id='old-focus'");
 await ingest('1005@c.us','Saya ingin Sekolapro');
 const c=(await db.query("select mc_get_ai_context('1005@c.us',30) c")).rows[0].c;
 assert.equal(c.lead_state.CS_PRODUCT_FOCUS.product_id,'SP001');
 assert.ok(!JSON.stringify(c.history).includes('HiTV'));
 assert.ok(!JSON.stringify(c.memory).includes('old private'));
 assert.equal(c.account.me_id,current);
 await db.exec("update mc_ai_jobs set status='DONE' where status in('PENDING','RETRY')");
});
test('renamed session on same WhatsApp account remains in scoped transcript',async()=>{
 await db.query("insert into mc_inbound_events(external_message_id,chat_id,message_text,payload)values('renamed','1006@c.us','same number retained',$1)",[JSON.stringify({session:'CS2',me:{id:current}})]);
 const c=(await db.query("select mc_chat_page('1006@c.us') r")).rows[0].r;assert.equal(c.messages[0].text,'same number retained');
});
test('anonymous cannot read scoped contacts or bypass scope gates',async()=>{
 await db.exec('set role anon');await assert.rejects(db.query('select * from mc_account_inbox(0)'),/permission denied/);await db.exec('reset role');
});
test('account switch archives previous state before resetting mutable memory',async()=>{
 const a=(await db.query("select lead_state,memory from mc_account_state_archive where chat_id='1005@c.us'")).rows;
 assert.equal(a.length,1);assert.equal(a[0].lead_state.notes,'old private note');assert.equal(a[0].memory.summary,'old private memory');
 assert.equal((await db.query("select count(*)::int n from mc_inbound_events where external_message_id='old-focus'")).rows[0].n,1);
});
test('outbound preflight cancels old account jobs even if a worker has already claimed them',async()=>{
 await db.exec("insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key,status,attempt_count)values('1007@c.us','manual old','MANUAL','old-job','PROCESSING',1);update mc_outbound_jobs set account_id='6285167465305@c.us' where idempotency_key='old-job'");
 const id=(await db.query("select id from mc_outbound_jobs where idempotency_key='old-job'")).rows[0].id;
 const r=(await db.query('select mc_campaign_preflight($1,1) r',[id])).rows[0].r;
 assert.equal(r.allowed,false);assert.equal(r.reason,'ACCOUNT_MISMATCH');
 assert.equal((await db.query('select status from mc_outbound_jobs where id=$1',[id])).rows[0].status,'CANCELLED');
});
test('scoped pagination retains timestamp ties without showing old-account messages',async()=>{
 await db.exec('alter table mc_inbound_events disable trigger mc_00_scope_inbound');
 await db.query("insert into mc_inbound_events(external_message_id,chat_id,message_text,received_at,account_id)select 'scoped-page-'||i,'1008@c.us','bubble-'||i,'2026-01-01'::timestamptz,$1 from generate_series(1,55)i",[current]);
 await db.query("insert into mc_inbound_events(external_message_id,chat_id,message_text,received_at,account_id)values('hidden-page','1008@c.us','private old','2026-01-02',$1)",[old]);
 await db.exec('alter table mc_inbound_events enable trigger mc_00_scope_inbound');
 const first=(await db.query("select mc_chat_page('1008@c.us') r")).rows[0].r;
 const second=(await db.query("select mc_chat_page('1008@c.us',$1,$2) r",[first.messages[0].createdAt,first.messages[0].id])).rows[0].r;
 assert.equal(first.messages.length,50);assert.equal(second.messages.length,5);assert.equal(second.hasMore,false);
 assert.equal(new Set([...first.messages,...second.messages].map(m=>m.id)).size,55);
 assert.ok(!JSON.stringify(first).includes('private old'));
});

test('restricted live test processes only the named owner test contact while global automation stays OFF',async()=>{
 await db.exec("update mc_runtime_knowledge set payload='{\"value\":false}' where kind='BOT_SETTING' and source_key in('bot_enabled','ai_auto_reply')");
 await db.query("insert into bot_settings(key,value)values('prime_store_live_test',$1)",[JSON.stringify({enabled:true,chat_ids:['1009@c.us'],expires_at:new Date(Date.now()+60000).toISOString()})]);
 const regular=await ingest('1010@c.us','not a test contact');assert.equal(regular.ignored,true);
 const r=await ingest('1009@c.us','berapa Sekolapro?');assert.ok(r.ai_job_id,'test-only message must get an AI job');
 await age('1009@c.us');const [j]=await claim();assert.equal(j.chat_id,'1009@c.us');
 const c=(await db.query("select mc_commit_claimed_ai_job($1,$2,'test',1::smallint,$3,$4,$5) r",[j.job_id,JSON.stringify(decision),j.chat_id,decision.reply,j.attempt_count])).rows[0].r;
 assert.ok(c.outbound_job_id);
 assert.equal((await db.query('select mc_bot_enabled() b')).rows[0].b,false,'test context must never leak into the next HTTP transaction');
 await db.exec("update bot_settings set value=jsonb_set(value,'{enabled}','false') where key='prime_store_live_test'");
 assert.deepEqual(await claim(),[]);
});
