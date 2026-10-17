"use client";
import { useStore } from "@/components/Store";
import Link from "next/link";
export default function Settings() {
  const s = useStore();
  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Settings</h1>
          <p>Data produksi tersimpan di Supabase dan sinkron antarperangkat.</p>
        </div>
      </div>
      <div className="grid2">
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Data & Backup</h2>
          <div className="settingRow">
            <div>
              <b>Supabase Database</b>
              <span>
                Customer, lead, order, chat, payment, dan setting tersimpan
                terpusat.
              </span>
            </div>
            <span className={"badge " + (s.error ? "warn" : "ok")}>
              {s.error ? "Perlu diperiksa" : s.loading ? "Memuat" : "Sinkron"}
            </span>
          </div>
          <div className="settingRow">
            <div>
              <b>Export snapshot</b>
              <span>Unduh data bisnis lengkap saat diperlukan. Data dikirim bertahap tanpa dimuat saat halaman dibuka.</span>
            </div>
            <a className="btn" href="/api/reports/export?backup=1">
              Download JSON
            </a>
          </div>
          <div className="settingRow">
            <div>
              <b>Refresh data</b>
              <span>Paksa sinkronisasi tanpa menunggu auto-refresh.</span>
            </div>
            <button className="btn" onClick={() => s.refresh()}>
              Refresh
            </button>
          </div>
        </div>
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Kontrol Sistem</h2>
          <div className="settingRow">
            <div><b>AI, bot, follow-up & pengecualian nomor</b><span>Semua aturan harian dikelola lewat panel web dan dibaca worker n8n.</span></div>
            <Link className="btn primary" href="/automation">Atur sekarang</Link>
          </div>
          <div className="settingRow">
            <div>
              <b>Akses owner</b>
              <span>
                Sesi owner menggunakan cookie HttpOnly dengan pemeriksaan
                backend.
              </span>
            </div>
            <span className="badge ok">Protected</span>
          </div>
          <div className="settingRow">
            <div>
              <b>Payment approval</b>
              <span>
                Order tidak bisa fulfillment sebelum 3 pemeriksaan lolos dan
                owner approve.
              </span>
            </div>
            <span className="badge ok">Required</span>
          </div>
          <div className="settingRow">
            <div>
              <b>Payment evidence</b>
              <span>
                Status dan catatan bukti disimpan di database; kebijakan bucket
                mengikuti konfigurasi Supabase.
              </span>
            </div>
            <span className="badge warn">Periksa storage</span>
          </div>
        </div>
      </div>
    </>
  );
}
