import {authorize,apiError} from "@/lib/server/session";
import {db,rpc} from "@/lib/server/database";
import {probeWahaSession} from "@/lib/server/waha-probe";
type Config={phase?:string;target_session?:string;target_me_id?:string;target_lid?:string;previous_session?:string;route_active?:boolean};
export async function GET(req:Request){
 try{
  authorize(req);
  const [data,control]=await Promise.all([
   db("bot_settings?select=value&key=eq.prime_store_waha_cutover&limit=1"),
   rpc("mc_read_web_controls")
  ]);
  const conf=(data?.[0]?.value??null) as Config|null;
  if(!conf)return Response.json({configured:false,active:false,ready:false,status:"NOT_CONFIGURED"},{headers:{"Cache-Control":"no-store"}});
  const result={configured:true,active:conf.route_active===true,ready:false,identity_verified:false,
   phase:conf.phase??"PREPARED_WAITING_WORKING",target_session:conf.target_session??"CSNEW2",
   target_me_id:conf.target_me_id??"6283186750567@c.us",
   target_lid:conf.target_lid??"208770441470075@lid",
   previous_session:conf.previous_session??null,status:"NOT_CHECKED"};
  const base=String(control?.settings?.waha_base_url||process.env.WAHA_BASE_URL||"").trim().replace(/\/+$/,"");
  const key=process.env.WAHA_API_KEY;
  if(!base||!key)return Response.json({...result,error:"Koneksi WAHA belum tersedia di server"},{headers:{"Cache-Control":"no-store"}});
  const probe=await probeWahaSession({baseUrl:base,apiKey:key,session:result.target_session,meId:result.target_me_id,lid:result.target_lid});
  return Response.json({...result,...probe},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return apiError(e)}
}
