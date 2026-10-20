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
