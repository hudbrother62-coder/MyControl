const {PGlite}=require("@electric-sql/pglite");
const fs=require("node:fs"),test=require("node:test"),assert=require("node:assert/strict");
let db;
test.before(async()=>{
 db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create table mc_campaign_contacts(
  phone text primary key,name text not null,tags text not null default '',
  source text not null default '',consent boolean not null default false,
  consent_at timestamptz,opted_out_at timestamptz,
  consent_evidence text default '',updated_at timestamptz default now());
 create table mc_contact_exclusions(phone text primary key,scope text not null);
 create table mc_lead_state(chat_id text primary key,phone text,display_name text);
 create table mc_campaign_recipients(id text primary key,phone text);
 create table mc_outbound_jobs(
  id text primary key,chat_id text,recipient_id text,kind text,status text,
  locked_at timestamptz,locked_by text,last_error text);
 create table mc_followup_jobs(chat_id text,status text,processed_at timestamptz);
 create table mc_campaign_audit(action text,detail jsonb);
 insert into mc_campaign_contacts(phone,name,source,consent,opted_out_at) values
 ('628111111111','Existing','WhatsApp CS',false,null),
 ('628222222222','Customer optout','WhatsApp CS',false,now()),
 ('628333333333','Staged','CAMPAIGN_ONLY_STAGED',false,null),
 ('628444444444','Allowed','WhatsApp CS',true,null),
 ('628555555555','Excluded','WhatsApp CS',false,null);
 insert into mc_contact_exclusions(phone,scope) values('628555555555','PROMOTION');
 `);
 await db.exec(fs.readFileSync("database/053_owner_promo_default_on.sql","utf8"));
});
test.after(async()=>db?.close());
const status=(phone)=>db.query("select consent,consent_at,owner_promo_disabled,opted_out_at from mc_campaign_contacts where phone=$1",[phone]).then(r=>r.rows[0]);
const toggle=(phones,all,search,enabled)=>db.query("select mc_owner_promo_bulk($1,$2,$3,$4) result",[phones,all,search,enabled]).then(r=>r.rows[0].result);
test("Existing records default ON without inventing customer consent evidence",async()=>{
 assert.equal((await status("628111111111")).consent,true);
 assert.equal((await status("628111111111")).consent_at,null);
 assert.equal((await status("628222222222")).consent,false);
 assert.equal((await status("628333333333")).consent,false);
 assert.equal((await status("628555555555")).consent,false);
});
test("New contacts default ON even if old ingestion inserts false",async()=>{
 await db.exec("insert into mc_campaign_contacts(phone,name,source,consent)values('628666666666','New','WhatsApp CS',false)");
 assert.equal((await status("628666666666")).consent,true);
 assert.equal((await status("628666666666")).consent_at,null);
});
test("Owner OFF survives reimport and can later be switched ON",async()=>{
 assert.equal((await toggle(["628111111111"],false,"",false)).changed,1);
 await db.query("select mc_campaign_contact_import($1)",[JSON.stringify([{phone:"628111111111",name:"Changed",source:"Impor My Control",consent:false}])]);
 assert.equal((await status("628111111111")).consent,false);
 assert.equal((await status("628111111111")).owner_promo_disabled,true);
 assert.equal((await toggle(["628111111111"],false,"",true)).changed,1);
 assert.equal((await status("628111111111")).consent,true);
});
test("Owner OFF cancels queued promotions",async()=>{
 await db.exec("insert into mc_campaign_recipients(id,phone)values('r1','628444444444');insert into mc_outbound_jobs(id,chat_id,recipient_id,kind,status)values('o1','628444444444@c.us','r1','CAMPAIGN','PENDING');insert into mc_followup_jobs(chat_id,status)values('628444444444@c.us','PENDING');");
 await toggle(["628444444444"],false,"",false);
 assert.equal((await db.query("select status from mc_outbound_jobs where id='o1'")).rows[0].status,"CANCELLED");
 assert.equal((await db.query("select status from mc_followup_jobs limit 1")).rows[0].status,"CANCELLED");
});
test("Enable all never restores customer STOP or staged contacts",async()=>{
 const res=await toggle([],true,"",true);
 assert.equal(res.skipped,2);
 assert.equal((await status("628222222222")).consent,false);
 assert.equal((await status("628333333333")).consent,false);
});
test("RPC is service-role-only",async()=>{
 const row=(await db.query("select has_function_privilege('anon','mc_owner_promo_bulk(text[],boolean,text,boolean)','execute') allowed")).rows[0];
 assert.equal(row.allowed,false);
});
