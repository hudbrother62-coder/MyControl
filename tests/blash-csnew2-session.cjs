const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

test("Blash-only migration pins new and paused campaigns to CSNEW2", () => {
  const sql = fs.readFileSync(
    "database/059_blash_only_csnew2_session.sql",
    "utf8",
  );
  assert.match(sql, /SET session_name='CSNEW2'/);
  assert.match(sql, /'session_name','CSNEW2'/);
  assert.match(sql, /'ai_auto_reply',false/);
  assert.match(sql, /'followup_enabled',false/);
});
