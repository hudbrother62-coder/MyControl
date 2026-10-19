import {authorize,apiError} from "@/lib/server/session";
import {db,rpc} from "@/lib/server/database";
type Config={phase?:string;target_session?:string;target_me_id?:string;target_lid?:string;previous_session?:string;route_active?:boolean};
export async function GET(req:Request){
 try{
  authorize(req);
  const [data,control]=await Promise.all([
   db("bot_settings?select=value&key=eq.prime_store_waha_cutover&limit=1"),
   rpc("mc_read_web_controls")
  ]);
  const conf=(data?.[0]?.value??null) as Config|null;
  if(!conf)return Response.json({configured:false,active:false,ready:false,status:"NOT_CONFIGURED"});
  const result={configured:true,active:conf.route_active===true,ready:false,identity_verified:false,
   phase:conf.phase??"PREPARED_WAITING_WORKING",
   target_session:conf.target_session??"CS2",
   target_me_id:conf.target_me_id??"6283186750567@c.us",
   target_lid:conf.target_lid??"208770441470075@lid",
   previous_session:conf.previous_session??null,status:"NOT_CHECKED"};
  const base=String(control?.settings?.waha_base_url||process.env.WAHA_BASE_URL||"").trim().replace(/\/+$/,"");
  const key=process.env.WAHA_API_KEY;
  if(!base||!key)return Response.json({...result,error:"Koneksi autentikasi WAHA belum tersedia di server"});
  try{
   const url=base+"/api/sessions/"+encodeURIComponent(result.target_session);
   const resp=await fetch(url,{headers:{"X-Api-Key":key},cache:"no-store",signal:AbortSignal.timeout(7000)});
   if(!resp.ok)return Response.json({...result,status:"UNAVAILABLE",error:"WAHA HTTP "+resp.status});
   const session=await resp.json();
   const match=session?.name===result.target_session&&session?.me?.id===result.target_me_id&&
    (session?.me?.lid==null||session.me.lid===result.target_lid);
   const status=String(session?.status||"UNKNOWN");
   return Response.json({...result,status,identity_verified:match,ready:status==="WORKING"&&match,
    error:status==="WORKING"&&!match?"Identitas WAHA tidak cocok dengan target CS2":undefined},{headers:{"Cache-Control":"no-store"}});
  }catch(e){
   return Response.json({...result,status:"UNAVAILABLE",error:e instanceof Error?e.message:"Pemeriksaan WAHA gagal"},{headers:{"Cache-Control":"no-store"}});
  }
 }catch(e){return apiError(e)}
}
