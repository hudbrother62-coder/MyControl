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
(root/'workflows/release/Kendaliku_MyControl_v3_All_In_One.json').write_text(json.dumps(master,indent=2,ensure_ascii=False)+'\n')
