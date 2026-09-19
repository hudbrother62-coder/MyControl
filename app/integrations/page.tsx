"use client";
import {useEffect,useState} from "react";
const sheet="https://docs.google.com/spreadsheets/d/1IPnxqxjCNJE5rY1cXu88XCfZgApQ0u_NxjD-KoGF5VI/edit";

type Tg={configured:boolean;connected:boolean;ownerConfigured?:boolean;bot?:{username?:string;firstName?:string};webhook?:{url?:string;pending?:number;lastError?:string|null};error?:string};

export default function Integrations(){
 const [tg,setTg]=useState<Tg|null>(null);const [msg,setMsg]=useState("");
 async function load(){try{const r=await fetch("/api/telegram/status",{cache:"no-store"});setTg(await r.json())}catch{setTg({configured:false,connected:false,error:"Status gagal dibaca"})}}
 useEffect(()=>{load()},[]);
 async function setup(){setMsg("Mengaktifkan webhook...");const r=await fetch("/api/telegram/setup",{method:"POST"});const d=await r.json();setMsg(d.ok?"Webhook Telegram aktif. Sekarang kirim /start ke bot.":d.error||"Gagal");if(d.ok)await load()}
 const items=[["Sheets","Google Sheets","Master produk / promo / FAQ","Connected",sheet],["DB","Supabase","Database produksi","Belum terbaca",""],["n8n","n8n","Automation engine lokal","Ready dipasang",""],["WA","WAHA","WhatsApp gateway","Belum",""],["PAY","Payment","DANA / GoPay / Bank","Belum",""]];
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
 <div className="grid2 section">{items.map(([abbr,name,desc,status,url])=><div className="card integration" key={name}><div className="integrationName"><div className="logoBox">{abbr}</div><div><b>{name}</b><div className="tiny muted">{desc}</div></div></div><div className="actions">{url&&<a className="btn" href={url} target="_blank">Buka</a>}<span className={"badge "+(status==="Connected"?"ok":"warn")}>{status}</span></div></div>)}</div>
 <div className="notice section"><b>Telegram sudah dibuat sesederhana mungkin:</b> kalau token bot valid, cukup satu tombol untuk mengaktifkan webhook. Tidak perlu membuat secret manual lagi.</div></>
}