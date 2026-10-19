// Read-only WAHA diagnostics; do not create, switch, or restart sessions.
export type WahaProbe={status:string;ready:boolean;identity_verified:boolean;error?:string;error_code?:string;http_status?:number};
export async function probeWahaSession(args:{baseUrl:string;apiKey:string;session:string;meId?:string;lid?:string}):Promise<WahaProbe>{
 const base=args.baseUrl.trim().replace(/\/+$/,"");
 const headers={"X-Api-Key":args.apiKey,"Accept":"application/json"};
 const options={headers,cache:"no-store" as const,signal:AbortSignal.timeout(7000)};
 try{
  const response=await fetch(base+"/api/sessions/"+encodeURIComponent(args.session),options);
  if(response.status===404){
   try{
    const all=await fetch(base+"/api/sessions?all=true",options);
    if(all.status===401||all.status===403) return {status:"UNAVAILABLE",ready:false,identity_verified:false,http_status:all.status,error_code:"AUTH_REJECTED",error:"WAHA menolak API key"};
    if(all.status===404)return {status:"UNAVAILABLE",ready:false,identity_verified:false,http_status:404,error_code:"WAHA_API_ROUTE_NOT_FOUND",error:"Endpoint sesi dan daftar sesi WAHA sama-sama 404: periksa reverse proxy, base URL, dan jalur /api"};
    if(!all.ok)return {status:"UNAVAILABLE",ready:false,identity_verified:false,http_status:all.status,error_code:"SESSION_LIST_FAILED",error:"Gagal membaca daftar sesi WAHA (HTTP "+all.status+")"};
    const body=await all.json();
    const sessions=Array.isArray(body)?body:Array.isArray(body?.sessions)?body.sessions:[];
    const exists=sessions.some((x:{name?:string})=>x?.name===args.session);
    return {status:"UNAVAILABLE",ready:false,identity_verified:false,http_status:404,error_code:exists?"SESSION_LOOKUP_404":"SESSION_NOT_FOUND",error:exists?"Daftar WAHA berisi sesi target tetapi GET detail 404":"Sesi "+args.session+" tidak ditemukan. Tidak beralih otomatis ke sesi lain"};
   }catch{return {status:"UNAVAILABLE",ready:false,identity_verified:false,http_status:404,error_code:"SESSION_LOOKUP_404",error:"Detail sesi WAHA 404; daftar sesi tidak dapat diperiksa"};}
  }
  if(response.status===401||response.status===403)return {status:"UNAVAILABLE",ready:false,identity_verified:false,http_status:response.status,error_code:"AUTH_REJECTED",error:"WAHA menolak API key"};
  if(!response.ok)return {status:"UNAVAILABLE",ready:false,identity_verified:false,http_status:response.status,error_code:"WAHA_HTTP_ERROR",error:"WAHA HTTP "+response.status};
  const info=await response.json();
  const match=info?.name===args.session&&(!args.meId||info?.me?.id===args.meId)&&(!args.lid||info?.me?.lid==null||info.me.lid===args.lid);
  const status=String(info?.status||"UNKNOWN");
  return {status,ready:status==="WORKING"&&match,identity_verified:match,
   error_code:!match?"IDENTITY_MISMATCH":status!=="WORKING"?"SESSION_NOT_WORKING":undefined,
   error:!match?"Identitas nomor/LID WAHA tidak cocok":status!=="WORKING"?"Sesi WAHA belum WORKING":undefined};
 }catch{return {status:"UNAVAILABLE",ready:false,identity_verified:false,error_code:"WAHA_NETWORK_ERROR",error:"WAHA tidak terjangkau: periksa DNS, TLS, dan jaringan server"};}
}
