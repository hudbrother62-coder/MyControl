const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const folder="workflows/cutover/CS2/";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const all=read(folder+"KENDALIKU-v4-CS2-STAGED-DO-NOT-IMPORT.json");
const ingress=read(folder+"01-WAHA-INBOUND-STAGED.json");
const outbound=read(folder+"03-OUTBOUND-STAGED.json");
const node=(w,n)=>{const result=w.nodes.find(x=>x.name===n);assert.ok(result,n);return result};
test("staged copies are inactive and contain no embedded credentials",()=>{
 for(const w of [all,ingress,outbound]){
  assert.equal(w.active,false);assert.equal(w.meta.cutover.target_session,"CS2");
  assert.equal(w.meta.cutover.target_account,"6283186750567@c.us");
  for(const n of w.nodes)assert.equal(n.credentials,undefined);
 }
});
test("CS2 inbound rejects old identity/session and allows new one",()=>{
 const js=node(all,"01 | Normalize WAHA Event").parameters.jsCode;
 const act=(session,id)=>vm.runInNewContext("(function(){"+js+"})()",{$json:{session,me:{id},event:"message",payload:{id:"x1",from:"628123456789@c.us",body:"halo"}}})[0].json;
 assert.equal(act("CS2","6283186750567@c.us").valid,true);
 assert.equal(act("CS2","6285167465305@c.us").valid,false);
 assert.equal(act("old","6283186750567@c.us").valid,false);
});
test("CS2 outbound accepts only WORKING with exact account",()=>{
 const js=node(all,"03 | WAHA Working Only").parameters.jsCode;
 const run=(status,name,id)=>vm.runInNewContext("(function(){"+js+"})()",{$json:{status,name,me:{id}}});
 assert.equal(run("STOPPED","CS2","6283186750567@c.us").length,0);
 assert.equal(run("WORKING","CS2","6285167465305@c.us").length,0);
 assert.equal(run("WORKING","CS2","6283186750567@c.us").length,1);
 assert.match(node(all,"03 | Check WAHA Working").parameters.url,/sessions\/CS2/);
});
test("original production definitions remain unchanged, staged references connect",()=>{
 const production=read("workflows/release/Kendaliku_MyControl_v3_All_In_One.json");
 assert.match(node(production,"03 | Check WAHA Working").parameters.url,/session_01m51sr28e6ytwpjrgyk15aecr/);
 for(const w of [all,ingress,outbound]){
  const names=new Set(w.nodes.map(n=>n.name));
  for(const con of Object.values(w.connections))for(const stream of Object.values(con))
    for(const links of stream)for(const dest of links)assert.ok(names.has(dest.node));
 }
});