"use client";
import Logo from "@/components/Logo";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquareText,
  KanbanSquare,
  ReceiptText,
  ShieldCheck,
  Package,
  ChartNoAxesCombined,
  Bot,
  PlugZap,
  Settings,
  Bell,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";
import { useStore } from "@/components/Store";

const nav = [
  ["/", "Dashboard", LayoutDashboard],
  ["/inbox", "Inbox", MessageSquareText],
  ["/sales", "Sales", KanbanSquare],
  ["/orders", "Orders", ReceiptText],
  ["/payments", "Payments", ShieldCheck],
  ["/products", "Products", Package],
  ["/reports", "Reports", ChartNoAxesCombined],
  ["/automation", "Automation", Bot],
  ["/integrations", "Integrations", PlugZap],
  ["/settings", "Settings", Settings],
] as const;

export default function Shell({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);
  const [waha, setWaha] = useState(false);
  const path = usePathname();
  const s = useStore();
  const pending = s.payments.filter((p) =>
    ["WAITING_OWNER", "MANUAL_REVIEW"].includes(p.status),
  ).length;
  useEffect(() => {
    const d = localStorage.getItem("bb-theme") === "dark";
    setDark(d);
    document.body.classList.toggle("dark", d);
  }, []);
  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const r = await fetch("/api/control/health", { cache: "no-store" });
        const data = await r.json();
        if (alive) setWaha(Boolean(r.ok && data.WAHA?.connected));
      } catch {
        if (alive) setWaha(false);
      }
    }
    check();
    const id = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  function toggle() {
    const n = !dark;
    setDark(n);
    document.body.classList.toggle("dark", n);
    localStorage.setItem("bb-theme", n ? "dark" : "light");
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <Logo />
          </div>
          <div>
            <b>My Control</b>
            <small>Bantu Beres Sales Center</small>
          </div>
        </div>
        <nav className="nav">
          {nav.map(([href, label, Icon]) => (
            <Link
              className={path === href ? "active" : ""}
              key={href}
              href={href}
            >
              <Icon />
              {label}
            </Link>
          ))}
        </nav>
        <div className="sideFoot">
          <div>
            <span
              className="statusDot okDot"
              style={{ display: "inline-block", marginRight: 6 }}
            />
            {s.error
              ? "Database perlu diperiksa"
              : s.loading
                ? "Memuat database"
                : "Database sinkron"}
          </div>
          <div>
            <span
              className={"statusDot " + (waha ? "okDot" : "")}
              style={{ display: "inline-block", marginRight: 6 }}
            />
            {waha ? "WAHA terhubung" : "WAHA belum terhubung"}
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <div className="topTitle">Operations Control</div>
            <div className="tiny muted">
              {s.loading
                ? "Sinkronisasi database..."
                : "Database sinkron · CS · Sales · Payment"}
            </div>
          </div>
          <div className="topActions"><button className="iconBtn" aria-label="Keluar akun" onClick={()=>s.signOut()}><LogOut size={17}/></button>
            <Link
              className="iconBtn notificationBtn"
              aria-label="Notifikasi pembayaran"
              href="/payments"
            >
              <Bell size={17} />
              {pending > 0 && <span>{pending > 9 ? "9+" : pending}</span>}
            </Link>
            <button className="iconBtn" onClick={toggle} aria-label="Tema">
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>
        <div className="content">
          {s.error && (
            <div className="notice errorNotice">
              <b>Database:</b> {s.error}
            </div>
          )}
          {children}
        </div>
      </main>
      <div className="mobileNav">
        {nav.map(([href, label, Icon]) => (
          <Link
            className={path === href ? "active" : ""}
            key={href}
            href={href}
          >
            <Icon />
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
