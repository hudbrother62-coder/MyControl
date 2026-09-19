"use client";
import {useEffect,useState} from "react";
import {supabase} from "@/lib/supabase-browser";
const sheet="https://docs.google.com/spreadsheets/d/1IPnxqxjCNJE5rY1cXu88XCfZgApQ0u_NxjD-KoGF5VI/edit";

type Tg={configured:boolean;connected:boolean;ownerConfigured?:boolean;bot?:{username?:string;firstName?:string};webhook?:{url?:string;pending?:number;lastError?:string|null};error?:string};
type Db={projectRef:string;publicConnected:boolean};
type IStatus={integration:string;status:string;details:any;last_checked_at?:string|null};

export default function Integrations(){
 const [tg,setTg]=useState<Tg|null>(null);
 const [db,setDb]=useState<Db|null>(null);
 const [ints,setInts]=useState<Record<string,IStatus>>({});
 const [msg,setMsg]=useState("");

 async function load(){
  try{
   const [tr,dr,ir]=await Promise.all([
    fetch("/api/telegram/status",{cache:"no-store"}),
    fetch("/api/supabase/status",{cache:"no-store"}),
    supabase.from("integration_status").select("integration,status,details,last_checked_at")
   ]);
   setTg(await tr.json());
   setDb(await dr.json());
   if(!ir.error)setInts(Object.fromEntries((ir.data||[]).map((x:any)=>[x.integration,x])));
  }catch{}
 }
 useEffect(()=>{load();const id=setInterval(load,15000);return()=>clearInterval(id)},[]);

 async function setup(){
  setMsg("Mengaktifkan webhook...");
  const r=await fetch("/api/telegram/setup",{method:"POST"});
  const d=await r.json();
  setMsg(d.ok?"Webhook Telegram aktif.":d.error||"Gagal");
  if(d.ok)await load();
 }

 const n8n=ints.N8N, waha=ints.WAHA, pay=ints.PAYMENT;
 const connected=(x?:IStatus)=>Boolean(x&&x.status.startsWith("CONNECTED"));
 const botLabel=tg?.connected ? "@"+(tg.bot?.username||"bot")+" terhubung" : "Belum terhubung";

 return <><div className="pageHead"><div><h1>Integrations</h1><p>Status koneksi My Control, automation, dan gateway.</p></div></div>

 <div className="card sectionless">
  <div className="integration"><div className="integrationName"><div className="logoBox">TG</div><div><b>Telegram Owner Bot</b><div className="tiny muted">{botLabel}</div></div></div><span className={"badge "+(tg?.connected?"ok":"warn")}>{tg===null?"Checking...":tg.connected?"Connected":tg.configured?"Configured":"Not configured"}</span></div>
  {tg?.configured&&<div className="telegramDetail"><div className="kv compact"><span>Bot</span><b>{tg.bot?.firstName||"-"} {tg.bot?.username?"(@"+tg.bot.username+")":""}</b><span>Webhook</span><b>{tg.webhook?.url||"Belum aktif"}</b><span>Pending update</span><b>{tg.webhook?.pending||0}</b><span>Owner lock</span><b>{tg.ownerConfigured?"Aktif":"Belum diset"}</b></div></div>}
  {tg?.configured&&!tg.webhook?.url&&<div className="setupRow"><button className="btn primary" onClick={setup}>Aktifkan Webhook</button></div>}
  {msg&&<div className="tiny muted" style={{marginTop:10}}>{msg}</div>}
 </div>

 <div className="card section">
  <div className="integration"><div className="integrationName"><div className="logoBox">DB</div><div><b>Supabase — My Control</b><div className="tiny muted">Project {db?.projectRef||"vpneonfehqfsxclqcman"} · Singapore</div></div></div><span className={"badge "+(db?.publicConnected?"ok":"warn")}>{db?.publicConnected?"Connected":"Checking..."}</span></div>
  <div className="telegramDetail"><div className="kv compact"><span>Web database</span><b>{db?.publicConnected?"Aktif":"Belum"}</b><span>Database utama</span><b>Aktif</b><span>Payment storage</span><b>Private</b><span>n8n backend access</span><b>{connected(n8n)?"Aktif":"Belum"}</b></div></div>
 </div>

 <div className="grid2 section">
  <div className="card integration"><div className="integrationName"><div className="logoBox">Sheets</div><div><b>Google Sheets</b><div className="tiny muted">Master produk / promo / FAQ</div></div></div><div className="actions"><a className="btn" href={sheet} target="_blank">Buka</a><span className="badge ok">Connected</span></div></div>
  <div className="card integration"><div className="integrationName"><div className="logoBox">n8n</div><div><b>n8n</b><div className="tiny muted">{connected(n8n)?"Automation engine lokal · tersambung Supabase":"Automation engine lokal"}</div></div></div><span className={"badge "+(connected(n8n)?"ok":"warn")}>{connected(n8n)?"Connected":"Belum"}</span></div>
  <div className="card integration"><div className="integrationName"><div className="logoBox">WA</div><div><b>WAHA</b><div className="tiny muted">{connected(waha)?`Session ${waha?.details?.session||"default"} · ${waha?.details?.session_status||"WORKING"}`:"WhatsApp gateway"}</div></div></div><span className={"badge "+(connected(waha)?"ok":"warn")}>{connected(waha)?"Connected":"Belum"}</span></div>
  <div className="card integration"><div className="integrationName"><div className="logoBox">PAY</div><div><b>Payment</b><div className="tiny muted">DANA / GoPay / Bank</div></div></div><span className={"badge "+(connected(pay)?"ok":"warn")}>{connected(pay)?"Connected":"Belum"}</span></div>
 </div>

 <div className="notice section"><b>n8n dan WAHA sekarang tercatat sebagai integrasi lokal aktif.</b> WAHA session <b>default</b> berstatus WORKING dan n8n sudah terhubung ke Supabase. Status halaman ini refresh otomatis setiap 15 detik.</div>
 </>;
}