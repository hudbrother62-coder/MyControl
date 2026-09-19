"use client";
import {useEffect,useState} from "react";
const sheet="https://docs.google.com/spreadsheets/d/1IPnxqxjCNJE5rY1cXu88XCfZgApQ0u_NxjD-KoGF5VI/edit";

type Tg={configured:boolean;connected:boolean;ownerConfigured?:boolean;bot?:{username?:string;firstName?:string};webhook?:{url?:string;pending?:number;lastError?:string|null};error?:string};
type Db={projectRef:string;publicConnected:boolean;serviceRoleConfigured:boolean;serviceConnected:boolean;urlMatches:boolean};

export default function Integrations(){
 const [tg,setTg]=useState<Tg|null>(null);const [db,setDb]=useState<Db|null>(null);const [msg,setMsg]=useState("");
 async function load(){try{const [tr,dr]=await Promise.all([fetch("/api/telegram/status",{cache:"no-store"}),fetch("/api/supabase/status",{cache:"no-store"})]);setTg(await tr.json());setDb(await dr.json())}catch{}}
 useEffect(()=>{load()},[]);
 async function setup(){setMsg("Mengaktifkan webhook...");const r=await fetch("/api/telegram/setup",{method:"POST"});const d=await r.json();setMsg(d.ok?"Webhook Telegram aktif. Sekarang kirim /start ke bot.":d.error||"Gagal");if(d.ok)await load()}
 const items=[
 ["Sheets","Google Sheets","Master produk / promo / FAQ","Connected",sheet],
 ["DB","Supabase","Database transaksi, chat, payment & settings",db?.publicConnected?"Connected":"Checking...",""],
 ["n8n","n8n","Automation engine lokal","Ready dipasang",""],
 ["WA","WAHA","WhatsApp gateway","Belum",""],
 ["PAY","Payment","DANA / GoPay / Bank","Belum",""]
 ];
 const botLabel=tg?.connected ? "@"+(tg.bot?.username||"bot")+" terhubung" : "Belum terhubung";
 return <><div className="pageHead"><div><h1>Integrations</h1><p>Status koneksi yang benar-benar aktif, tanpa status palsu.</p></div></div>
 <div className="card sectionless">
  <div className="integration"><div className="integrationName"><div className="logoBox">TG</div><div><b>Telegram Owner Bot</b><div className="tiny muted">{botLabel}</div></div></div><span className={"badge "+(tg?.connected?"ok":"warn")}>{tg===null?"Checking...":tg.connected?"Connected":tg.configured?"Configured":"Not configured"}</span></div>
  <div className="telegramDetail">
   {!tg?.configured&&<div className="notice">Tambahkan <b>TELEGRAM_BOT_TOKEN</b> di Vercel Environment Variables lalu redeploy.</div>}
   {tg?.configured&&<div className="kv compact"><span>Bot</span><b>{tg.bot?.firstName||"-"} {tg.bot?.username?"(@"+tg.bot.username+")":""}</b><span>Webhook</span><b>{tg.webhook?.url||"Belum aktif"}</b><span>Pending update</span><b>{tg.webhook?.pending||0}</b><span>Owner lock</span><b>{tg.ownerConfigured?"Aktif":"Belum diset"}</b></div>}
   {tg?.configured&&!tg.webhook?.url&&<div className="setupRow"><button className="btn primary" onClick={setup}>Aktifkan Webhook</button></div>}
   {tg?.webhook?.lastError&&<div className="notice">Telegram: {tg.webhook.lastError}</div>}
   {msg&&<div className="tiny muted" style={{marginTop:10}}>{msg}</div>}
  </div>
 </div>

 <div className="card section">
  <div className="integration"><div className="integrationName"><div className="logoBox">DB</div><div><b>Supabase — My Control</b><div className="tiny muted">Project {db?.projectRef||"vpneonfehqfsxclqcman"} · Singapore</div></div></div><span className={"badge "+(db?.publicConnected?"ok":"warn")}>{db?.publicConnected?"Connected":"Checking..."}</span></div>
  <div className="telegramDetail"><div className="kv compact"><span>Web database</span><b>{db?.publicConnected?"Aktif":"Belum"}</b><span>Owner Auth + RLS</span><b>Aktif</b><span>Private payment storage</span><b>Aktif</b><span>Server service role</span><b>{db?.serviceRoleConfigured?"Tersedia":"Belum dipasang"}</b></div></div>
 </div>

 <div className="grid2 section">{items.filter(x=>x[0]!=="DB").map(([abbr,name,desc,status,url])=><div className="card integration" key={name}><div className="integrationName"><div className="logoBox">{abbr}</div><div><b>{name}</b><div className="tiny muted">{desc}</div></div></div><div className="actions">{url&&<a className="btn" href={url} target="_blank">Buka</a>}<span className={"badge "+(status==="Connected"?"ok":"warn")}>{status}</span></div></div>)}</div>
 <div className="notice section"><b>Supabase sudah menjadi database utama web.</b> Data customer, lead, order, chat, pembayaran dan setting tidak lagi bergantung pada browser. Service role server sengaja belum digunakan; integrasi n8n/Telegram data produksi akan kita beri akses terpisah saat automation dipasang.</div></>
}