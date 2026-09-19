import {ownerAllowed,sendTelegram} from "@/lib/telegram";
export async function POST(req:Request){
 const secret=(process.env.TELEGRAM_WEBHOOK_SECRET||"").trim();
 if(secret && req.headers.get("x-telegram-bot-api-secret-token")!==secret) return new Response("unauthorized",{status:401});
 const update=await req.json();
 const msg=update?.message;
 if(!msg?.chat?.id) return Response.json({ok:true});
 const chatId=msg.chat.id; const text=String(msg.text||"").trim(); const cmd=text.split(/\s+/)[0].toLowerCase();
 if(!ownerAllowed(chatId)){
  await sendTelegram(chatId,"Bot ini hanya digunakan untuk owner My Control.");
  return Response.json({ok:true});
 }
 if(cmd==="/start"){
  const ownerSet=Boolean(process.env.TELEGRAM_OWNER_CHAT_ID);
  await sendTelegram(chatId,ownerSet
   ?"<b>My Control terhubung.</b>\n\nPerintah: /status · /rekap · /pending · /closing · /payment · /help"
   :`<b>Bot My Control aktif.</b>\n\nChat ID kamu: <code>${chatId}</code>\nMasukkan nilai ini sebagai <code>TELEGRAM_OWNER_CHAT_ID</code> di Vercel agar bot terkunci hanya untuk kamu.`);
 }else if(cmd==="/status"){
  await sendTelegram(chatId,"<b>Status My Control</b>\n\n✅ Web: aktif\n✅ Telegram: aktif\n✅ Google Sheets: siap\n⏳ Supabase: tahap koneksi\n⏳ n8n: tahap koneksi\n⏳ WAHA: belum");
 }else if(["/rekap","/pending","/closing","/payment"].includes(cmd)){
  await sendTelegram(chatId,"Data produksi belum bisa dibaca dari Telegram karena Supabase belum tersambung ke backend. Bot sudah terhubung; setelah database dipasang, perintah ini langsung membaca data yang sama dengan web.");
 }else{
  await sendTelegram(chatId,"<b>Perintah My Control</b>\n/start — cek koneksi\n/status — status ekosistem\n/rekap — rekap hari ini\n/pending — lead pending\n/closing — closing\n/payment — antrean pembayaran\n/help — bantuan");
 }
 return Response.json({ok:true});
}
