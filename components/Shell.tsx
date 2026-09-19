"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {usePathname} from "next/navigation";
import {LayoutDashboard,MessageSquareText,KanbanSquare,ReceiptText,ShieldCheck,Package,ChartNoAxesCombined,Bot,PlugZap,Settings,Bell,Sun,Moon} from "lucide-react";
import {useStore} from "@/components/Store";
import {supabase} from "@/lib/supabase-browser";

const nav=[
["/","Dashboard",LayoutDashboard],["/inbox","Inbox",MessageSquareText],["/sales","Sales",KanbanSquare],["/orders","Orders",ReceiptText],
["/payments","Payments",ShieldCheck],["/products","Products",Package],["/reports","Reports",ChartNoAxesCombined],["/automation","Automation",Bot],["/integrations","Integrations",PlugZap],["/settings","Settings",Settings]
] as const;

export default function Shell({children}:{children:React.ReactNode}){
 const [dark,setDark]=useState(false); const [waha,setWaha]=useState(false); const path=usePathname(); const s=useStore();
 const pending=s.payments.filter(p=>["WAITING_OWNER","MANUAL_REVIEW"].includes(p.status)).length;
 useEffect(()=>{const d=localStorage.getItem("bb-theme")==="dark";setDark(d);document.body.classList.toggle("dark",d)},[]);
 useEffect(()=>{let alive=true;async function check(){const {data}=await supabase.from("integration_status").select("status").eq("integration","WAHA").maybeSingle();if(alive)setWaha(Boolean(data?.status?.startsWith("CONNECTED")))}check();const id=setInterval(check,15000);return()=>{alive=false;clearInterval(id)}},[]);
 function toggle(){const n=!dark;setDark(n);document.body.classList.toggle("dark",n);localStorage.setItem("bb-theme",n?"dark":"light")}
 return <div className="shell">
   <aside className="sidebar">
    <div className="brand"><div className="brandMark">✓</div><div><b>My Control</b><small>Bantu Beres Sales Center</small></div></div>
    <nav className="nav">{nav.map(([href,label,Icon])=><Link className={path===href?"active":""} key={href} href={href}><Icon/>{label}</Link>)}</nav>
    <div className="sideFoot"><div><span className="statusDot okDot" style={{display:"inline-block",marginRight:6}}/>Supabase terhubung</div><div><span className={"statusDot "+(waha?"okDot":"")} style={{display:"inline-block",marginRight:6}}/>{waha?"WAHA terhubung":"WAHA belum terhubung"}</div></div>
   </aside>
   <main className="main">
    <header className="topbar"><div><div className="topTitle">Operations Control</div><div className="tiny muted">{s.loading?"Sinkronisasi database...":"Database sinkron · CS · Sales · Payment"}</div></div><div className="topActions"><Link className="iconBtn notificationBtn" aria-label="Notifikasi pembayaran" href="/payments"><Bell size={17}/>{pending>0&&<span>{pending>9?"9+":pending}</span>}</Link><button className="iconBtn" onClick={toggle} aria-label="Tema">{dark?<Sun size={17}/>:<Moon size={17}/>}</button></div></header>
    <div className="content">{s.error&&<div className="notice errorNotice"><b>Database:</b> {s.error}</div>}{children}</div>
   </main>
   <div className="mobileNav">{nav.map(([href,label,Icon])=><Link className={path===href?"active":""} key={href} href={href}><Icon/>{label}</Link>)}</div>
 </div>
}