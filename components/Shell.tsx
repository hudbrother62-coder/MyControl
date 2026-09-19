"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {usePathname} from "next/navigation";
import {LayoutDashboard,MessageSquareText,KanbanSquare,ReceiptText,ShieldCheck,Package,ChartNoAxesCombined,Bot,PlugZap,Settings,Bell,Sun,Moon} from "lucide-react";
import {useStore} from "@/components/Store";

const nav=[
["/","Dashboard",LayoutDashboard],["/inbox","Inbox",MessageSquareText],["/sales","Sales",KanbanSquare],["/orders","Orders",ReceiptText],
["/payments","Payments",ShieldCheck],["/products","Products",Package],["/reports","Reports",ChartNoAxesCombined],["/automation","Automation",Bot],["/integrations","Integrations",PlugZap],["/settings","Settings",Settings]
] as const;

export default function Shell({children}:{children:React.ReactNode}){
 const [dark,setDark]=useState(false); const path=usePathname(); const s=useStore();
 const pending=s.payments.filter(p=>["WAITING_ANALYSIS","WAITING_OWNER","MANUAL_REVIEW"].includes(p.status)).length;
 useEffect(()=>{const d=localStorage.getItem("bb-theme")==="dark";setDark(d);document.body.classList.toggle("dark",d)},[]);
 function toggle(){const n=!dark;setDark(n);document.body.classList.toggle("dark",n);localStorage.setItem("bb-theme",n?"dark":"light")}
 return <div className="shell">
   <aside className="sidebar">
    <div className="brand"><div className="brandMark">✓</div><div><b>My Control</b><small>Bantu Beres Sales Center</small></div></div>
    <nav className="nav">{nav.map(([href,label,Icon])=><Link className={path===href?"active":""} key={href} href={href}><Icon/>{label}</Link>)}</nav>
    <div className="sideFoot"><div><span className="statusDot" style={{display:"inline-block",marginRight:6}}/>WAHA belum terhubung</div><div>Data lokal aktif · Supabase berikutnya</div></div>
   </aside>
   <main className="main">
    <header className="topbar"><div><div className="topTitle">Operations Control</div><div className="tiny muted">CS · Sales · Payment · Automation</div></div><div className="topActions"><Link className="iconBtn notificationBtn" aria-label="Notifikasi pembayaran" href="/payments"><Bell size={17}/>{pending>0&&<span>{pending>9?"9+":pending}</span>}</Link><button className="iconBtn" onClick={toggle} aria-label="Tema">{dark?<Sun size={17}/>:<Moon size={17}/>}</button></div></header>
    <div className="content">{children}</div>
   </main>
   <div className="mobileNav">{nav.map(([href,label,Icon])=><Link className={path===href?"active":""} key={href} href={href}><Icon/>{label}</Link>)}</div>
 </div>
}