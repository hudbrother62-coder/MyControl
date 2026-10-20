const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

test("Blash-only save forcibly keeps campaign AI disabled", () => {
  const sql = fs.readFileSync("database/060_blash_campaign_ai_off.sql", "utf8");
  assert.match(sql, /'bot_enabled', false/);
  assert.match(sql, /'ai_auto_reply',false/);
  assert.match(sql, /'followup_enabled',false/);
  assert.match(sql, /SET session_name='CSNEW2'/);
});

test("Blash accepts direct pasted and Excel numbers without Contacts registration", () => {
  const editor = fs.readFileSync("components/CampaignEditor.tsx", "utf8");
  const readiness = fs.readFileSync("database/058_blash_direct_staged_recipients_readiness.sql", "utf8");
  assert.match(editor, /parsePastedNumbers/);
  assert.match(editor, /recipientSource==="paste"/);
  assert.match(editor, /import_contacts:included/);
  assert.match(editor, /Kirim sekarang/);
  assert.match(editor, /action:"START"/);
  assert.match(editor, /setSteps|type:"TEXT"/);
  assert.doesNotMatch(editor, /onClick=\{\(\)=>void save\(\)\}/);
  assert.match(readiness, /eligible_total/);
  assert.match(readiness, /cc\.opted_out_at IS NULL/);
  assert.match(readiness, /NOT cc\.owner_promo_disabled/);
  assert.match(readiness, /mc_campaign_one_time_phones/);
});

test("new Blash uses one user-declared permission source instead of fabricating consent", () => {
  const editor=fs.readFileSync("components/CampaignEditor.tsx","utf8");
  const page=fs.readFileSync("app/campaigns/page.tsx","utf8");
  const api=fs.readFileSync("app/api/campaigns/route.ts","utf8");
  const trigger=fs.readFileSync("database/063_documented_blast_customer_optin.sql","utf8");
  const rpc=fs.readFileSync("database/066_campaign_record_documented_permission.sql","utf8");
  const save=fs.readFileSync("database/067_remove_auto_declared_consent.sql","utf8");
  const readiness=fs.readFileSync("database/065_align_blast_readiness_with_permission.sql","utf8");
  const worker=fs.readFileSync("database/064_worker_claim_permission_guard.sql","utf8");
  assert.match(editor,/listConsentConfirmed/);
  assert.match(editor,/consentSource/);
  assert.match(editor,/consent_evidence:consentSource\.trim\(\)/);
  assert.match(page,/recordPermission/);
  assert.match(api,/mc_campaign_record_permission/);
  assert.match(trigger,/NEW\.opted_out_at IS NOT NULL OR NEW\.owner_promo_disabled/);
  assert.match(trigger,/NEW\.consent_evidence/);
  assert.match(rpc,/cc\.opted_out_at IS NULL/);
  assert.match(rpc,/cc\.owner_promo_disabled/);
  assert.match(rpc,/mc_contact_exclusions/);
  assert.match(readiness,/cc\.consent = true/);
  assert.match(worker,/not cc\.consent/);
  assert.doesNotMatch(save,/'bulk_consent', true/);
});
