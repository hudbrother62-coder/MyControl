const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");
let pg;
const chat = "998877665544332@lid";
async function allowed(kind) {
  return (await pg.query("select mc_contact_allowed($1,$2) allowed", [chat, kind])).rows[0].allowed;
}
test.before(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create table bot_settings(key text primary key,value jsonb);");
  for (const name of ["001_queue", "002_reliability", "003_business_sync", "005_campaigns", "006_web_controls", "008_contact_exclusions", "012_individual_contact_controls"]) {
    await pg.exec(fs.readFileSync("database/" + name + ".sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
  }
  await pg.exec("insert into bot_settings(key,value) values('bot_enabled','true'),('ai_auto_reply','true') on conflict(key) do update set value=excluded.value");
  await pg.query("insert into mc_lead_state(chat_id,display_name) values($1,'LID Contact')", [chat]);
});
test.after(async () => pg?.close());
test("timed pause stops AI but not manual messages and cancels queued work", async () => {
  await pg.query("select mc_ingest_whatsapp('contact-guard-message','message',$1,null,'hello',false,false,'{}')", [chat]);
  assert.equal((await pg.query("select count(*)::int n from mc_ai_jobs")).rows[0].n,1);
  await pg.query("insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key) values($1,'reply','AI_REPLY','contact-guard-pending')", [chat]);
  const result=(await pg.query("select mc_set_contact_bot_pause($1,60) v",[chat])).rows[0].v;
  assert.equal(result.paused,true);
  assert.equal(await allowed("AI_REPLY"),false);
  assert.equal(await allowed("MANUAL"),true);
  assert.equal((await pg.query("select status from mc_outbound_jobs where idempotency_key='contact-guard-pending'")).rows[0].status,"CANCELLED");
  assert.equal((await pg.query("select status from mc_ai_jobs limit 1")).rows[0].status,"HUMAN");
});
test("pause duration expires and AI accepts new messages, not old queued work", async () => {
  await pg.exec("update mc_lead_state set human_takeover_until=now()-interval '1 minute' where chat_id='"+chat+"'");
  assert.equal(await allowed("AI_REPLY"),true);
  await pg.query("select mc_ingest_whatsapp('contact-post-expiry','message',$1,null,'new question',false,false,'{}')", [chat]);
  assert.equal((await pg.query("select count(*)::int n from mc_ai_jobs")).rows[0].n,2);
  assert.equal((await pg.query("select status from mc_outbound_jobs where idempotency_key='contact-guard-pending'")).rows[0].status,"CANCELLED");
});
test("per-contact follow-up policy, priority, and owner note are persisted", async () => {
  const result=(await pg.query("select mc_set_contact_preferences($1,false,'IMPORTANT','Hubungi setelah rapat') r",[chat])).rows[0].r;
  assert.equal(result.followup_enabled,false);
  assert.equal(result.priority,"IMPORTANT");
  assert.equal(await allowed("AI_REPLY"),true);
  assert.equal(await allowed("FOLLOW_UP"),false);
  const directory=(await pg.query("select mc_contact_directory('LID Contact',50,0) r")).rows[0].r;
  assert.equal(directory.contacts[0].priority,"IMPORTANT");
  assert.equal(directory.contacts[0].note,"Hubungi setelah rapat");
  assert.equal(directory.contacts[0].followup_enabled,false);
});
test("blocked future followups cannot be queued but owner can still reply", async () => {
  await pg.query("insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key)values($1,'follow','FOLLOW_UP','contact-future-follow'),($1,'manual','MANUAL','contact-future-manual')",[chat]);
  const jobs=(await pg.query("select idempotency_key,status from mc_outbound_jobs where idempotency_key like 'contact-future-%' order by idempotency_key")).rows;
  assert.equal(jobs.find(x=>x.idempotency_key==='contact-future-follow').status,"CANCELLED");
  assert.equal(jobs.find(x=>x.idempotency_key==='contact-future-manual').status,"PENDING");
});
test("resume does not override follow-up OFF and an indefinite pause persists", async () => {
  await pg.query("select mc_set_contact_bot_pause($1,-1)",[chat]);
  assert.equal(await allowed("AI_REPLY"),false);
  await pg.query("select mc_set_contact_bot_pause($1,0)",[chat]);
  assert.equal(await allowed("AI_REPLY"),true);
  assert.equal(await allowed("FOLLOW_UP"),false);
});
test("browser roles cannot bypass owner-only per-contact controls",async()=>{
  for(const signature of ["mc_set_contact_bot_pause(text,integer)","mc_set_contact_preferences(text,boolean,text,text)","mc_contact_directory(text,integer,integer)"]){
    assert.equal((await pg.query("select has_function_privilege('anon',$1,'execute') permitted",[signature])).rows[0].permitted,false);
  }
});