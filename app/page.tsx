import Link from "next/link";
import Logo from "@/components/Logo";
import DashboardOverview from "@/components/DashboardOverview";
import { ArrowRight, ArrowUpRight, BarChart3 } from "lucide-react";

// Server-rendered navigation and hero stay available even if live stats fail in a client.
export default function Page() {
  return (
    <div className="dashboardPage">
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
          <div className="heroVisualCenter"><Logo /></div>
          <div className="heroVisualChip chipTop"><span className="chipIndicator green" /> CUSTOMER CARE</div>
          <div className="heroVisualChip chipBottom"><BarChart3 size={15} /> OPERATIONS</div>
          <div className="heroVisualSpark">✦</div>
        </div>
      </section>

      <DashboardOverview />
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
