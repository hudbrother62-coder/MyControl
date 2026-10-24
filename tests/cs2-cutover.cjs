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
test("current production and staged CS2 references both match the verified account",()=>{
 const production=read("workflows/release/Kendaliku_MyControl_v3_All_In_One.json");
 assert.match(node(production,"03 | Check WAHA Working").parameters.url,/sessions\/CS2/);
 for(const w of [all,ingress,outbound]){
  const names=new Set(w.nodes.map(n=>n.name));
  for(const con of Object.values(w.connections))for(const stream of Object.values(con))
    for(const links of stream)for(const dest of links)assert.ok(names.has(dest.node));
 }
});
test("production outbound and inbound now strictly accept WORKING CS2, not the old alias",()=>{
 const primary=read("workflows/release/Kendaliku_MyControl_v3_All_In_One.json");
 const outbound=read("workflows/production/03-outbound.json");
 const ingress=read("workflows/production/01-waha-inbound.json");
 for(const [workflow,name,urlName] of [
   [primary,"03 | WAHA Working Only","03 | Check WAHA Working"],
   [outbound,"WAHA Working Only","Check WAHA Working"],
 ]){
   const code=node(workflow,name).parameters.jsCode;
   const fn=(name,id,lid)=>vm.runInNewContext("(function(){"+code+"})()",
     {$json:{status:"WORKING",name,me:{id,lid}}});
   assert.match(node(workflow,urlName).parameters.url,/sessions\/CS2/);
   assert.equal(fn("CSNEW2","6283186750567@c.us","208770441470075@lid").length,0);
   assert.equal(fn("CS2","6283186750567@c.us","208770441470075@lid").length,1);
   assert.equal(fn("CS2","6285167465305@c.us","208770441470075@lid").length,0);
   assert.equal(fn("CS2","6283186750567@c.us","99999@lid").length,0);
 }
 for(const [workflow,name] of [[primary,"01 | Normalize WAHA Event"],[ingress,"Normalize WAHA Event"]]){
   const code=node(workflow,name).parameters.jsCode;
   const fn=(session)=>vm.runInNewContext("(function(){"+code+"})()",
     {$json:{session,me:{id:"6283186750567@c.us",lid:"208770441470075@lid"},
       event:"message",payload:{id:"evt",from:"628123456789@c.us",body:"hi"}}})[0].json;
   assert.equal(fn("CS2").valid,true);
   assert.equal(fn("CSNEW2").valid,false);
 }
});

test("DB cutover migrates only unsent drafts and preserves Excel names and AI-off",()=>{
 const sql=fs.readFileSync("database/068_waha_cs2_session_same_number.sql","utf8");
 assert.match(sql,/target_session/);
 assert.match(sql,/'CS2'/);
 assert.match(sql,/status='DRAFT'/);
 assert.match(sql,/NOT EXISTS\(SELECT 1 FROM public\.mc_outbound_jobs/);
 assert.doesNotMatch(sql,/last_seen\s*=\s*now\(\)/);
 assert.doesNotMatch(sql,/mc_campaign_heartbeat/);
 assert.match(sql,/'recipient_names_from_excel',v_named/);
 assert.match(sql,/'bot_enabled',false/);
 assert.match(sql,/'ai_auto_reply',false/);
 assert.match(sql,/'followup_enabled',false/);
});
