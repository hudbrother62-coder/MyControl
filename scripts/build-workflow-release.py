"""Build a single n8n canvas from the four maintained production pipelines."""
import json,uuid,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
master={'name':'KENDALIKU v3 - CS + Kampanye + CRM + Kontrol Web','active':False,'nodes':[],'connections':{},'settings':{'executionOrder':'v1','timezone':'Asia/Jakarta','saveDataSuccessExecution':'none','saveDataErrorExecution':'all'},'meta':{'version':'web-exclusions-v3','activation':'Choose this OR the four modular workflows. Never activate both. Requires migrations through 008.'}}
files=['01-waha-inbound','02-ai-worker','03-outbound','04-followup']
for i,f in enumerate(files):
 w=json.loads((root/'workflows/production'/f'{f}.json').read_text());names={n['name']:f'{i+1:02} | '+n['name'] for n in w['nodes']}
 def rewrite(value):
  if isinstance(value,str):
   for old,new in names.items():
    for a,b in [("$('"+old+"')","$('"+new+"')"),('$node["'+old+'"]','$node["'+new+'"]')]:value=value.replace(a,b)
   return value
  if isinstance(value,list):return [rewrite(v)for v in value]
  if isinstance(value,dict):return {k:rewrite(v)for k,v in value.items()}
  return value
 for node in w['nodes']:
  n=rewrite(node);n['name']=names[node['name']];n['id']=str(uuid.uuid5(uuid.NAMESPACE_URL,'mycontrol/v3/'+n['name']))
  x,y=node['position'];n['position']=[x,y+i*1500]
  n.pop('credentials',None)
  master['nodes'].append(n)
 for source,outputs in w['connections'].items():
  out=json.loads(json.dumps(outputs))
  for branches in out.values():
   for links in branches:
    for link in links:link['node']=names[link['node']]
  master['connections'][names[source]]=out
 for n in master['nodes']:
  if n['type']=='n8n-nodes-base.stickyNote':continue
 note={'name':f'{i+1:02} | Panduan Jalur','id':str(uuid.uuid5(uuid.NAMESPACE_URL,'mycontrol/v3/note'+str(i))),'type':'n8n-nodes-base.stickyNote','typeVersion':1,'position':[-1650,i*1500-450],'parameters':{'width':700,'height':200,'content':['## 01 · Pesan masuk dan delivery\nWebhook → normalisasi → dedupe → simpan → ACK. Pesan masuk tetap tersimpan meski bot dikecualikan.','## 02 · Bot CS dan CRM\nBaca kontrol web → claim → cek pengecualian → memori/produk/CRM → Groq → keputusan → antrekan balasan.','## 03 · Pengirim bersama\nCek WAHA → claim satu pesan → siapkan video → preflight terbaru → kirim → receipt. Manual/AI diprioritaskan. UNKNOWN tidak diulang otomatis.','## 04 · Follow-up dan pemulihan\nDispatch bertahap maksimal 25 → pemulihan lease. Pesan baru, opt-out, pengecualian dan takeover menghentikan otomatisasi.'][i]}}
 master['nodes'].append(note)
# Official @devlikeapro/n8n-nodes-waha 2025.2.9, node typeVersion 202502.
# Source: nodes/WAHA/v202502/WAHATriggerV202502.ts + openapi.json.
# The plugin outputs the body directly and responds onReceived internally.
old='01 | WAHA Incoming Webhook';new='01 | WAHA Trigger'
trigger=next(n for n in master['nodes']if n['name']==old)
trigger.update({'name':new,'type':'@devlikeapro/n8n-nodes-waha.wahaTrigger','typeVersion':202502,'parameters':{},'webhookId':str(uuid.uuid5(uuid.NAMESPACE_URL,'mycontrol/waha-trigger/v4')),'notesInFlow':True,'notes':'Install community node @devlikeapro/n8n-nodes-waha. Copy Production URL to WAHA session, subscribe message + message.ack. Restrict endpoint to WAHA via private network or reverse proxy; this trigger has no built-in Header Auth.'})
trigger.pop('credentials',None)
master['connections'].pop(old)
# Official 202502 ordering: session.status, message, reaction, message.any, message.ack, ...
outputs=[[]for _ in range(26)]
for index in [1,4]:outputs[index]=[{'node':'01 | Normalize WAHA Event','type':'main','index':0}]
master['connections'][new]={'main':outputs}
removed={'01 | ACK 200 Accepted','01 | ACK 200 Ignored'}
master['nodes']=[n for n in master['nodes']if n['name']not in removed]
for name in list(master['connections']):
 if name in removed:del master['connections'][name];continue
 for branches in master['connections'][name].values():
  for i,links in enumerate(branches):branches[i]=[e for e in links if e['node']not in removed]
for n in master['nodes']:
 if n['type']=='n8n-nodes-base.stickyNote'and n['name'].startswith('01 |'):
  n['parameters']['content']='## 01 · WAHA Trigger\nInstall @devlikeapro/n8n-nodes-waha. Connect message (output 1) + message.ack (output 4) → normalisasi → simpan/dedupe atau receipt. Copy Production URL ke session WAHA. Trigger memberi ACK otomatis; jangan menambahkan Respond to Webhook. Batasi akses endpoint melalui jaringan privat atau reverse proxy karena node ini tidak memiliki Header Auth.'
master['name']='KENDALIKU v4 - WAHA Trigger + CS + Kampanye + CRM'
master['meta'].update({'version':'waha-trigger-v4','requiredCommunityNodes':{'@devlikeapro/n8n-nodes-waha':'2025.2.9'},'triggerTypeVersion':202502,'listenEvents':['message','message.ack'],'security':'WAHA Trigger does not validate Header Auth. Restrict incoming access at reverse proxy/private network.'})
(root/'workflows/release/Kendaliku_MyControl_v3_All_In_One.json').write_text(json.dumps(master,indent=2,ensure_ascii=False)+'\n')
