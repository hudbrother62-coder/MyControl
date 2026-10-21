const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs'), test = require('node:test'), assert = require('node:assert/strict');
let db;
const read = name => fs.readFileSync(`database/${name}.sql`, 'utf8');
test.before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const name of ['001_queue','002_reliability','003_business_sync','005_campaigns','008_contact_exclusions']) {
    await db.exec(read(name).replace('create extension if not exists pgcrypto;', ''));
  }
  await db.exec(`alter table mc_campaign_contacts add column owner_promo_disabled boolean not null default false;
    alter table mc_campaign_contacts add column consent_evidence text;
    alter table mc_campaign_runtime add column image_supported boolean not null default true;
    create table bot_settings(key text primary key, value jsonb);`);
  await db.exec(read('040_blash_one_time_recipient'));
  await db.exec(read('043_blash_ai_reply_preflight'));
  await db.exec('alter function mc_campaign_action(uuid,text,timestamptz) rename to mc_campaign_action_before_direct_send;');
  const direct = read('054_prime_store_safe_dispatch_and_ai_batch').match(/CREATE OR REPLACE FUNCTION public\.mc_campaign_action\([\s\S]*?\$act\$;/)[0];
  await db.exec(direct);
  await db.exec(read('065_align_blast_readiness_with_permission'));
  await db.exec(read('066_campaign_record_documented_permission'));
  if (fs.existsSync('database/068_allow_repeat_blash.sql')) await db.exec(read('068_allow_repeat_blash'));
  await db.exec("insert into mc_campaign_runtime(session_name,worker_id,image_supported) values('default','test',true)");
});
test.after(async () => { if (db) await db.close(); });
async function campaign(phone, options = {}) {
  await db.query(`insert into mc_campaign_contacts(phone,name,consent,consent_evidence,source)
    values($1,'Test',true,'Customer requested school offers','DIRECT') on conflict(phone) do nothing`, [phone]);
  const id = (await db.query(`insert into mc_campaigns(name,product_id,steps,bot_enabled)
    values('Repeat test','SP001','[{"type":"TEXT","body":"Halo {{nama}}"}]',false) returning id`)).rows[0].id;
  await db.query("insert into mc_campaign_recipients(campaign_id,phone,name,excluded_reason) values($1,$2,'Test',$3)", [id,phone,options.reason ?? null]);
  return id;
}
test('a previously blasted phone is eligible in a new campaign, with no duplicate jobs on repeated START', async () => {
  const phone = '628111111111';
  const first = await campaign(phone);
  await db.query("select mc_campaign_action($1,'START')", [first]);
  await db.query("update mc_outbound_jobs set status='SENT',provider_message_id='confirmed-first' where campaign_id=$1", [first]);
  // Legacy reservations must not prevent a new campaign after the policy change.
  await db.query('insert into mc_campaign_one_time_phones(phone,campaign_id) values($1,$2) on conflict do nothing', [phone,first]);
  const second = await campaign(phone);
  const ready = (await db.query('select mc_campaign_readiness($1) r',[second])).rows[0].r;
  assert.equal(ready.eligible_total, 1);
  assert.equal(ready.already_blasted_total, 0);
  await db.query("select mc_campaign_action($1,'START')", [second]);
  await db.query("select mc_campaign_action($1,'START')", [second]);
  assert.equal((await db.query('select count(*)::int n from mc_outbound_jobs where campaign_id=$1',[second])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from mc_outbound_jobs where campaign_id=$1 and status='SENT'",[first])).rows[0].n, 1);
});
test('repeat campaigns still exclude opted-out and owner-disabled contacts', async () => {
  for (const [phone,field] of [['628222222222','opted_out_at=now()'],['628333333333','owner_promo_disabled=true']]) {
    const id = await campaign(phone);
    await db.query(`update mc_campaign_contacts set ${field} where phone=$1`, [phone]);
    assert.equal((await db.query('select mc_campaign_readiness($1) r',[id])).rows[0].r.eligible_total, 0);
    await assert.rejects(db.query("select mc_campaign_action($1,'START')", [id]), /Tidak ada penerima/);
    assert.equal((await db.query('select count(*)::int n from mc_outbound_jobs where campaign_id=$1',[id])).rows[0].n, 0);
  }
});
test('migration clears only legacy repeat exclusions in drafts and is safe to reapply', async () => {
  const draft = await campaign('628444444444', {reason:'Sudah pernah masuk Blash lain'});
  const blocked = await campaign('628555555555', {reason:'Pengecualian owner'});
  const completed = await campaign('628666666666', {reason:'Sudah pernah masuk Blash lain'});
  await db.query("update mc_campaigns set status='COMPLETED' where id=$1", [completed]);
  assert.ok(fs.existsSync('database/068_allow_repeat_blash.sql'), 'repeat policy migration exists');
  await db.exec(read('068_allow_repeat_blash'));
  await db.exec(read('068_allow_repeat_blash'));
  const reason = async id => (await db.query('select excluded_reason from mc_campaign_recipients where campaign_id=$1',[id])).rows[0].excluded_reason;
  assert.equal(await reason(draft), null);
  assert.equal(await reason(blocked), 'Pengecualian owner');
  assert.equal(await reason(completed), 'Sudah pernah masuk Blash lain');
});
