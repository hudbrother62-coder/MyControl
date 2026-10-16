"use client";
import Link from "next/link";
import {useSummary} from "@/components/useSummary";
import { rupiah } from "@/components/Store";
export default function Page() {
  const {data,error}=useSummary();
  const revenue=Number(data?.revenue||0),profit=Number(data?.profit||0),pending=Number(data?.pending||0),verify=Number(data?.verify||0);
  const k = [
    ["Penjualan", rupiah(revenue), "Transaksi terverifikasi"],
    ["Closing", String(data?.closing||0), "Paid + fulfilled"],
    ["Pending", String(pending), "Perlu tindak lanjut"],
    ["Laba Bersih", rupiah(profit), "Revenue - HPP"],
  ];
  return (
    <>
      {error&&<div className="notice errorNotice">{error}</div>}
      <div className="pageHead">
        <div>
          <h1>Dashboard</h1>
          <p>Ringkasan yang langsung bisa ditindaklanjuti.</p>
        </div>
        <div className="actions">
          <Link className="btn" href="/reports">
            Lihat laporan
          </Link>
          <Link className="btn primary" href="/orders">
            Buat order
          </Link>
        </div>
      </div>
      <div className="grid4">
        {k.map(([a, b, c]) => (
          <div className="card" key={a}>
            <div className="kpiLabel">{a}</div>
            <div className="kpiValue">{b}</div>
            <div className="kpiMeta">{c}</div>
          </div>
        ))}
      </div>
      <div className="grid3 section">
        <div className="card">
          <div className="sectionTitle">
            <h2>Payment queue</h2>
            <span className="badge warn">{verify}</span>
          </div>
          {verify ? (
            <Link className="btn primary" href="/payments">
              Buka verifikasi
            </Link>
          ) : (
            <div className="empty">
              <strong>Aman</strong>Tidak ada pembayaran menunggu review.
            </div>
          )}
        </div>
        <div className="card">
          <div className="sectionTitle">
            <h2>Follow-up</h2>
            <span className="badge">{pending}</span>
          </div>
          {pending ? (
            <Link className="btn" href="/sales">
              Lihat pipeline
            </Link>
          ) : (
            <div className="empty">
              <strong>Belum ada antrean</strong>Lead follow-up akan muncul di
              sini.
            </div>
          )}
        </div>
        <div className="card">
          <div className="sectionTitle">
            <h2>Sistem</h2>
          </div>
          <div className="settingRow">
            <div>
              <b>Google Sheets</b>
              <span>Master produk</span>
            </div>
            <span className="badge ok">Ready</span>
          </div>
          <div className="settingRow">
            <div>
              <b>WAHA</b>
              <span>WhatsApp gateway</span>
            </div>
            <span className="badge warn">Belum</span>
          </div>
        </div>
      </div>
      <div className="section card">
        <div className="sectionTitle">
          <h2>Aktivitas cepat</h2>
        </div>
        <div className="quickLinks">
          <Link href="/inbox" className="quickCard">
            <b>Inbox</b>
            <span>Pantau chat & takeover</span>
          </Link>
          <Link href="/sales" className="quickCard">
            <b>Sales</b>
            <span>Kelola lead</span>
          </Link>
          <Link href="/payments" className="quickCard">
            <b>Payments</b>
            <span>Verifikasi bukti</span>
          </Link>
          <Link href="/automation" className="quickCard">
            <b>Automation</b>
            <span>Atur bot tanpa buka n8n</span>
          </Link>
        </div>
      </div>
    </>
  );
}
