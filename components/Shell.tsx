"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {LayoutDashboard,MessageSquareText,KanbanSquare,ReceiptText,ShieldCheck,Package,ChartNoAxesCombined,Bot,PlugZap,Settings,Bell,Sun,Moon} from "lucide-react";

const nav=[
["/","Dashboard",LayoutDashboard],["/inbox","Inbox",MessageSquareText],["/sales","Sales",KanbanSquare],["/orders","Orders",ReceiptText],
["/payments","Payments",ShieldCheck],["/products","Products",Package],["/reports","Reports",ChartNoAxesCombined],["/automation","Automation",Bot],["/integrations","Integrations",PlugZap],["/settings","Settings",Settings]
] as const;

export default function Shell({children}:{children:React.ReactNode}){
 const [dark,setDark]=useState(false);
 useEffect(()=>{const d=localStorage.getItem("bb-theme")==="dark";setDark(d);document.body.classList.toggle("dark",d)},[]);
 function toggle(){const n=!dark;setDark(n);document.body.classList.toggle("dark",n);localStorage.setItem("bb-theme",n?"dark":"light")}
 return <div className="shell">
   <aside className="sidebar">
    <div className="brand"><div className="brandMark">✓</div><div><b>My Control</b><small>Bantu Beres Sales Center</small></div></div>
    <nav className="nav">{nav.map(([href,label,Icon])=><Link key={href} href={href}><Icon/>{label}</Link>)}</nav>
    <div className="sideFoot"><div><span className="statusDot" style={{display:"inline-block",marginRight:6}}/>WAHA belum terhubung</div><div>n8n: tahap integrasi berikutnya</div></div>
   </aside>
   <main className="main">
    <header className="topbar"><div><div className="topTitle">Operations Control</div><div className="tiny muted">CS · Sales · Payment · Automation</div></div><div className="topActions"><button className="iconBtn" aria-label="Notifikasi"><Bell size={17}/></button><button className="iconBtn" onClick={toggle} aria-label="Tema">{dark?<Sun size={17}/>:<Moon size={17}/>}</button></div></header>
    <div className="content">{children}</div>
   </main>
   <div className="mobileNav">{nav.slice(0,5).map(([href,label,Icon])=><Link key={href} href={href}><Icon/>{label}</Link>)}</div>
 </div>
}
