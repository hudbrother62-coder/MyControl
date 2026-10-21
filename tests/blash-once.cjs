const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const sql=fs.readFileSync("database/040_blash_one_time_recipient.sql","utf8");
const ui=fs.readFileSync("components/CampaignEditor.tsx","utf8");
const parser=fs.readFileSync("lib/campaigns.ts","utf8");
test("one-time number is reserved atomically across campaigns with exception for test send",()=>{
 assert.match(sql,/phone text primary key/);
 assert.match(sql,/on conflict\(phone\)do nothing/);
 assert.match(sql,/if not c\.is_test then/);
 assert.match(sql,/once\.campaign_id=c\.id/);
 assert.match(sql,/Sudah pernah masuk Blash lain/);
});
test("readiness reports skipped numbers and importer supports exact user Excel",()=>{
 assert.match(sql,/already_blasted_total/);
 assert.match(parser,/parseBlashImportRows/);
 assert.match(parser,/"nama", "name"/);
 assert.match(parser,/"nomor", "phone"/);
 assert.match(ui,/Number\.isSafeInteger\(value\)/);
 assert.match(ui,/parsed\.contacts\.map\(contact=>contact\.phone\)/);
});
