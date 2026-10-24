import {db,rpc} from './database';
import {sessionReadiness,SessionInfo,SenderSelection,WorkerInfo} from '../session-policy';
export const inboundPath='/webhook/e7585b63-a38c-5cea-b0c6-4b7a8e8ea587/waha';
export async function sessionConfig(){
 const [rows,controls]=await Promise.all([db('bot_settings?select=value&key=eq.prime_store_waha_cutover&limit=1'),rpc('mc_read_web_controls')]);
 const raw=rows?.[0]?.value;if(!raw)throw new Error('Konfigurasi sesi belum tersedia');
 const selection:SenderSelection={session:raw.target_session,sender:raw.target_me_id,lid:raw.target_lid,changedAt:raw.session_selected_at,revision:raw.session_revision||1};
 const n8n=String(controls?.settings?.n8n_base_url||process.env.N8N_BASE_URL||'').replace(/\/+$/,'');
 return {raw,selection,webhook:n8n+inboundPath};
}
export async function waha(path:string,method='GET',body?:unknown){
 const base=String(process.env.WAHA_BASE_URL||'').trim().replace(/\/+$/,'');
 const key=process.env.WAHA_API_KEY;
 if(!base||!key)throw new Error('WAHA_CONFIG_MISSING: koneksi WAHA belum dikonfigurasi pada server');
 for(let attempt=0;attempt<(method==='GET'?2:1);attempt++){
  let response:Response;
  try {response=await fetch(base+path,{method,headers:{'X-Api-Key':key,Accept:'application/json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000),cache:'no-store'});}catch{if(method==='GET'&&attempt===0)continue;throw new Error('WAHA_TIMEOUT_OR_NETWORK: server WAHA tidak merespons; periksa DNS/TLS dan jaringan');}
  if(!response.ok){if(response.status>=500&&method==='GET'&&attempt===0)continue;throw new Error('WAHA_HTTP_'+response.status+': '+(response.status===401||response.status===403?'API key atau izin server ditolak':response.status===404?'Sesi atau endpoint tidak ditemukan':response.status===422?'Operasi tidak didukung atau parameter ditolak engine':'Gateway menolak operasi; periksa log WAHA'));}
  const text=await response.text();if(!text)return null;
  try{return JSON.parse(text);}catch{throw new Error('WAHA_INVALID_RESPONSE: gateway tidak mengembalikan JSON');}
 }
 throw new Error('WAHA_UNAVAILABLE');
}
export function sessionName(value:unknown){if(typeof value!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new Error('Nama sesi harus 1–100 karakter huruf, angka, garis bawah atau tanda hubung');return value;}
export async function auditSession(action:string,detail:Record<string,unknown>){await db('mc_campaign_audit',{method:'POST',body:JSON.stringify({action:'OWNER_WAHA_'+action,detail})});}
export function webhookMatches(info:SessionInfo,url:string){return !!info.config?.webhooks?.some(w=>w.url===url&&['message','message.ack'].every(e=>w.events?.includes(e)));}
export async function sessionDashboard(){
 const config=await sessionConfig();
 const runtime:WorkerInfo[]=await db('mc_campaign_runtime?select=session_name,last_seen,image_supported,settings_revision,worker_contract');
 let sessions:SessionInfo[]=[],apiError:string|null=null;
 try{const data=await waha('/api/sessions?all=true');sessions=Array.isArray(data)?data:data?.sessions;if(!Array.isArray(sessions))throw new Error('WAHA_INVALID_SESSION_LIST');const info=await waha('/api/sessions/'+encodeURIComponent(config.selection.session));sessions=sessions.filter(x=>x.name!==info.name).concat(info);}catch(e){apiError=(e as Error).message;}
 const selected=sessions.find(x=>x.name===config.selection.session);
 const worker=runtime.find(x=>x.session_name===config.selection.session)||null;
 const state=selected?sessionReadiness(selected,config.selection,worker):{ready:false,identity:false,heartbeat:false,synced:false,image:false,reason:apiError||'Sesi terpilih tidak ditemukan'};
 const inbound=!!selected&&webhookMatches(selected,config.webhook);
 return {selection:config.selection,checkedAt:new Date().toISOString(),ready:!apiError&&state.ready&&inbound,error:apiError||state.reason||(!inbound?'Webhook inbound belum dikonfigurasi':null),health:{database:true,waha:!apiError,session:selected?.status==='WORKING',identity:state.identity,worker:state.heartbeat,heartbeat:worker?.last_seen||null,n8n:state.heartbeat,dynamic:state.synced,workflowEvidence:worker?.worker_contract||'Heartbeat worker produksi; kontrak sesi dinamis belum dikonfirmasi',image:state.image,inbound},sessions:sessions.map(s=>({name:s.name,status:s.status,number:s.me?.id?.split('@')[0]||null,accountName:s.me?.pushName||null,sender:s.me?.id||null,lid:s.me?.lid||null,engine:typeof s.engine==='object'?(s.engine as {engine?:string})?.engine:s.engine||null,selected:s.name===config.selection.session,heartbeat:runtime.find(r=>r.session_name===s.name)?.last_seen||null})),worker};
}
export async function assertCampaignSender(id:string){
 const config=await sessionConfig();
 const [campaigns,runtime,info]=await Promise.all([db('mc_campaigns?select=session_name&id=eq.'+encodeURIComponent(id)+'&limit=1'),db('mc_campaign_runtime?select=session_name,last_seen,image_supported,settings_revision,worker_contract&session_name=eq.'+encodeURIComponent(config.selection.session)+'&limit=1'),waha('/api/sessions/'+encodeURIComponent(config.selection.session))]);
 if(campaigns?.[0]?.session_name!==config.selection.session)throw new Error('Sesi draft berbeda dari pengirim utama. Gunakan draft baru untuk sesi ini; draft lama tetap aman.');
 const selection={...config.selection,revision:config.raw.session_manager_enabled?config.selection.revision:undefined};
 const state=sessionReadiness(info,selection,runtime?.[0]||null);
 if(!state.ready)throw new Error(state.reason||'Pengirim belum siap');
 if(config.raw.session_manager_enabled&&!webhookMatches(info,config.webhook))throw new Error('Webhook inbound belum sinkron');
}
