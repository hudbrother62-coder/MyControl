const fs=require('node:fs'),test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const w=JSON.parse(fs.readFileSync('workflows/release/Kendaliku_MyControl_v3_All_In_One.json','utf8'));
const nodes=new Map(w.nodes.map(n=>[n.name,n]));
const next=name=>(w.connections[name]?.main||[]).flat().map(e=>e.node);
function expression(value, data, env={}) { return vm.runInNewContext('('+value.replace(/^=\{\{/, '').replace(/\}\}\s*$/, '')+')', {$:name=>({first:()=>({json:data[name]})}), $env:env}); }
test('WAHA session and send URLs trim trailing slashes and whitespace',()=>{
 const data={'03 | Read Web Controls':{settings:{waha_base_url:' https://waha.example/// '}},'03 | Claim Outbound Job':{}};
 assert.equal(expression(nodes.get('03 | Check WAHA Working').parameters.url,data,{WAHA_SESSION:' active-session '}),'https://waha.example/api/sessions/active-session');
 assert.equal(expression(nodes.get('03 | WAHA Send Text').parameters.url,data),'https://waha.example/api/sendText');
});
test('WAHA text and video expressions produce valid payloads using the verified session',()=>{
 const job={session_name:'default',chat_id:'test@c.us',body:'Hello'};
 const data={'03 | Claim Outbound Job':job,'03 | Check WAHA Working':{name:'active-session'},'03 | Sign Private Video':{signedURL:'/object/sign/video?token=test'}};
 const body=nodes.get('03 | WAHA Send Text').parameters.body;
 assert.deepEqual(JSON.parse(expression(body,data)),{session:'active-session',chatId:'test@c.us',text:'Hello'});
 job.media_url='https://media.example/promo.mp4';
 assert.equal(JSON.parse(expression(body,data)).file.url,job.media_url);
 job.media_url='storage://private/promo.mp4';
 assert.equal(JSON.parse(expression(body,data,{SUPABASE_URL:'https://db.example'})).file.url,'https://db.example/storage/v1/object/sign/video?token=test');
});
test('single inactive release retains all four triggers and local connections',()=>{assert.equal(w.active,false);assert.equal(w.nodes.filter(n=>n.type==='n8n-nodes-base.webhook').length,0);assert.equal(w.nodes.filter(n=>n.type==='@devlikeapro/n8n-nodes-waha.wahaTrigger').length,1);assert.equal(w.nodes.filter(n=>n.type==='n8n-nodes-base.scheduleTrigger').length,3);assert.equal(nodes.size,w.nodes.length);for(const [source,outputs]of Object.entries(w.connections)){assert.ok(nodes.has(source));for(const branches of Object.values(outputs))for(const links of branches)for(const e of links)assert.ok(nodes.has(e.node),e.node)}for(const n of w.nodes){for(const match of JSON.stringify(n.parameters).matchAll(/\$\('([^']+)'\)/g))assert.ok(nodes.has(match[1]),match[1])}});
test('AI only calls model after database exclusion gate allows contact',()=>{assert.deepEqual(next('02 | AI Job Found?'),['02 | Check Web Contact Exclusion']);assert.deepEqual(next('02 | Check Web Contact Exclusion'),['02 | Allow CS Automation Only']);const code=nodes.get('02 | Allow CS Automation Only').parameters.jsCode;const run=allowed=>vm.runInNewContext('(function(){'+code+'})()',{$json:{allowed},$:()=>({first:()=>({json:{job_id:'x'}})})});assert.equal(run(false).length,0);assert.equal(run(true)[0].json.job_id,'x');assert.deepEqual(next('02 | Allow CS Automation Only'),['02 | Load Supabase Memory + Knowledge'])});
test('text and private video converge on live preflight before transport',()=>{assert.deepEqual(next('03 | Sign Private Video').slice(0,1),['03 | Preflight Before Send']);assert.ok(next('03 | Private Media?').includes('03 | Preflight Before Send'));assert.deepEqual(next('03 | Preflight Before Send'),['03 | Allow Send Only']);assert.deepEqual(next('03 | Allow Send Only'),['03 | WAHA Send Text']);const send=nodes.get('03 | WAHA Send Text');assert.equal(send.retryOnFail,false);assert.ok(send.parameters.url.includes('/api/sendVideo'));const gate=nodes.get('03 | Allow Send Only').parameters.jsCode;assert.equal(vm.runInNewContext('(function(){'+gate+'})()',{$json:{allowed:false}}).length,0)});
test('release has no embedded credentials, secrets or removed delivery handling',()=>{for(const n of w.nodes)assert.equal(n.credentials,undefined);assert.ok(nodes.has('01 | Persist Delivery Receipt'));assert.ok(nodes.has('03 | Mark Outbound UNKNOWN'));assert.ok(nodes.has('04 | Recover Expired Queue Leases'));assert.ok(nodes.has('02 | Commit AI Decision + Schedule Follow-ups'));assert.equal(w.settings.saveDataSuccessExecution,'none')});

test('official WAHA trigger routes only message and ack outputs, and owns its response',()=>{
 const trigger=nodes.get('01 | WAHA Trigger');assert.ok(trigger);assert.equal(trigger.typeVersion,202502);assert.equal(trigger.parameters.responseMode,undefined);assert.ok(trigger.webhookId);
 const outputs=w.connections[trigger.name].main;assert.equal(outputs.length,26);
 for(let i=0;i<26;i++)assert.equal(outputs[i].length,[1,4].includes(i)?1:0);
 assert.equal(outputs[1][0].node,'01 | Normalize WAHA Event');assert.equal(outputs[4][0].node,'01 | Normalize WAHA Event');
 assert.equal(w.nodes.filter(n=>n.type==='n8n-nodes-base.respondToWebhook').length,0);
});
test('trigger body supports inbound messages and delivery events without request wrapper',()=>{
 const code=nodes.get('01 | Normalize WAHA Event').parameters.jsCode;
 const run=body=>vm.runInNewContext('(function(){'+code+'})()',{$json:body})[0].json;
 const msg=run({event:'message',payload:{id:'m1',from:'628111111111@c.us',body:'halo',fromMe:false}});assert.equal(msg.valid,true);assert.equal(msg.message_text,'halo');assert.equal(msg.is_ack,false);
 const ack=run({event:'message.ack',payload:{id:'m1',ack:3}});assert.equal(ack.is_ack,true);assert.equal(ack.ack,3);assert.equal(ack.ack_provider_id,'m1');
});

test('AI commit forwards claim attempt from current decision item',()=>{
 const input={attempt_count:2,job_id:'job',decision:{should_reply:true},model_used:'model',slot_used:1,chat_id:'test@lid',reply:'Halo'};
 const body=nodes.get('02 | Commit AI Decision + Schedule Follow-ups').parameters.body;
 const result=JSON.parse(vm.runInNewContext('('+body.replace(/^=\{\{/,'').replace(/\}\}\s*$/,'')+')',{$json:input}));
 assert.equal(result.p_claim_attempt,2);assert.equal(result.p_job_id,'job');assert.equal(result.p_reply,'Halo');
});

test('every quoted node reference in release resolves',()=>{
 for(const n of w.nodes)for(const value of Object.values(n.parameters)){
  const serialized=typeof value==='string'?value:JSON.stringify(value);
  for(const m of serialized.matchAll(/\$\((["'])(.*?)\1\)/g))assert.ok(nodes.has(m[2]),n.name+': '+m[2]);
 }
});


test('poster JPG and PNG route to sendImage with correct media MIME and signed URL',()=>{
 const data={
  '03 | Read Web Controls':{settings:{waha_base_url:'https://waha.example/'}},
  '03 | Claim Outbound Job':{session_name:'default',chat_id:'628123456789@c.us',body:'Halo {{nama}}',media_url:'storage://mycontrol-campaigns/poster.jpg'},
  '03 | Check WAHA Working':{name:'active-session'},
  '03 | Sign Private Video':{signedURL:'/object/sign/mycontrol-campaigns/poster.jpg?token=secret'}
 };
 const url=nodes.get('03 | WAHA Send Text').parameters.url,body=nodes.get('03 | WAHA Send Text').parameters.body;
 assert.equal(expression(url,data),'https://waha.example/api/sendImage');
 let packet=JSON.parse(expression(body,data,{SUPABASE_URL:'https://db.example'}));
 assert.equal(packet.file.mimetype,'image/jpeg');
 assert.equal(packet.file.url,'https://db.example/storage/v1/object/sign/mycontrol-campaigns/poster.jpg?token=secret');
 assert.equal(packet.caption,'Halo {{nama}}');
 data['03 | Claim Outbound Job'].media_url='https://cdn.example.com/poster.png?token=public';
 assert.equal(expression(url,data),'https://waha.example/api/sendImage');
 packet=JSON.parse(expression(body,data));
 assert.equal(packet.file.mimetype,'image/png');
 data['03 | Claim Outbound Job'].media_url='https://cdn.example.com/clip.mp4';
 assert.equal(expression(url,data),'https://waha.example/api/sendVideo');
 assert.equal(JSON.parse(expression(body,data)).file.mimetype,'video/mp4');
 assert.equal(nodes.get('03 | Campaign Worker Heartbeat').parameters.url.includes('mc_campaign_heartbeat_v2'),true);
 assert.equal(JSON.parse(expression(nodes.get('03 | Campaign Worker Heartbeat').parameters.body,data)).p_image,true);
});
