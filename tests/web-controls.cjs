const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  test = require("node:test"),
  assert = require("node:assert/strict");
let pg;
test.before(async () => {
  pg = new PGlite();
  await pg.exec(
    "create role anon;create role authenticated;create role service_role;create table bot_settings(key text primary key,value jsonb);",
  );
  for (const f of [
    "001_queue",
    "002_reliability",
    "003_business_sync",
    "005_campaigns",
    "006_web_controls",
  ])
    await pg.exec(
      fs
        .readFileSync("database/" + f + ".sql", "utf8")
        .replace("create extension if not exists pgcrypto;", ""),
    );
});
test.after(async () => {
  await pg?.close();
});
test("save web configuration synchronizes canonical settings and rejects stale edits", async () => {
  const current = (await pg.query("select mc_read_web_controls() as r")).rows[0]
    .r;
  const saved = (
    await pg.query("select mc_save_web_controls($1,$2::jsonb) as r", [
      current.version,
      JSON.stringify({
        bot_enabled: false,
        ai_auto_reply: true,
        ai_model: "available-model",
        bot_instructions: "Jawab singkat",
        followup_enabled: false,
        max_followups: 1,
        working_hours_start: "08:00",
        working_hours_end: "21:00",
        reply_delay_min_seconds: 0,
        reply_delay_max_seconds: 2,
        waha_base_url: "",
        n8n_base_url: "",
      }),
    ])
  ).rows[0].r;
  assert(saved.version > current.version);
  assert.equal(saved.settings.ai_model, "available-model");
  assert.equal(
    (await pg.query("select value from bot_settings where key='ai_model'"))
      .rows[0].value,
    "available-model",
  );
  await assert.rejects(
    pg.query("select mc_save_web_controls($1,$2::jsonb)", [
      current.version,
      "{}",
    ]),
    /berubah/,
  );
});
test("invalid values and unknown fields are rejected atomically", async () => {
  const r = (await pg.query("select mc_read_web_controls() as r")).rows[0].r;
  for (const payload of [
    { max_followups: 99 },
    { ai_api_key: "secret" },
    { working_hours_start: "garbage" },
    { waha_base_url: "http://127.0.0.1:3000" },
  ])
    await assert.rejects(
      pg.query("select mc_save_web_controls($1,$2::jsonb)", [
        r.version,
        JSON.stringify(payload),
      ]),
    );
  assert.equal(
    (await pg.query("select mc_read_web_controls() as r")).rows[0].r.version,
    r.version,
  );
});
test("saved version differs from worker acknowledgment, future ACK denied", async () => {
  const r = (await pg.query("select mc_read_web_controls() as r")).rows[0].r;
  await assert.rejects(
    pg.query("select mc_ack_web_controls('worker','AI',$1)", [r.version + 1]),
  );
  await pg.query("select mc_ack_web_controls('worker','AI',$1)", [r.version]);
  const w = (await pg.query("select applied_version from mc_worker_controls"))
    .rows[0];
  assert.equal(Number(w.applied_version), r.version);
});
test("anonymous cannot read settings, mutate config or spoof worker acknowledgment", async () => {
  await pg.exec("set role anon");
  await assert.rejects(
    pg.query("select mc_read_web_controls()"),
    /permission denied/,
  );
  await assert.rejects(
    pg.query("select mc_ack_web_controls('evil','AI',1)"),
    /permission denied/,
  );
  await pg.exec("reset role");
});
test('retry is atomic, refuses UNKNOWN and campaign jobs',async()=>{await pg.exec("insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key,status)values('62811@c.us','Retry','MANUAL','retry-web','FAILED'),('62812@c.us','Maybe','MANUAL','unknown-web','UNKNOWN')");const jobs=(await pg.query("select id,status from mc_outbound_jobs where idempotency_key in('retry-web','unknown-web')")).rows;await assert.rejects(pg.query('select mc_retry_web_failure($1)',[jobs.find(j=>j.status==='UNKNOWN').id]));await pg.query('select mc_retry_web_failure($1)',[jobs.find(j=>j.status==='FAILED').id]);assert.equal((await pg.query("select status from mc_outbound_jobs where idempotency_key='retry-web'")).rows[0].status,'RETRY');assert.equal((await pg.query("select count(*)::int n from mc_campaign_audit where action='OWNER_RETRY_FAILED'")).rows[0].n,1);});
test('followup OFF enforced even when AI requests one, configured delay is bounded',async()=>{await pg.exec("insert into bot_settings(key,value)values('bot_enabled','true'),('ai_auto_reply','true')on conflict(key)do update set value=excluded.value");await pg.query("select mc_ingest_whatsapp('web-ai','message','628177111111@c.us','628177111111','Harga?',false,false,'{}')");const j=(await pg.query("select * from mc_claim_ai_job('web-worker')")).rows[0];assert(j);const decision={should_reply:true,reply:'Harga resmi',needs_human:false,should_followup:true,stage:'INTERESTED',followup_plan:[{sequence_no:1,after_minutes:60,message:'Follow'}]};const r=(await pg.query("select mc_complete_ai_job($1,$2::jsonb,'available-model',1::smallint,$3,'Harga resmi') as r",[j.job_id,JSON.stringify(decision),j.chat_id])).rows[0].r;assert(r.outbound_job_id);assert.equal((await pg.query("select count(*)::int n from mc_followup_jobs where chat_id=$1",[j.chat_id])).rows[0].n,0);const delay=(await pg.query('select extract(epoch from(next_retry_at-now()))::float8 d from mc_outbound_jobs where id=$1',[r.outbound_job_id])).rows[0].d;assert(delay>=-1&&delay<=2.1);assert.equal((await pg.query('select mc_dispatch_due_followups() as r')).rows[0].r.reason,'followup_disabled')});
