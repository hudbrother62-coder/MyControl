import {telegramCall} from "@/lib/telegram";
export const dynamic="force-dynamic";
export async function GET(){
 const configured=Boolean(process.env.TELEGRAM_BOT_TOKEN);
 if(!configured) return Response.json({configured:false,connected:false,ownerConfigured:Boolean(process.env.TELEGRAM_OWNER_CHAT_ID)});
 try{
  const [me,hook]=await Promise.all([telegramCall("getMe"),telegramCall("getWebhookInfo")]);
  return Response.json({configured:true,connected:true,bot:{id:me.id,username:me.username,firstName:me.first_name},webhook:{url:hook.url||"",pending:hook.pending_update_count||0,lastError:hook.last_error_message||null},ownerConfigured:Boolean(process.env.TELEGRAM_OWNER_CHAT_ID)});
 }catch(e){return Response.json({configured:true,connected:false,error:e instanceof Error?e.message:"Telegram error"},{status:200})}
}
