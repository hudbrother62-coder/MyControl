const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  test = require("node:test"),
  assert = require("node:assert/strict");
let db;
test.before(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;",
  );
  for (const f of [
    "001_queue",
    "002_reliability",
    "003_business_sync",
    "005_campaigns",
  ])
    await db.exec(
      fs
        .readFileSync("database/" + f + ".sql", "utf8")
        .replace("create extension if not exists pgcrypto;", ""),
    );
});
test.after(async () => {
  if (db) await db.close();
});
const contact = (phone, name = "Test") => ({
  phone,
  name,
  consent: true,
  source: "Owner opt-in test",
});
async function make(
  steps = [{ type: "TEXT", body: "Halo {{nama}}" }],
  phones = ["628111111111"],
) {
  await db.query("select mc_campaign_contact_import($1::jsonb)", [
    JSON.stringify(phones.map((p) => contact(p))),
  ]);
  const r = await db.query("select mc_save_campaign($1::jsonb) as r", [
    JSON.stringify({
      name: "Campaign",
      product_id: "KP001",
      steps,
      phones,
      bot_enabled: true,
    }),
  ]);
  return r.rows[0].r.id;
}
async function tested(id) {
  const r = await db.query("select mc_campaign_test($1,'628999999999') as r", [
    id,
  ]);
  await db.query(
    "update mc_outbound_jobs set status='SENT',sent_at=now(),provider_message_id='test-'||id::text where campaign_id=$1",
    [r.rows[0].r.id],
  );
}
async function ready() {
  await db.query("select mc_campaign_heartbeat('test','default',true)");
}
test("import preserves opt-out across duplicate import", async () => {
  await db.query("select mc_campaign_contact_import($1::jsonb)", [
    JSON.stringify([contact("628123456789")]),
  ]);
  await db.exec(
    "update mc_campaign_contacts set consent=false,opted_out_at=now() where phone='628123456789'",
  );
  await db.query("select mc_campaign_contact_import($1::jsonb)", [
    JSON.stringify([contact("628123456789", "Renamed")]),
  ]);
  assert.equal(
    (
      await db.query(
        "select consent from mc_campaign_contacts where phone='628123456789'",
      )
    ).rows[0].consent,
    false,
  );
});
test("launch blocked until v2 worker heartbeat", async () => {
  const id = await make();
  await assert.rejects(
    db.query("select mc_campaign_action($1,'START')", [id]),
    /worker/i,
  );
  await ready();
});
test("1000 recipients enqueue once and old worker cannot claim campaign", async () => {
  const phones = Array.from(
    { length: 1000 },
    (_, i) => "62822" + String(i).padStart(8, "0"),
  );
  const id = await make(undefined, phones);
  await tested(id);
  await db.query("select mc_campaign_action($1,'START')", [id]);
  await db.query("select mc_campaign_action($1,'START')", [id]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from mc_outbound_jobs where campaign_id=$1",
        [id],
      )
    ).rows[0].n,
    1000,
  );
  assert.equal(
    (await db.query("select * from mc_claim_outbound_job('old')")).rows.length,
    0,
  );
  await db.query("select mc_campaign_action($1,'CANCEL')", [id]);
});
test("ordered two-step delivery pauses and stops remaining steps on reply", async () => {
  const id = await make(
    [
      { type: "TEXT", body: "Halo" },
      {
        type: "VIDEO",
        body: "Demo",
        media_url: "https://example.com/demo.mp4",
      },
    ],
    ["628133333333"],
  );
  await tested(id);
  await db.query("select mc_campaign_action($1,'START')", [id]);
  const a = (await db.query("select mc_claim_outbound_v2('test') as r")).rows[0]
    .r;
  assert.equal(a.step_no, 1);
  assert.equal(
    (await db.query("select mc_claim_outbound_v2('test') as r")).rows[0].r,
    null,
  );
  await db.query("select mc_mark_outbound_sent($1,$2)", [
    a.job_id,
    "receipt-1",
  ]);
  await db.query("select mc_campaign_action($1,'PAUSE')", [id]);
  assert.equal(
    (await db.query("select mc_claim_outbound_v2('test') as r")).rows[0].r,
    null,
  );
  await db.query("select mc_campaign_action($1,'RESUME')", [id]);
  await db.query(
    "select mc_ingest_whatsapp('reply','message','628133333333@c.us','628133333333','Berapa harga?',false,false,'{}')",
  );
  assert.equal(
    (
      await db.query(
        "select status from mc_outbound_jobs where campaign_id=$1 and step_no=2",
        [id],
      )
    ).rows[0].status,
    "CANCELLED",
  );
  const ctx = (
    await db.query("select mc_get_ai_context('628133333333@c.us') as r")
  ).rows[0].r;
  assert.equal(ctx.campaigns[0].name, "Campaign");
});
test("UNKNOWN is never re-claimed and anonymous cannot call campaign RPC", async () => {
  const id = await make(undefined, ["628144444444"]);
  await tested(id);
  await db.query("select mc_campaign_action($1,'START')", [id]);
  const a = (await db.query("select mc_claim_outbound_v2('test') as r")).rows[0]
    .r;
  await db.query("select mc_unknown_outbound_job($1,'timeout')", [a.job_id]);
  assert.equal(
    (await db.query("select mc_claim_outbound_v2('test') as r")).rows[0].r,
    null,
  );
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select mc_claim_outbound_v2('evil')"),
    /permission denied/,
  );
  await db.exec("reset role");
});
test("optout after claim suppresses a followup at preflight", async () => {
  await db.query("select mc_campaign_contact_import($1::jsonb)", [
    JSON.stringify([contact("628155555555")]),
  ]);
  await db.exec(
    "insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key,status,attempt_count)values('628155555555@c.us','Follow','FOLLOW_UP','claimed-follow','PROCESSING',1)",
  );
  const j = (
    await db.query(
      "select id from mc_outbound_jobs where idempotency_key='claimed-follow'",
    )
  ).rows[0];
  await db.query("select mc_campaign_optout('628155555555')");
  assert.equal(
    (await db.query("select mc_campaign_preflight($1,1) as r", [j.id])).rows[0]
      .r.allowed,
    false,
  );
});
test("new inbound suppresses already claimed AI reply", async () => {
  await db.exec(
    "insert into mc_inbound_events(external_message_id,chat_id,message_text,received_at)values('old-claimed','628166666666@c.us','Old',now()-interval '1 minute');insert into mc_outbound_jobs(inbound_event_id,chat_id,body,kind,idempotency_key,status,attempt_count)select id,chat_id,'Old reply','AI_REPLY','claimed-ai','PROCESSING',1 from mc_inbound_events where external_message_id='old-claimed';insert into mc_inbound_events(external_message_id,chat_id,message_text)values('new-claimed','628166666666@c.us','New')",
  );
  const j = (
    await db.query(
      "select id from mc_outbound_jobs where idempotency_key='claimed-ai'",
    )
  ).rows[0];
  assert.equal(
    (await db.query("select mc_campaign_preflight($1,1) as r", [j.id])).rows[0]
      .r.allowed,
    false,
  );
});
test("test send preserves existing contact name and labels", async () => {
  const id = await make(undefined, ["628177777777"]);
  await db.exec(
    "update mc_campaign_contacts set name='Real Name',tags='Keep'where phone='628177777777'",
  );
  await db.query("select mc_campaign_test($1,'628177777777')", [id]);
  const c = (
    await db.query(
      "select name,tags from mc_campaign_contacts where phone='628177777777'",
    )
  ).rows[0];
  assert.equal(c.name, "Real Name");
  assert.equal(c.tags, "Keep");
});
test("bot disabled campaign suppresses AI ingestion and failed predecessor cancels remaining step", async () => {
  await db.exec(
    "update mc_outbound_jobs set status='CANCELLED'where status in('PENDING','RETRY','PROCESSING')",
  );
  const id = await make(
    [
      { type: "TEXT", body: "First" },
      { type: "TEXT", body: "Second" },
    ],
    ["628188888888"],
  );
  await db.query("update mc_campaigns set bot_enabled=false where id=$1", [id]);
  await tested(id);
  await db.query("select mc_campaign_action($1,'START')", [id]);
  await db.query(
    "update mc_outbound_jobs set status='SENT',sent_at=now(),provider_message_id='bot-off'where campaign_id=$1 and step_no=1",
    [id],
  );
  await db.query(
    "select mc_ingest_whatsapp('bot-off-inbound','message','628188888888@c.us','628188888888','Hi',false,false,'{}')",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from mc_ai_jobs j join mc_inbound_events e on e.id=j.inbound_event_id where e.external_message_id='bot-off-inbound'",
      )
    ).rows[0].n,
    0,
  );
  const next = await make(
    [
      { type: "TEXT", body: "One" },
      { type: "TEXT", body: "Two" },
    ],
    ["628199999999"],
  );
  await tested(next);
  await db.query("select mc_campaign_action($1,'START')", [next]);
  await db.query(
    "update mc_outbound_jobs set status='FAILED'where campaign_id=$1 and step_no=1",
    [next],
  );
  await db.query("select mc_claim_outbound_v2('test')");
  assert.equal(
    (
      await db.query(
        "select status from mc_outbound_jobs where campaign_id=$1 and step_no=2",
        [next],
      )
    ).rows[0].status,
    "CANCELLED",
  );
});
test("delivery receipts are monotonic and owner CRM edits are audited", async () => {
  await db.query("select mc_campaign_receipt('receipt-1',3)");
  await db.query("select mc_campaign_receipt('receipt-1',2)");
  assert.equal(
    (
      await db.query(
        "select delivery_status from mc_outbound_jobs where provider_message_id='receipt-1'",
      )
    ).rows[0].delivery_status,
    "READ",
  );
  const opp = (await db.query("select id from mc_opportunities limit 1"))
    .rows[0];
  await db.query(
    "select mc_campaign_opportunity_update($1,'WON','Owner verified',null)",
    [opp.id],
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from mc_campaign_audit where action='ADMIN_OPPORTUNITY_UPDATE'",
      )
    ).rows[0].n,
    1,
  );
});
