const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('void control ACK and heartbeat RPCs preserve an execution item after successful HTTP response',()=>{
 for(const file of ['02-ai-worker','03-outbound','04-followup']){
  const w=JSON.parse(fs.readFileSync('workflows/production/'+file+'.json'));
  for(const n of w.nodes.filter(n=>/Acknowledge Controls Version|Campaign Worker Heartbeat/.test(n.name))){
   assert.equal(n.alwaysOutputData,true,file+': '+n.name+' must continue after a 204 response');
   assert.notEqual(n.onError,'continueRegularOutput','failed ACK must still stop execution');
  }
 }
});
test('AI and outbound polling bound idle pickup latency to two seconds',()=>{
 for(const file of ['02-ai-worker','03-outbound']){
  const w=JSON.parse(fs.readFileSync('workflows/production/'+file+'.json'));
  const trigger=w.nodes.find(n=>n.type==='n8n-nodes-base.scheduleTrigger');
  assert.ok(trigger.parameters.rule.interval[0].secondsInterval<=2,file);
 }
});
