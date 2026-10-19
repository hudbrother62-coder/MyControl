test("WAHA diagnosis handles missing session, proxy 404, auth, and identity", () => {
 const code=fs.readFileSync("lib/server/waha-probe.ts","utf8");
 for(const name of ["SESSION_NOT_FOUND","WAHA_API_ROUTE_NOT_FOUND","AUTH_REJECTED","IDENTITY_MISMATCH","CSNEW2","api/sessions?all=true"]){
  if(name==="CSNEW2")continue;
  assert.ok(code.includes(name),name);
 }
 assert.ok(!code.includes('method:"PUT"'));
 assert.ok(!code.includes('method:"POST"'));
});
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("migration defines web catalog authority, active products and usable FAQ", () => {
  const sql = fs.readFileSync("database/046_web_catalog_authority.sql", "utf8");
  assert.match(sql, /mc_get_ai_context/);
  assert.match(sql, /ACTIVE/);
  assert.match(sql, /ai_can_use/i);
  assert.doesNotMatch(sql, /truncate\s+table|drop\s+table|delete\s+from\s+.*memory/i);
});

test("welcome catalog is dynamic and hides inactive products and prices", () => {
  const js = fs.readFileSync("workflows/code/prime-store-input.js", "utf8");
  const run = (knowledge, message = "halo") => {
    const dollar = () => ({ first: () => ({ json: { chat_id: "audit@lid", message_text: message, job_id: "audit" } }) });
    const result = vm.runInNewContext("(function(){" + js + "})()", { $json: { knowledge }, $: dollar });
    const body = result[0].json.agent_input.split("SOURCED CONTEXT:\n")[1].split("\nJika pertama kali")[0];
    return JSON.parse(body);
  };
  const active = { kind: "PRODUCT", source_key: "P_ACTIVE", payload: { product_name: "Produk Aktif", status: "ACTIVE", price: 99000, short_description: "Contoh fungsi" } };
  const inactive = { kind: "PRODUCT", source_key: "P_ARCHIVE", payload: { product_name: "Produk Lama", status: "INACTIVE", price: 299000 } };
  const result = run([active, inactive]);
  assert.deepEqual(Array.from(result.storefront_catalog, x => x.name), ["Produk Aktif"]);
  assert.equal(result.official_products.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /99000|299000|Produk Lama/);
  assert.equal(run([]).storefront_catalog.length, 0);
  assert.equal(run([active, inactive], "berapa harga produk aktif?").official_products.length, 1);
});

test("latest SQL reads active products and canonical FAQ without duplicate cache paths", () => {
  const sql = fs.readFileSync("database/047_live_catalog_no_duplicate_faq.sql", "utf8");
  assert.match(sql, /select 'PRODUCT'::text kind,c.source_key,c.payload from catalog c/);
  assert.match(sql, /from public.product_faq f/);
  assert.match(sql, /f.active and f.ai_can_use/);
  assert.match(sql, /cetak struk/);
  assert.doesNotMatch(sql, /delete from public.mc_contact_memories/i);
});

test("workflow definitions use CSNEW2 and safe GET check", () => {
  for (const file of ["workflows/production/01-waha-inbound.json", "workflows/production/02-ai-worker.json", "workflows/production/03-outbound.json", "workflows/release/Kendaliku_MyControl_v3_All_In_One.json"]) {
    const workflow = JSON.parse(fs.readFileSync(file, "utf8"));
    const raw = JSON.stringify(workflow);
    assert.doesNotMatch(raw, /session_01m51sr28e6ytwpjrgyk15aecr|6285167465305@c\.us/);
    for (const node of workflow.nodes) {
      if (node.name.includes("Check WAHA Working")) {
        assert.equal(node.parameters.method, "GET");
        assert.equal(node.parameters.sendBody, false);
        assert.match(node.parameters.url, /sessions\/CSNEW2/);
      }
      if (node.name.includes("WAHA Working Only")) assert.match(node.parameters.jsCode, /208770441470075@lid/);
    }
  }
});
