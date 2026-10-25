"use client";

import Logo from "@/components/Logo";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, MessageSquareText, KanbanSquare, ReceiptText,
  ShieldCheck, Package, ChartNoAxesCombined, Bot, PlugZap,
  Settings, Bell, Send, Users, LogOut, Sun, Moon,
  Search, ChevronRight, Command, X, ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "@/components/Store";

type NavItem = { href: string; label: string; Icon: LucideIcon; hint: string };
const navGroups: { title: string; items: NavItem[] }[] = [
  { title: "WORKSPACE", items: [
    { href: "/", label: "Ringkasan", Icon: LayoutDashboard, hint: "Gambaran operasional" },
    { href: "/inbox", label: "Inbox", Icon: MessageSquareText, hint: "Percakapan WhatsApp" },
    { href: "/campaigns", label: "Blash", Icon: Send, hint: "Pesan promosi" },
    { href: "/contacts", label: "Kontak", Icon: Users, hint: "Daftar pelanggan" },
    { href: "/crm", label: "CRM", Icon: KanbanSquare, hint: "Peluang penjualan" },
  ] },
  { title: "OPERASIONAL", items: [
    { href: "/control", label: "Pusat kontrol", Icon: Settings, hint: "Semua fitur" },
    { href: "/automation", label: "Otomasi & AI", Icon: Bot, hint: "Atur asisten" },
    { href: "/sales", label: "Pipeline sales", Icon: KanbanSquare, hint: "Pantau lead" },
    { href: "/orders", label: "Pesanan", Icon: ReceiptText, hint: "Kelola pesanan" },
    { href: "/payments", label: "Pembayaran", Icon: ShieldCheck, hint: "Verifikasi pembayaran" },
  ] },
  { title: "MANAJEMEN", items: [
    { href: "/products", label: "Produk", Icon: Package, hint: "Katalog produk" },
    { href: "/reports", label: "Laporan", Icon: ChartNoAxesCombined, hint: "Analisis performa" },
    { href: "/integrations", label: "Integrasi", Icon: PlugZap, hint: "Koneksi sistem" },
    { href: "/settings", label: "Pengaturan", Icon: Settings, hint: "Preferensi aplikasi" },
  ] },
];
const allItems = navGroups.flatMap((group) => group.items);
const mainMobile = ["/", "/campaigns", "/inbox", "/crm", "/control"];

