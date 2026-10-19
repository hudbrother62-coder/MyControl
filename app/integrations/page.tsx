"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
type Status = {
  connected: boolean;
  checkedAt: string;
  error?: string;
  detail?: { session: string; status: string };
};
type Cutover={configured:boolean;active:boolean;ready:boolean;phase?:string;status?:string;target_session?:string;error?:string;identity_verified?:boolean};
export default function Integrations() {
  const [items, setItems] = useState<Record<string, Status>>({}),
    [error, setError] = useState("");
  const [cutover,setCutover]=useState<Cutover|null>(null);
  async function load() {
    try {
      const r = await fetch("/api/control/health", { cache: "no-store" }),
        d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setItems(d);
      setError("");
      const response=await fetch("/api/control/waha-cutover",{cache:"no-store"});
      if(response.ok)setCutover(await response.json());
    } catch (e) {
      setItems({});
      setError(e instanceof Error ? e.message : "Pemeriksaan gagal");
    }
  }
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Integrasi</h1>
          <p>
            Periksa koneksi; alamat layanan diatur dari Kontrol Bot & Workflow.
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/automation">
            Atur integrasi
          </Link>
          <button className="btn" onClick={load}>
            Periksa ulang
          </button>
        </div>
      </div>
      {error && <div className="notice errorNotice">{error}</div>}
      <div className="grid2 section">
        {["DATABASE", "N8N", "WORKER", "WAHA", "TELEGRAM"].map((name) => {
          const x = items[name];
          return (
            <div className="card" key={name}>
              <div className="integration">
                <b>{name==="WORKER"?"N8N Worker Pengirim":name}</b>
                <span className={"badge " + (x?.connected ? "ok" : "warn")}>
                  {x
                    ? x.connected
                      ? "Terhubung"
                      : "Belum terhubung"
                    : "Memeriksa..."}
                </span>
              </div>
              <p className="muted">
                {x?.error ||
                  x?.detail?.status ||
                  "Pemeriksaan endpoint layanan"}
              </p>
              {x && (
                <small>
                  Dicek: {new Date(x.checkedAt).toLocaleString("id-ID")}
                </small>
              )}
            </div>
          );
        })}
      </div>
      {cutover?.configured&&<div className="card section" role="status">
        <div className="integration"><b>Pengirim PRIME STORE</b>
          <span className={"badge "+(cutover.active?"ok":"warn")}>{cutover.active?"Dialihkan":"Belum dialihkan"}</span>
        </div>
        <p>Target: <b>{cutover.target_session||"Belum ditetapkan"}</b> · +62 831-8675-0567</p>
        <p className="muted">Status WAHA: <b>{cutover.status||"Belum diperiksa"}</b>. {cutover.ready?
         "Identitas terverifikasi; lanjutkan pemeriksaan n8n dan uji WhatsApp sebelum pergantian.":"Pergantian belum dapat dijalankan."}</p>
        {cutover.error&&<small className="muted">{cutover.error}</small>}
        <p className="muted">Ini hanya pemantauan. Saat sesi target menjadi WORKING, nomor tidak beralih otomatis sampai workflow aktif diperbarui dan diuji.</p>
      </div>}
      <div className="notice section">
        Koneksi endpoint belum membuktikan pesan diterima pelanggan. Workflow
        n8n dan migrasi database harus dipasang sebelum pengujian kirim nyata.
      </div>
    </>
  );
}
