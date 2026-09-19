const api=(token:string,method:string)=>`https://api.telegram.org/bot${token}/${method}`;

export async function telegramCall(method:string, body:Record<string,unknown>={}){
 const token=process.env.TELEGRAM_BOT_TOKEN;
 if(!token) throw new Error("TELEGRAM_BOT_TOKEN belum dikonfigurasi");
 const r=await fetch(api(token,method),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
 const data=await r.json();
 if(!r.ok || !data.ok) throw new Error(data.description || `Telegram ${method} gagal`);
 return data.result;
}

export async function sendTelegram(chatId:string|number,text:string){
 return telegramCall("sendMessage",{chat_id:chatId,text,parse_mode:"HTML",disable_web_page_preview:true});
}

export function ownerAllowed(chatId:string|number){
 const owner=(process.env.TELEGRAM_OWNER_CHAT_ID||"").trim();
 return !owner || owner===String(chatId);
}