export default function Shell({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);
  const [waha, setWaha] = useState<boolean | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const path = usePathname();
  const s = useStore();
  const current = allItems.find((item) => item.href === path);
  const pending = s.payments.filter((p) =>
    ["WAITING_OWNER", "MANUAL_REVIEW"].includes(p.status),
  ).length;
  const results = allItems.filter((item) =>
    [item.label, item.hint].join(" ").toLocaleLowerCase("id").includes(searchText.trim().toLocaleLowerCase("id")),
  );

  useEffect(() => {
    // Some Android browsers block Web Storage (private mode or damaged device storage).
    // Theme preferences must never prevent the workspace from mounting.
    let savedTheme: string | null = null;
    try {
      savedTheme = window.localStorage.getItem("bb-theme");
    } catch {
      // Fall back to the default dark theme without blocking the application.
    }
    const value = savedTheme !== "light";
    setDark(value);
    document.body.classList.toggle("dark", value);
    document.body.classList.toggle("theme-light", !value);
  }, []);
  useEffect(() => {
    let alive = true;
    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/control/health?light=1", { cache: "no-store" });
        const data = await response.json();
        if (alive) setWaha(Boolean(response.ok && data.WAHA?.connected));
      } catch {
        if (alive) setWaha(false);
      }
    }
    void check();
    const id = setInterval(check, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
      if (event.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
    else setSearchText("");
  }, [searchOpen]);
  useEffect(() => { setSearchOpen(false); }, [path]);

  function toggleTheme() {
    const value = !dark;
    setDark(value);
    document.body.classList.toggle("dark", value);
    document.body.classList.toggle("theme-light", !value);
    try {
      window.localStorage.setItem("bb-theme", value ? "dark" : "light");
    } catch {
      // The selected theme remains active for this visit.
    }
  }
  return (
    <div className="shell">
      <a className="skipLink" href="#main-content">Lewati ke konten</a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="My Control, beranda">
          <div className="brandMark"><Logo /></div>
          <div className="brandName">
            <b>My Control<span className="brandPeriod">.</span></b>
            <small>by Bantu Beres</small>
          </div>
          <span className="brandWorkspace">PRO</span>
        </Link>
        <div className="workspaceLabel"><span className="workspaceAvatar">B</span><div><b>Control workspace</b><small>Owner dashboard</small></div><ChevronRight size={15} /></div>
        <nav className="nav" aria-label="Navigasi desktop">
          {navGroups.map((group) => (
            <div className="navGroup" key={group.title}>
              <div className="navGroupTitle">{group.title}</div>
              {group.items.map(({ href, label, Icon }) => (
                <Link
                  href={href} key={href}
                  className={path === href ? "active" : ""}
                  aria-current={path === href ? "page" : undefined}
                >
                  <Icon size={18} strokeWidth={1.85} />
                  <span>{label}</span>
                  {path === href && <span className="navActiveIndicator" aria-hidden="true" />}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebarBottom">
          <Link className="sidebarHelp" href="/integrations">
            <span className="sidebarHelpIcon"><PlugZap size={18} /></span>
            <span><b>Status koneksi</b><small>{waha === null ? "Memeriksa layanan..." : waha ? "WAHA tersambung" : "Periksa WAHA"}</small></span>
            <ArrowUpRight size={15} />
          </Link>
          <div className="sideFoot">
            <span className={"statusDot " + (s.error ? "" : "okDot")} />
            {s.error ? "Periksa status database" : s.loading ? "Memuat halaman..." : "Workspace siap"}
          </div>
        </div>
      </aside>

      <main className="main" id="main-content">
        <header className="topbar">
          <div className="topbarIdentity">
            <div className="workspaceBreadcrumb"><span>Workspace</span><ChevronRight size={13} /><strong>{current?.label || "My Control"}</strong></div>
            <div className="topbarCaption">Pusat kendali pelanggan & operasional</div>
          </div>
          <div className="topActions">
            <button className="topbarSearch" onClick={() => setSearchOpen(true)} aria-label="Cari halaman">
              <Search size={17} /><span>Cari halaman atau fitur...</span><kbd>⌘ K</kbd>
            </button>
            <Link className="iconBtn notificationBtn" aria-label="Notifikasi pembayaran" href="/payments">
              <Bell size={18} />
              {pending > 0 && <span>{pending > 9 ? "9+" : pending}</span>}
            </Link>
            <button className="iconBtn" onClick={toggleTheme} aria-label={dark ? "Aktifkan tema terang" : "Aktifkan tema gelap"} title={dark ? "Tema terang" : "Tema gelap"}>
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="iconBtn logoutBtn" aria-label="Keluar akun" title="Keluar akun" onClick={() => void s.signOut()}><LogOut size={18} /></button>
            <span className="topbarUser" aria-label="Owner"><span>B</span></span>
          </div>
        </header>
        <div className="content">
          {s.error && <div className="notice errorNotice" role="alert"><b>Database:</b> {s.error} <Link href="/integrations">Periksa koneksi</Link></div>}
          {children}
        </div>
      </main>

      <nav className="mobileNav" aria-label="Navigasi utama">
        {allItems.filter((item) => mainMobile.includes(item.href)).sort((a,b) => mainMobile.indexOf(a.href) - mainMobile.indexOf(b.href)).map(({ href, label, Icon }) => {
          const active = path === href || (href === "/control" && !mainMobile.includes(path));
          return (
            <Link href={href} key={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              <Icon size={20} strokeWidth={active ? 2.3 : 1.9} /><span>{href === "/control" ? "Lainnya" : label}</span>
            </Link>
          );
        })}
      </nav>

      {searchOpen && (
        <div className="commandBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
          <div className="commandPanel" role="dialog" aria-modal="true" aria-label="Cari halaman My Control">
            <div className="commandInputRow">
              <Search size={20} />
              <input ref={searchInput} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Ketik nama fitur..." aria-label="Cari menu" />
              <button className="commandClose" onClick={() => setSearchOpen(false)} aria-label="Tutup pencarian"><X size={19}/></button>
            </div>
            <p className="commandEyebrow">AKSES CEPAT · {results.length} FITUR</p>
            <div className="commandResults">
              {results.map(({ href, label, Icon, hint }) => (
                <Link href={href} key={href} onClick={() => setSearchOpen(false)}>
                  <span className="commandResultIcon"><Icon size={18} /></span><span className="commandResultText"><b>{label}</b><small>{hint}</small></span><ArrowUpRight size={16} />
                </Link>
              ))}
              {results.length === 0 && <div className="commandEmpty">Tidak ada fitur yang cocok. Coba kata kunci lain.</div>}
            </div>
            <div className="commandFooter"><span><Command size={13} /> K untuk membuka</span><span>ESC untuk menutup</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
