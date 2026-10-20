const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

test("legacy AI trigger is not exposed as a public RPC", () => {
  const sql = fs.readFileSync(
    "database/058_revoke_legacy_ai_trigger_rpc.sql",
    "utf8",
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.apply_ai_decision_from_message\(\) FROM PUBLIC;/,
  );
  assert.match(sql, /FROM anon;/);
  assert.match(sql, /FROM authenticated;/);
});
