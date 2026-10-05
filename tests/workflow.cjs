const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const w = JSON.parse(fs.readFileSync("workflows/mycontrol.json"));
const nodes = Object.fromEntries(w.nodes.map((n) => [n.name, n]));
function normalize(p) {
  return vm.runInNewContext(
    "(function(){" + nodes["Normalize WAHA Event"].parameters.jsCode + "})()",
    { $json: { body: { event: "message", payload: p } } },
  )[0].json;
}
test("false string and object ID normalize correctly", () => {
  const x = normalize({
    id: { _serialized: "m1" },
    from: "628@c.us",
    fromMe: "false",
    body: "Hi",
  });
  assert.equal(x.from_me, false);
  assert.equal(x.external_message_id, "m1");
});
test("broadcast and invalid ID are rejected", () => {
  assert.equal(normalize({ id: "m1", from: "status@broadcast" }).valid, false);
  assert.equal(normalize({ id: "m2", from: 123 }).valid, false);
});
test("WAHA send never blindly retries", () =>
  assert.notEqual(nodes["WAHA Send Text"].retryOnFail, true));
test("all workflow connections resolve", () => {
  for (const [name, ports] of Object.entries(w.connections)) {
    assert(nodes[name]);
    for (const branches of Object.values(ports))
      for (const b of branches) for (const link of b) assert(nodes[link.node]);
  }
});
test('decision boundary rejects malformed AI output',()=>{assert.throws(()=>vm.runInNewContext('(function(){'+nodes['Use Decision - Slot 1'].parameters.jsCode+'})()',{$json:{output:'invalid'},$:()=>({first:()=>({json:{job_id:'j1'}})}),$env:{GEMINI_PRIMARY_MODEL:'test'}}),/Invalid structured decision/)});
test('provider receipt requires a nonempty ID',()=>{assert.throws(()=>vm.runInNewContext('(function(){'+nodes['Validate WAHA Receipt'].parameters.jsCode+'})()',{$json:{}}),/receipt missing/);const result=vm.runInNewContext('(function(){'+nodes['Validate WAHA Receipt'].parameters.jsCode+'})()',{$json:{id:{_serialized:'wa-message-1'}}});assert.equal(result[0].json.provider_message_id,'wa-message-1')});
