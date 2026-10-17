import {createSign} from "node:crypto";
import {authorize,apiError} from "@/lib/server/session";
import {db,rpc} from "@/lib/server/database";

const DEFAULT_SHEET_ID="1IPnxqxjCNJE5rY1cXu88XCfZgApQ0u_NxjD-KoGF5VI";
const expectedHeaders=["product_id","product_name","status","base_price","cost_hpp","promo_price",
 "promo_start","promo_end","short_description","full_description","benefits","demo_url","checkout_url",
 "keywords","delivery_type","updated_at","faq_qna","objection_handling","target_customer","feature_review_status"];
function getSheetId(){
 const id=process.env.GOOGLE_SHEET_ID||DEFAULT_SHEET_ID;
 if(!/^[A-Za-z0-9_-]{20,100}$/.test(id))throw new Error("Google Sheet ID tidak valid");
 return id;
}
function configured(){
 return !!(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_SHEETS_API_KEY);
}
async function googleAccessToken(){
 const raw=process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
 if(!raw)return null;
 let sa:{client_email:string;private_key:string;token_uri?:string};
 try{sa=JSON.parse(raw)}catch{throw new Error("Format service account Google tidak valid")}
 if(!sa.client_email?.endsWith(".gserviceaccount.com")||!sa.private_key?.includes("PRIVATE KEY"))
  throw new Error("Credential Google Sheets tidak valid");
 const now=Math.floor(Date.now()/1000);
 const base64=(data:unknown)=>Buffer.from(JSON.stringify(data)).toString("base64url");
 const unsigned=base64({alg:"RS256",typ:"JWT"})+"."+base64({iss:sa.client_email,scope:"https://www.googleapis.com/auth/spreadsheets.readonly",
  aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3500});
 const signature=createSign("RSA-SHA256").update(unsigned).sign(sa.private_key,"base64url");
 const token=await fetch("https://oauth2.googleapis.com/token",{
  method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:unsigned+"."+signature}),
  signal:AbortSignal.timeout(15000),cache:"no-store"
 });
 if(!token.ok)throw new Error("Akses Google ditolak. Bagikan sheet ke email service account sebagai Viewer.");
 const data=await token.json();if(!data.access_token)throw new Error("Token Google tidak tersedia");
 return String(data.access_token);
}
async function sync(){
 if(!configured())throw new Error("Koneksi Google belum diaktifkan: isi GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON di Vercel dan bagikan spreadsheet ke email service account (Viewer).");
 const id=getSheetId();
 const token=await googleAccessToken();
 const key=process.env.GOOGLE_SHEETS_API_KEY;
 if(!token&&!key)throw new Error("Google credential belum terpasang");
 const url="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(id)+"/values/"+encodeURIComponent("Products!A1:T500")+
  (token?"":"?key="+encodeURIComponent(key||""));
 const response=await fetch(url,{headers:token?{Authorization:"Bearer "+token}:{},signal:AbortSignal.timeout(18000),cache:"no-store"});
 if(!response.ok)throw new Error(response.status===403?"Akses sheet ditolak. Berikan Viewer ke service account.":"Google Sheets tidak dapat dibaca (HTTP "+response.status+").");
 const body=await response.json();
 const rows:string[][]=body.values||[];
 if(!rows.length||expectedHeaders.some((h,i)=>rows[0][i]!==h))throw new Error("Header sheet Products tidak sesuai format master (A:T)");
 const products=rows.slice(1).filter(x=>x[0]&&x[1]).map(row=>
  Object.fromEntries(expectedHeaders.map((k,i)=>[k,typeof row[i]==="string"?row[i]:""])));
 if(products.length===0)throw new Error("Sheet belum berisi produk valid. Sinkronisasi dibatalkan untuk menjaga database.");
 const result=await rpc("mc_apply_product_sheet",{p_sheet_id:id,p_rows:products});
 return result;
}
export async function GET(req:Request){
 try{
  authorize(req);
  const status=await db("mc_sheet_sync_runs?select=sheet_id,rows_updated,synced_at,source&order=synced_at.desc&limit=1");
  return Response.json({sheet_id:getSheetId(),configured:configured(),latest:status[0]||null},{
   headers:{"Cache-Control":"no-store"}});
 }catch(e){return apiError(e)}
}
export async function POST(req:Request){
 try{
  const cronToken=process.env.CRON_SECRET;
  const isCron=!!cronToken&&req.headers.get("authorization")==="Bearer "+cronToken;
  if(!isCron)authorize(req,true);
  const result=await sync();
  return Response.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(e){return apiError(e)}
}
