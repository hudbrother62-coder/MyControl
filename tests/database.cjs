const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs"),
  test = require("node:test"),
  assert = require("node:assert/strict");
let db;
test.before(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;" +
      fs
        .readFileSync("database/001_queue.sql", "utf8")
        .replace("create extension if not exists pgcrypto;", ""),
  );
  if (fs.existsSync("database/002_reliability.sql"))
    await db.exec(fs.readFileSync("database/002_reliability.sql", "utf8"));
  if (fs.existsSync("database/003_business_sync.sql"))
    await db.exec(fs.readFileSync("database/003_business_sync.sql", "utf8"));
});
test.after(async () => {
  await db.close();
});
test("queue claims an ingested job without ambiguous SQL columns", async () => {
  await db.exec(
    "insert into mc_runtime_knowledge(kind,source_key,payload) values('BOT_SETTING','bot_enabled','{\"value\":true}') on conflict(kind,source_key) do update set payload=excluded.payload;",
  );
  await db.query(
    "select mc_ingest_whatsapp('test1','message','628@c.us','628','Hi',false,false,'{}')",
  );
  const r = await db.query("select * from mc_claim_ai_job('test-worker')");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].chat_id, "628@c.us");
});
test("manual sends are idempotent", async () => {
  const a = await db.query(
    "select mc_manual_send('629@c.us','Manual','request-1234567890') as r",
  );
  const b = await db.query(
    "select mc_manual_send('629@c.us','Manual','request-1234567890') as r",
  );
  assert.equal(a.rows[0].r.outbound_job_id, b.rows[0].r.outbound_job_id);
});
test("takeover cancels already queued automated sends", async () => {
  await db.exec(
    "insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key)values('630@c.us','Old','FOLLOW_UP','test-followup')",
  );
  await db.query("select mc_control_takeover('630@c.us',true)");
  const r = await db.query(
    "select status from mc_outbound_jobs where idempotency_key='test-followup'",
  );
  assert.equal(r.rows[0].status, "CANCELLED");
});
test("Telegram duplicate update claims once", async () => {
  const a = await db.query("select mc_claim_telegram_update(100) as r"),
    b = await db.query("select mc_claim_telegram_update(100) as r");
  assert.equal(a.rows[0].r.claimed, true);
  assert.equal(b.rows[0].r.claimed, false);
});
test("AI completion refuses a different chat", async () => {
  const r = await db.query(
    "select id from mc_ai_jobs where status='PROCESSING' limit 1",
  );
  await assert.rejects(
    db.query(
      'select mc_complete_ai_job($1,\'{"should_reply":true,"needs_human":false,"should_followup":false,"stage":"INTERESTED","reply":"Hi"}\'::jsonb,\'test\',1::smallint,\'999@c.us\',\'Hi\')',
      [r.rows[0].id],
    ),
    /mismatch/,
  );
});
test("completion queues once and duplicate completion is harmless", async () => {
  const r = await db.query(
    "select id from mc_ai_jobs where status='PROCESSING' limit 1",
  );
  const args = [r.rows[0].id];
  const q =
    'select mc_complete_ai_job($1,\'{"should_reply":true,"needs_human":false,"should_followup":false,"stage":"INTERESTED","reply":"Hi"}\'::jsonb,\'test\',1::smallint,\'628@c.us\',\'Hi\') as r';
  await db.query(q, args);
  const b = await db.query(q, args);
  assert.equal(b.rows[0].r.duplicate, true);
  const c = await db.query(
    "select count(*)::int as n from mc_outbound_jobs where chat_id='628@c.us'",
  );
  assert.equal(c.rows[0].n, 1);
});
test("new inbound cancels queued followup", async () => {
  await db.exec(
    "insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key)values('631@c.us','Old','FOLLOW_UP','old-631')",
  );
  await db.query(
    "select mc_ingest_whatsapp('new-631','message','631@c.us','631','New',false,false,'{}')",
  );
  assert.equal(
    (
      await db.query(
        "select status from mc_outbound_jobs where idempotency_key='old-631'",
      )
    ).rows[0].status,
    "CANCELLED",
  );
});
test("recover expires outbound to UNKNOWN, never RETRY", async () => {
  await db.exec(
    "insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key,status,locked_at)values('632@c.us','Maybe sent','MANUAL','unknown-632','PROCESSING',now()-interval '5 minutes')",
  );
  await db.query("select mc_recover_expired_jobs()");
  assert.equal(
    (
      await db.query(
        "select status from mc_outbound_jobs where idempotency_key='unknown-632'",
      )
    ).rows[0].status,
    "UNKNOWN",
  );
});
test("bot disabled blocks new AI jobs while preserving inbound", async () => {
  await db.exec(
    "update mc_runtime_knowledge set payload='{\"value\":false}' where kind='BOT_SETTING' and source_key='bot_enabled'",
  );
  await db.query(
    "select mc_ingest_whatsapp('off-633','message','633@c.us','633','Hi',false,false,'{}')",
  );
  const r = await db.query(
    "select count(*)::int as n from mc_ai_jobs j join mc_inbound_events e on e.id=j.inbound_event_id where e.external_message_id='off-633'",
  );
  assert.equal(r.rows[0].n, 0);
});
test("anonymous role cannot call queue mutations", async () => {
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select mc_claim_ai_job('evil')"),
    /permission denied/,
  );
  await db.exec("reset role");
});
test("a stale worker cannot commit after its job is reclaimed", async () => {
  await db.exec(
    "update mc_runtime_knowledge set payload='{\"value\":true}' where kind='BOT_SETTING'and source_key='bot_enabled';insert into mc_inbound_events(external_message_id,chat_id,message_text)values('fence','650@c.us','Hi');insert into mc_lead_state(chat_id)values('650@c.us');insert into mc_ai_jobs(inbound_event_id,status,attempt_count,locked_at)select id,'PROCESSING',2,now()from mc_inbound_events where external_message_id='fence'",
  );
  const r = await db.query(
    "select j.id from mc_ai_jobs j join mc_inbound_events e on e.id=j.inbound_event_id where e.external_message_id='fence'",
  );
  await assert.rejects(
    db.query(
      "select mc_commit_claimed_ai_job($1,'{}','model',1::smallint,'650@c.us','',1)",
      [r.rows[0].id],
    ),
    /Stale claim/,
  );
});
test("old claim failure cannot overwrite a newer worker", async () => {
  const r = await db.query(
    "select j.id from mc_ai_jobs j join mc_inbound_events e on e.id=j.inbound_event_id where e.external_message_id='fence'",
  );
  await db.query("select mc_end_ai_claim($1,1,'old','FAILED',30)", [
    r.rows[0].id,
  ]);
  assert.equal(
    (
      await db.query("select status from mc_ai_jobs where id=$1", [
        r.rows[0].id,
      ])
    ).rows[0].status,
    "PROCESSING",
  );
});
test("product and settings edits synchronize knowledge atomically", async () => {
  await db.exec(
    "create table products(id text primary key,name text,status text,base_price numeric,promo_price numeric,short_description text);create table bot_settings(key text primary key,value jsonb)",
  );
  await db.exec(fs.readFileSync("database/003_business_sync.sql", "utf8"));
  await db.exec(
    "insert into products values('LIVE','Live product','ACTIVE',77000,70000,'Official');insert into bot_settings values('bot_enabled','false');update products set base_price=88000 where id='LIVE'",
  );
  const r = await db.query(
    "select payload from mc_runtime_knowledge where kind='PRODUCT'and source_key='LIVE'",
  );
  assert.equal(r.rows[0].payload.price, 88000);
  assert.equal(
    (await db.query("select mc_bot_enabled() as on")).rows[0].on,
    false,
  );
});
