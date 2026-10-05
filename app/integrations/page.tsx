"use client";
import { useEffect, useState } from "react";
type Status = {
  connected: boolean;
  checkedAt: string;
  error?: string;
  detail?: { session: string; status: string };
};
export default function Integrations() {
  const [items, setItems] = useState<Record<string, Status>>({}),
    [error, setError] = useState("");
  async function load() {
    try {
      const r = await fetch("/api/control/health", { cache: "no-store" }),
        d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setItems(d);
      setError("");
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
          <p>Kesehatan koneksi berdasarkan pemeriksaan langsung.</p>
        </div>
        <button className="btn" onClick={load}>
          Periksa ulang
        </button>
      </div>
      {error && <div className="notice errorNotice">{error}</div>}
      <div className="grid2 section">
        {["DATABASE", "N8N", "WAHA", "TELEGRAM"].map((name) => {
          const x = items[name];
          return (
            <div className="card" key={name}>
              <div className="integration">
                <b>{name}</b>
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
      <div className="notice section">
        Koneksi endpoint belum membuktikan pesan diterima pelanggan. Workflow
        n8n dan migrasi database harus dipasang sebelum pengujian kirim nyata.
      </div>
    </>
  );
}
