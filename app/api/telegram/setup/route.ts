import {telegramCall} from "@/lib/telegram";
export async function POST(req:Request){
 const configuredSecret=(process.env.TELEGRAM_WEBHOOK_SECRET||"").trim();
 const supplied=(req.headers.get("x-telegram-setup-secret")||"").trim();
 if(!configuredSecret) return Response.json({ok:false,error:"TELEGRAM_WEBHOOK_SECRET belum diset di Vercel"},{status:400});
 if(supplied!==configuredSecret) return Response.json({ok:false,error:"Secret setup salah"},{status:401});
 const origin=new URL(req.url).origin;
 const webhookUrl=`${origin}/api/telegram/webhook`;
 try{
  const result=await telegramCall("setWebhook",{url:webhookUrl,secret_token:configuredSecret,allowed_updates:["message"]});
  return Response.json({ok:true,webhookUrl,result});
 }catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:"Gagal mengaktifkan webhook"},{status:500})}
}
