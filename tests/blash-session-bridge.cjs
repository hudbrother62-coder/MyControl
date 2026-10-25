const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");

let db;
test.before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.bot_settings(key text primary key, value jsonb not null);
    create table public.mc_campaigns (
      id uuid primary key default gen_random_uuid(),
      status text not null, session_name text not null,
      recipient_count integer not null
    );
    insert into public.bot_settings(key,value)
    values('prime_store_waha_cutover','{"target_session":"CS2"}'::jsonb);

    -- Reproduce the original legacy gate from production. It must continue to
    -- reject CS2 directly, but the outer save wrapper should bridge it safely.
    create function public.mc_save_campaign_before_sessions(p_campaign jsonb)
    returns jsonb language plpgsql as $func$
    declare v_id uuid;
    begin
      if coalesce(p_campaign->>'session_name','default') <> 'default' then
        raise exception 'Rilis ini mendukung satu sesi default';
      end if;
      insert into public.mc_campaigns(status,session_name,recipient_count)
      values('DRAFT','CS2',jsonb_array_length(p_campaign->'phones'))
      returning id into v_id;
      return jsonb_build_object('id',v_id);
    end $func$;
  `);
  await db.exec(fs.readFileSync("database/073_campaign_selected_session_legacy_bridge.sql","utf8"));
});
test.after(async () => db?.close());

async function save(number) {
  const phones = Array.from({length:number},(_,i)=>
    "62819"+String(i).padStart(8,"0"));
  return (await db.query("select public.mc_save_campaign($1::jsonb) as saved", [
    JSON.stringify({session_name:"CS2",name:"QA",phones})
  ])).rows[0].saved;
}

test("legacy default-only guard is safely bridged for 180 and 600 CS2 recipients",async()=>{
  for(const size of [180,600]){
    const result=await save(size);
    assert.equal(result.session_name,"CS2");
    assert.equal(result.session_bridge,"legacy_default_compatible");
    const campaign=(await db.query("select * from public.mc_campaigns where id=$1",[result.id])).rows[0];
    assert.equal(campaign.status,"DRAFT");
    assert.equal(campaign.session_name,"CS2");
    assert.equal(campaign.recipient_count,size);
  }
});

test("stale browser session cannot silently route to the new sender",async()=>{
  await assert.rejects(
    db.query("select public.mc_save_campaign($1::jsonb)",[
      JSON.stringify({session_name:"OLD_SESSION",phones:["628199999999"]})
    ]),/Sesi pengirim berubah/);
});

test("no selected WhatsApp session fails closed before saving any draft",async()=>{
  const before=(await db.query("select count(*)::int n from public.mc_campaigns")).rows[0].n;
  await db.exec("update public.bot_settings set value='{}'::jsonb where key='prime_store_waha_cutover'");
  await assert.rejects(save(1),/Sesi WhatsApp aktif belum tersedia/);
  assert.equal((await db.query("select count(*)::int n from public.mc_campaigns")).rows[0].n,before);
  await db.exec("update public.bot_settings set value='{\"target_session\":\"CS2\"}'::jsonb where key='prime_store_waha_cutover'");
});

test("unprivileged caller cannot save a campaign through SECURITY DEFINER",async()=>{
  await db.exec("set role anon");
  await assert.rejects(save(1),/permission denied/i);
  await db.exec("reset role");
});
