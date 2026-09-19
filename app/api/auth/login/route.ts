import {NextResponse} from "next/server";

const url="https://vpneonfehqfsxclqcman.supabase.co";
const key="sb_publishable_YkREgaElAb6fR4QnhhMFtA_7IOQldgd";

export async function POST(req:Request){
  try{
    const body=await req.json();
    const username=String(body?.username||"").trim();
    const password=String(body?.password||"");
    if(!username||!password) return NextResponse.json({ok:false,error:"Username dan password wajib diisi."},{status:400});

    const r=await fetch(url+"/rest/v1/rpc/login_mycontrol",{
      method:"POST",
      headers:{
        apikey:key,
        "content-type":"application/json"
      },
      body:JSON.stringify({p_username:username,p_password:password}),
      cache:"no-store"
    });
    const raw=await r.text();
    let data:any=null;
    try{data=JSON.parse(raw)}catch{}
    if(!r.ok){
      const message=data?.message||data?.hint||"Login gagal";
      return NextResponse.json({ok:false,error:message},{status:401});
    }
    const row=Array.isArray(data)?data[0]:data;
    if(!row?.session_token) return NextResponse.json({ok:false,error:"Session tidak terbentuk."},{status:401});
    return NextResponse.json({ok:true,sessionToken:row.session_token,role:row.role,expiresAt:row.expires_at});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Login gagal"},{status:500});
  }
}
