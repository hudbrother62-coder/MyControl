import { createSign } from "node:crypto";
import { authorize, apiError } from "@/lib/server/session";
import { db, rpc } from "@/lib/server/database";

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1IPnxqxjCNJE5rY1cXu88XCfZgApQ0u_NxjD-KoGF5VI";
const HEADERS = [
  "product_id","product_name","status","base_price","cost_hpp","promo_price",
  "promo_start","promo_end","short_description","full_description","benefits",
  "demo_url","checkout_url","keywords","delivery_type","updated_at",
  "faq_qna","objection_handling","target_customer","feature_review_status",
] as const;
type Row = Record<string, string>;

async function accessToken() {
  const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const sa = JSON.parse(raw) as {client_email:string;private_key:string};
  if (!sa.client_email?.endsWith(".gserviceaccount.com") || !sa.private_key?.includes("PRIVATE KEY"))
    throw new Error("Google service account belum valid");
  const now = Math.floor(Date.now()/1000);
  const b64 = (value:unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const jwt = b64({alg:"RS256",typ:"JWT"})+"."+b64({
    iss:sa.client_email,scope:"https://www.googleapis.com/auth/spreadsheets",
    aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3000
  });
  const sig = createSign("RSA-SHA256").update(jwt).sign(sa.private_key,"base64url");
  const result = await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:jwt+"."+sig}),
    cache:"no-store",signal:AbortSignal.timeout(12000)
  });
  if (!result.ok) throw new Error("Google menolak akses service account");
  const data = await result.json() as {access_token?:string};
  if (!data.access_token) throw new Error("Google tidak mengirim access token");
  return data.access_token;
}

async function writeBack(row:Row) {
  const token = await accessToken();
  if (!token) return {synced:false,warning:"Koneksi editor Google Sheets belum aktif. Produk telah disimpan di My Control; perubahan sedang menunggu sinkronisasi ke Sheet."};
  const origin = "https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(SHEET_ID);
  const headers = {Authorization:"Bearer "+token,"content-type":"application/json"};
  const current = await fetch(origin+"/values/"+encodeURIComponent("Products!A2:T500"),{
    headers,signal:AbortSignal.timeout(15000),cache:"no-store"
  });
  if (!current.ok) throw new Error("Tidak dapat membaca spreadsheet (HTTP "+current.status+")");
  const values = (await current.json() as {values?:string[][]}).values||[];
  const found = values.findIndex((line)=>line[0]===row.product_id);
  const old = found>=0?(values[found]||[]):[];
  const merged = HEADERS.map((field,index)=>{
    if(field==="updated_at") return new Date().toISOString();
    return Object.hasOwn(row,field)?String(row[field]??""):String(old[index]??"");
  });
  const range = found>=0?"Products!A"+(found+2)+":T"+(found+2):"Products!A:T";
  const url = found>=0?
    origin+"/values/"+encodeURIComponent(range)+"?valueInputOption=RAW":
    origin+"/values/"+encodeURIComponent(range)+":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS";
  const result = await fetch(url,{
    method:found>=0?"PUT":"POST",headers,body:JSON.stringify({majorDimension:"ROWS",values:[merged]}),
    signal:AbortSignal.timeout(15000),cache:"no-store"
  });
  if (!result.ok) throw new Error("Google Sheets menolak penyimpanan (HTTP "+result.status+"). Pastikan service account mendapat akses Editor.");
  return {synced:true,warning:""};
}

export async function GET(req:Request) {
  try {
    authorize(req);
    const id = new URL(req.url).searchParams.get("id")||"";
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(id)) return Response.json({error:"ID produk tidak valid"},{status:400});
    const data = await rpc("mc_product_knowledge_detail",{p_id:id});
    if (!data) return Response.json({error:"Produk tidak ditemukan"},{status:404});
    return Response.json({product:data,google_write_configured:!!process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON},
      {headers:{"cache-control":"no-store"}});
  } catch(error) {return apiError(error);}
}

export async function PUT(req:Request) {
  try {
    authorize(req,true);
    const body=await req.json() as {product?:Record<string,unknown>};
    if (!body.product || typeof body.product!=="object")
      return Response.json({error:"Formulir pengetahuan tidak valid"},{status:400});
    const record:Row={};
    for (const key of HEADERS) {
      if (key==="updated_at" || key==="promo_start" || key==="promo_end") continue;
      if (Object.hasOwn(body.product,key)) record[key] = String(body.product[key]??"").trim();
    }
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(record.product_id||""))
      return Response.json({error:"ID produk tidak valid"},{status:400});
    if (!record.product_name || !["ACTIVE","INACTIVE","DRAFT"].includes(record.status||""))
      return Response.json({error:"Nama dan status produk wajib diisi"},{status:400});
    // Durable, atomic write to Supabase; database triggers refresh the AI knowledge.
    const saved = await rpc("mc_save_product_knowledge",{p_row:record,p_sheet_id:SHEET_ID});
    let sheet_synced=false,warning="";
    try {
      const sync=await writeBack(record);
      sheet_synced=sync.synced; warning=sync.warning;
      if (sheet_synced) await rpc("mc_ack_product_sheet",{p_id:record.product_id,p_row:record});
    } catch(err) {
      warning="Produk tersimpan di My Control, tetapi belum tersinkron ke Google Sheets: "+(err instanceof Error?err.message:"Akses Google bermasalah");
    }
    return Response.json({ok:true,saved,sheet_synced,warning},
      {headers:{"cache-control":"no-store"}});
  } catch(error) {return apiError(error);}
}
