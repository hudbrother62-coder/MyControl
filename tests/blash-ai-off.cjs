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
