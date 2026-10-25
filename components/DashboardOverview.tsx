"use client";

import Link from "next/link";
import { Component, type ReactNode } from "react";
import {
  ArrowRight, ArrowUpRight, CheckCircle2, CircleHelp,
  Clock3, CreditCard, Headphones, MessageSquareText,
  PackageCheck, Send, Sparkles, TrendingUp, Users, Wallet,
} from "lucide-react";
import { useSummary } from "@/components/useSummary";

const shortcuts = [
  { href: "/inbox", icon: MessageSquareText, title: "Buka inbox", detail: "Balas dan kelola percakapan", label: "Chat pelanggan" },
  { href: "/campaigns", icon: Send, title: "Kelola kampanye", detail: "Promosi WhatsApp lebih terarah", label: "Kampanye" },
  { href: "/contacts", icon: Users, title: "Atur kontak", detail: "Impor dan segmentasi pelanggan", label: "Database kontak" },
  { href: "/automation", icon: Sparkles, title: "Pengaturan AI", detail: "Kontrol asisten dan otomasi", label: "Bot & AI" },
];

// Do not let malformed, empty, or non-finite RPC numbers crash dashboard render.
function safeNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
function currency(value: number): string {
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
  } catch {
    return "Rp " + String(Math.round(value));
  }
}
function count(value: number): string {
  try {
    return value.toLocaleString("id-ID");
  } catch {
    return String(value);
  }
}

class OverviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("[My Control] Dashboard summary crashed; other menus remain accessible", error);
  }
  render() {
    if (this.state.failed) {
      return (
        <section className="card" role="alert" style={{ padding: 24, marginTop: 24, lineHeight: 1.7 }}>
          <h2 style={{ marginTop: 0 }}>Ringkasan statistik sementara tidak tersedia</h2>
          <p>Menu Blash, Inbox, Kontak, dan pengaturan tetap bisa digunakan.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <button type="button" className="btn primary" onClick={() => this.setState({ failed: false })}>Coba muat statistik</button>
            <Link href="/campaigns" className="btn">Buka Blash</Link>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

function OverviewContent() {
  const { data, error } = useSummary();
  const ready = data != null && typeof data === "object" && !Array.isArray(data);
  const revenue = safeNumber(data?.revenue);
  const profit = safeNumber(data?.profit);
  const pending = safeNumber(data?.pending);
  const verify = safeNumber(data?.verify);
  const closing = safeNumber(data?.closing);
  const metrics = [
    { label: "Total penjualan", value: ready ? currency(revenue) : "—", subtitle: "Transaksi terverifikasi", Icon: Wallet, tint: "mint" },
    { label: "Closing berhasil", value: ready ? count(closing) : "—", subtitle: "Pesanan selesai", Icon: PackageCheck, tint: "blue" },
    { label: "Perlu follow-up", value: ready ? count(pending) : "—", subtitle: "Peluang butuh tindakan", Icon: Clock3, tint: "amber" },
    { label: "Laba bersih", value: ready ? currency(profit) : "—", subtitle: "Penjualan dikurangi HPP", Icon: TrendingUp, tint: "purple" },
  ];
  return (
    <>
      {error && <div className="notice errorNotice" role="alert">Ringkasan tidak dapat dimuat: {String(error)} <Link href="/integrations">Periksa koneksi</Link></div>}
      <div className="dashboardSectionHeading">
        <div><span className="sectionEyebrow">PERFORMA</span><h2>Ringkasan hari ini</h2><p>Angka diambil dari database, bukan data contoh.</p></div>
        <Link href="/reports" className="textLink">Lihat laporan <ArrowUpRight size={16}/></Link>
      </div>
      <div className="dashboardMetrics">
        {metrics.map(({ label, value, subtitle, Icon, tint }) => (
          <article className="metricCard" key={label}>
            <div className="metricCardTop"><span className={"metricIcon " + tint}><Icon size={19} strokeWidth={1.9}/></span><ArrowUpRight size={16} className="metricCorner"/></div>
            <div className="metricLabel">{label}</div><strong className="metricValue">{value}</strong><span className="metricSubtitle">{subtitle}</span>
          </article>
        ))}
      </div>

      <div className="dashboardLower">
        <section className="dashboardTasks card">
          <div className="dashboardCardHeading">
            <div><span className="sectionEyebrow">PRIORITAS</span><h2>Yang perlu ditangani</h2><p>Mulai dari pekerjaan yang paling penting.</p></div>
            <span className="subtleIcon"><Headphones size={20}/></span>
          </div>
          <Link className="taskRow" href="/payments">
            <span className="taskRowIcon payment"><CreditCard size={20}/></span>
            <span className="taskRowMain"><b>Verifikasi pembayaran</b><small>Periksa bukti pembayaran yang masuk</small></span>
            <span className={"taskCount " + (verify > 0 ? "urgent" : "")}>{ready ? verify : "—"}</span><ArrowRight size={17}/>
          </Link>
          <Link className="taskRow" href="/crm">
            <span className="taskRowIcon followup"><Clock3 size={20}/></span>
            <span className="taskRowMain"><b>Follow-up pelanggan</b><small>Tinjau peluang yang membutuhkan respons</small></span>
            <span className={"taskCount " + (pending > 0 ? "urgent" : "")}>{ready ? pending : "—"}</span><ArrowRight size={17}/>
          </Link>
          <Link className="taskRow" href="/integrations">
            <span className="taskRowIcon system"><CheckCircle2 size={20}/></span>
            <span className="taskRowMain"><b>Kesehatan integrasi</b><small>Cek WAHA, n8n, dan database</small></span>
            <span className="taskCount neutral">Cek</span><ArrowRight size={17}/>
          </Link>
          <div className="dashboardTaskFoot"><CircleHelp size={15}/><span>Tindakan hanya dijalankan saat Anda memilihnya.</span></div>
        </section>

        <section className="dashboardQuickSection card">
          <div className="dashboardCardHeading"><div><span className="sectionEyebrow">AKSES CEPAT</span><h2>Mulai pekerjaan</h2><p>Akses fitur yang paling sering digunakan.</p></div></div>
          <div className="dashboardQuickGrid">
            {shortcuts.map(({ href, icon: Icon, title, detail, label }) => (
              <Link key={href} className="dashboardQuickItem" href={href} aria-label={label}>
                <span className="dashboardQuickIcon"><Icon size={20} strokeWidth={1.85}/></span>
                <span><b>{title}</b><small>{detail}</small></span><ArrowUpRight size={16} className="quickArrow"/>
              </Link>
            ))}
          </div>
        </section>
      </div>

    </>
  );
}

export default function DashboardOverview() {
  return <OverviewBoundary><OverviewContent /></OverviewBoundary>;
}
