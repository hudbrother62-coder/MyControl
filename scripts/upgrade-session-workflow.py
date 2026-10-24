"""Upgrade an exported KENDALIKU workflow in place; preserve IDs and credentials."""
import json,sys,uuid,copy
w=json.load(open(sys.argv[1]))
assert w['id']=='sBxYeXeIGD2OvaLV'
nodes={n['name']:n for n in w['nodes']}
check=nodes['03 | Check WAHA Working']
check['parameters']['url']="={{String($('03 | Read Web Controls').first().json.settings.waha_base_url || $env.WAHA_BASE_URL || '').trim().replace(/\\/+$/, '') + '/api/sessions/' + encodeURIComponent($('03 | Read Web Controls').first().json.settings.waha_session)}}"
nodes['03 | WAHA Working Only']['parameters']['jsCode']="""const c=$('03 | Read Web Controls').first().json.settings;
if($json.status!=='WORKING'||$json.name!==c.waha_session||$json.me?.id!==c.waha_sender_id||($json.me?.lid&&c.waha_sender_lid&&$json.me.lid!==c.waha_sender_lid))throw new Error('WAHA_SESSION_OR_IDENTITY_MISMATCH');
return [{json:{working:true,session_name:$json.name,sender_id:$json.me.id}}];"""
beat=nodes['03 | Campaign Worker Heartbeat']
beat['parameters']['url']="={{$env.SUPABASE_URL + '/rest/v1/rpc/mc_session_worker_heartbeat'}}"
beat['parameters']['body']="={{JSON.stringify({p_worker:$env.N8N_WORKER_ID||'n8n-v2',p_session:$('03 | Check WAHA Working').first().json.name,p_sender:$('03 | Check WAHA Working').first().json.me.id,p_lid:$('03 | Check WAHA Working').first().json.me.lid||'',p_revision:$('03 | Read Web Controls').first().json.settings.waha_revision,p_video:$env.WAHA_VIDEO_VERIFIED==='true',p_image:true})}}"
readname='01 | Read Session Configuration'
if readname not in nodes:
 read=copy.deepcopy(nodes['03 | Read Web Controls']);read.update(id=str(uuid.uuid5(uuid.NAMESPACE_URL,'mycontrol-session-config-v1')),name=readname,position=[-160,0]);w['nodes'].append(read)
 for output in w['connections']['01 | WAHA Trigger']['main']:
  for edge in output:
   if edge['node']=='01 | Normalize WAHA Event':edge['node']=readname
 w['connections'][readname]={'main':[[{'node':'01 | Normalize WAHA Event','type':'main','index':0}]]}
norm=nodes['01 | Normalize WAHA Event']['parameters']['jsCode']
start=norm.index('const id=')
nodes['01 | Normalize WAHA Event']['parameters']['jsCode']="""const event=$('01 | WAHA Trigger').first().json;
const b=event.body??event,p=b.payload??b,k=p.key??{};
const c=$json.settings??{};
const accountAllowed=b.session===c.waha_session&&b.me?.id===c.waha_sender_id&&(!b.me?.lid||!c.waha_sender_lid||b.me.lid===c.waha_sender_lid);
"""+norm[start:]
w['active']=False
w.pop('pinData',None)
json.dump(w,open(sys.argv[2],'w'),indent=2)
print('Upgraded',w['id'],'with',len(w['nodes']),'nodes; credential refs and webhook ID preserved')
