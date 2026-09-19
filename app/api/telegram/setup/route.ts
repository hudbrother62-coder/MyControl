import {getTelegramWebhookSecret,telegramCall} from "@/lib/telegram";
export const dynamic="force-dynamic";

async function setup(req:Request){
 const origin=new URL(req.url).origin;
 const webhookUrl=`${origin}/api/telegram/webhook`;
 try{
  const result=await telegramCall("setWebhook",{
   url:webhookUrl,
   secret_token:getTelegramWebhookSecret(),
   allowed_updates:["message"],
   drop_pending_updates:false
  });
  return Response.json({ok:true,webhookUrl,result});
 }catch(e){
  return Response.json({ok:false,error:e instanceof Error?e.message:"Gagal mengaktifkan webhook"},{status:500});
 }
}

export async function GET(req:Request){return setup(req)}
export async function POST(req:Request){return setup(req)}
