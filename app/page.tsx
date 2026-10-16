"use client";

import Link from "next/link";
import {
  ArrowRight, ArrowUpRight, BarChart3, CheckCircle2, CircleHelp,
  Clock3, CreditCard, Headphones, MessageSquareText, PackageCheck,
  Send, Sparkles, TrendingUp, Users, Wallet,
} from "lucide-react";
import { useSummary } from "@/components/useSummary";
import { rupiah } from "@/components/Store";

const shortcuts = [
  { href: "/inbox", icon: MessageSquareText, title: "Buka inbox", detail: "Balas dan kelola percakapan", label: "Chat pelanggan" },
  { href: "/campaigns", icon: Send, title: "Kelola kampanye", detail: "Promosi WhatsApp lebih terarah", label: "Kampanye" },
  { href: "/contacts", icon: Users, title: "Atur kontak", detail: "Impor dan segmentasi pelanggan", label: "Database kontak" },
  { href: "/automation", icon: Sparkles, title: "Pengaturan AI", detail: "Kontrol asisten dan otomasi", label: "Bot & AI" },
];

export default function Page() {
  const { data, error } = useSummary();
  const ready = Boolean(data);
  const revenue = Number(data?.revenue || 0);
  const profit = Number(data?.profit || 0);
  const pending = Number(data?.pending || 0);
  const verify = Number(data?.verify || 0);
  const closing = Number(data?.closing || 0);
  const metrics = [
    { label: "Total penjualan", value: ready ? rupiah(revenue) : "—", subtitle: "Transaksi terverifikasi", Icon: Wallet, tint: "mint" },
    { label: "Closing berhasil", value: ready ? closing.toLocaleString("id-ID") : "—", subtitle: "Pesanan selesai", Icon: PackageCheck, tint: "blue" },
    { label: "Perlu follow-up", value: ready ? pending.toLocaleString("id-ID") : "—", subtitle: "Peluang butuh tindakan", Icon: Clock3, tint: "amber" },
    { label: "Laba bersih", value: ready ? rupiah(profit) : "—", subtitle: "Penjualan dikurangi HPP", Icon: TrendingUp, tint: "purple" },
  ];

  return (
    <div className="dashboardPage">
      {error && <div className="notice errorNotice" role="alert">Ringkasan tidak dapat dimuat: {error} <Link href="/integrations">Periksa koneksi</Link></div>}
      <section className="dashboardHero">
        <div className="dashboardHeroCopy">
          <span className="heroEyebrow"><span className="heroEyebrowDot" /> MY CONTROL · OVERVIEW</span>
          <h1>Kendalikan bisnis,<br /><span>semuanya di sini.</span></h1>
          <p>Pantau percakapan pelanggan, tindak lanjut, dan transaksi dari satu workspace yang lebih sederhana.</p>
          <div className="heroActions">
            <Link className="heroPrimary" href="/inbox">Buka inbox <ArrowUpRight size={18} /></Link>
            <Link className="heroSecondary" href="/control">Lihat semua fitur <ArrowRight size={17} /></Link>
          </div>
        </div>
        <div className="heroVisual" aria-hidden="true">
          <div className="heroVisualRing ringOne"/><div className="heroVisualRing ringTwo"/>
          <div className="heroVisualCenter"><MessageSquareText size={34} strokeWidth={1.5} /></div>
          <div className="heroVisualChip chipTop"><span className="chipIndicator green" /> CUSTOMER CARE</div>
          <div className="heroVisualChip chipBottom"><BarChart3 size={15} /> OPERATIONS</div>
          <div className="heroVisualSpark">✦</div>
        </div>
      </section>

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

      <section className="dashboardGuide">
        <div><span className="sectionEyebrow">PANDUAN SINGKAT</span><h2>Alur kerja yang lebih simpel</h2></div>
        <div className="dashboardGuideSteps">
          <Link href="/inbox"><span className="guideNumber">01</span><span><b>Pantau percakapan</b><small>Lihat pesan masuk dan ambil alih jika diperlukan.</small></span><ArrowUpRight size={17}/></Link>
          <Link href="/crm"><span className="guideNumber">02</span><span><b>Kelola peluang</b><small>Simpan catatan dan jadwalkan follow-up.</small></span><ArrowUpRight size={17}/></Link>
          <Link href="/payments"><span className="guideNumber">03</span><span><b>Selesaikan transaksi</b><small>Verifikasi pembayaran sebelum pemenuhan.</small></span><ArrowUpRight size={17}/></Link>
        </div>
      </section>
    </div>
  );
}
