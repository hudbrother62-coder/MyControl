import {authorizeOwner,apiError} from '@/lib/server/session';
import {db,rpc} from '@/lib/server/database';
import {auditSession,sessionConfig,sessionDashboard,sessionName,waha,webhookMatches} from '@/lib/server/whatsapp-sessions';
export const maxDuration=60;
const headers={'Cache-Control':'no-store'};
export async function GET(req:Request){try{authorizeOwner(req);return Response.json(await sessionDashboard(),{headers});}catch(e){return apiError(e);}}
export async function POST(req:Request){
 try{
  authorizeOwner(req,true);const raw=await req.text();if(raw.length>4000)throw new Error('Permintaan terlalu besar');const b=JSON.parse(raw),name=sessionName(b.session),path='/api/sessions/'+encodeURIComponent(name);
  if(b.action==='check')return Response.json(await sessionDashboard(),{headers});
  if(['stop','restart','select'].includes(b.action)&&b.confirm!==true)throw new Error('Konfirmasi diperlukan untuk operasi ini');
  if(b.action==='select'){
   const config=await sessionConfig();
   const liveWorker=await db('mc_campaign_runtime?select=last_seen,worker_contract&session_name=eq.'+encodeURIComponent(config.selection.session)+'&limit=1');
   if(liveWorker?.[0]?.worker_contract!=='session-manager-v1'||Date.now()-new Date(liveWorker[0].last_seen).getTime()>90000)throw new Error('WORKFLOW_UPGRADE_REQUIRED: worker n8n belum menjalankan kontrak sesi dinamis. Sesi belum diganti.');
   if(b.revision!==config.selection.revision)throw new Error('Konfigurasi berubah. Refresh dahulu');
   const info=await waha(path);if(info.status!=='WORKING'||! /^[0-9]+@c\.us$/.test(info.me?.id||''))throw new Error('Sesi belum WORKING atau identitas nomor tidak tersedia');
   // Require the exact identity displayed to the owner; never trust a stale list.
   if(info.me.id!==b.sender||(b.lid&&info.me.lid!==b.lid))throw new Error('IDENTITY_MISMATCH: identitas sesi berubah. Refresh dan periksa nomor');
   const oldConfig=info.config||{};let changed=false;
   try{
    if(!webhookMatches(info,config.webhook)){
     const otherHooks=(oldConfig.webhooks||[]).filter((h:{url:string})=>h.url!==config.webhook);
     await waha(path,'PUT',{name,config:{...oldConfig,webhooks:[...otherHooks,{url:config.webhook,events:['message','message.ack']}]}});changed=true;
     const verified=await waha(path);if(!webhookMatches(verified,config.webhook))throw new Error('WEBHOOK_SYNC_FAILED: WAHA belum menyimpan webhook');
    }
    await rpc('mc_select_waha_session',{p_expected_revision:b.revision,p_session:name,p_sender:info.me.id,p_lid:info.me.lid||'',p_webhook:config.webhook});
   }catch(e){if(changed){try{await waha(path,'PUT',{name,config:oldConfig});}catch{await auditSession('ROLLBACK_FAILED',{session:name});throw new Error('ROLLBACK_FAILED: konfigurasi webhook perlu diperiksa; sesi utama belum diganti');}}throw e;}
   return Response.json({ok:true,message:'Sesi disimpan. Menunggu konfirmasi worker n8n; belum siap sampai heartbeat baru diterima.',...(await sessionDashboard())},{headers});
  }
  if(['stop','restart','start'].includes(b.action)){
   const [busy,queue]=await Promise.all([db('mc_campaigns?select=id&status=in.(RUNNING,SCHEDULED)&limit=1'),db('mc_outbound_jobs?select=id&status=in.(PENDING,RETRY,PROCESSING)&limit=1')]);
   if(busy.length||queue.length)throw new Error('Jeda kampanye aktif sebelum mengubah koneksi sesi');
   await auditSession('SESSION_'+b.action.toUpperCase()+'_REQUESTED',{session:name});
   await waha(path+'/'+b.action,'POST');
   await auditSession('SESSION_'+b.action.toUpperCase(),{session:name});
   return Response.json({ok:true},{headers});
  }
  if(b.action==='create'){await auditSession('SESSION_CREATE_REQUESTED',{session:name});await waha('/api/sessions','POST',{name,start:true,config:{webhooks:[]}});return Response.json({ok:true},{headers});}
  if(b.action==='qr'){const info=await waha(path);if(info.status!=='SCAN_QR_CODE')throw new Error('QR hanya tersedia saat sesi menunggu autentikasi');const qr=await waha('/api/'+encodeURIComponent(name)+'/auth/qr?format=image');if(qr?.mimetype!=='image/png'||typeof qr.data!=='string'||qr.data.length>2000000)throw new Error('QR_IMAGE_UNAVAILABLE: engine belum menyediakan gambar QR');return Response.json({qr:'data:image/png;base64,'+qr.data},{headers});}
  if(b.action==='pair'){if(! /^[1-9][0-9]{7,14}$/.test(b.phone||''))throw new Error('Nomor pairing harus format internasional tanpa +');const info=await waha(path);if(info.status!=='SCAN_QR_CODE')throw new Error('Sesi belum menunggu pairing');const data=await waha('/api/'+encodeURIComponent(name)+'/auth/request-code','POST',{phoneNumber:b.phone});return Response.json({code:data?.code||null},{headers});}
  throw new Error('Tindakan tidak tersedia');
 }catch(e){return apiError(e);}
}
