const {PGlite}=require("@electric-sql/pglite");
const fs=require("node:fs");
const test=require("node:test");
const assert=require("node:assert/strict");
let pg;
test.before(async()=>{
  pg=new PGlite();
  await pg.exec(`
    create role anon;create role authenticated;create role service_role;
    create table mc_campaign_contacts(
      phone text primary key,name text not null,tags text not null default '',
      source text not null default '',consent boolean not null default false,
      consent_at timestamptz,opted_out_at timestamptz,
      consent_evidence text not null default '',updated_at timestamptz default now()
    );
    create table mc_contact_exclusions(phone text primary key,scope text);
    create table mc_campaign_audit(action text,detail jsonb);
  `);
  await pg.exec(fs.readFileSync("database/052_bulk_owner_contact_promo_consent.sql","utf8"));
  await pg.exec(`
    insert into mc_campaign_contacts(phone,name,tags,source,consent,opted_out_at)values
    ('628111111111','Alpha','school','WhatsApp CS',false,null),
    ('628222222222','Stop','school','WhatsApp CS',false,now()),
    ('628333333333','Excluded','school','WhatsApp CS',false,null),
    ('628444444444','Already','school','WhatsApp CS',true,null),
    ('628555555555','Hidden','school','CAMPAIGN_ONLY_STAGED',false,null),
    ('628666666666','Other','personal','WhatsApp CS',false,null);
    insert into mc_contact_exclusions values('628333333333','PROMOTION');
  `);
});
test.after(async()=>pg?.close());
const grant=async(phones,all,search,evidence="Formulir persetujuan pelanggan tertanggal 2026-10-20")=>
  (await pg.query("select mc_bulk_contact_promo_consent($1,$2,$3,$4) result",
    [phones,all,search,evidence])).rows[0].result;
test("selected bulk grants only eligible contacts and keeps opt-outs",async()=>{
  const r=await grant(["628111111111","628222222222","628333333333","628444444444"],false,"");
  assert.equal(r.updated,1);
  assert.equal(r.already_allowed,1);
  assert.equal(r.skipped,2);
  const rows=(await pg.query("select phone,consent,opted_out_at from mc_campaign_contacts order by phone")).rows;
  assert.equal(rows.find(r=>r.phone==="628111111111").consent,true);
  assert.equal(rows.find(r=>r.phone==="628222222222").consent,false);
  assert.equal(rows.find(r=>r.phone==="628333333333").consent,false);
});
test("all-filtered includes contacts outside the current UI page, not staged contacts",async()=>{
  const r=await grant([],true,"personal");
  assert.equal(r.updated,1);
  assert.equal((await pg.query("select consent from mc_campaign_contacts where phone='628666666666'")).rows[0].consent,true);
  const s=await grant([],true,"school");
  assert.equal(s.requested,4);
  assert.equal((await pg.query("select consent from mc_campaign_contacts where phone='628555555555'")).rows[0].consent,false);
});
test("requires evidence and keeps the function owner-only",async()=>{
  await assert.rejects(()=>grant(["628111111111"],false,"",""));
  assert.equal((await pg.query("select has_function_privilege('anon','mc_bulk_contact_promo_consent(text[],boolean,text,text)','execute') allowed")).rows[0].allowed,false);
  assert.equal((await pg.query("select has_function_privilege('authenticated','mc_bulk_contact_promo_consent(text[],boolean,text,text)','execute') allowed")).rows[0].allowed,false);
});
