"use client";
import Link from "next/link";
import ContactExclusions from "@/components/ContactExclusions";
import { useEffect, useState } from "react";
type Settings = {
  bot_enabled: boolean;
  ai_auto_reply: boolean;
  ai_model: string;
  bot_instructions: string;
  followup_enabled: boolean;
  max_followups: number;
  working_hours_start: string;
  working_hours_end: string;
  reply_delay_min_seconds: number;
  reply_delay_max_seconds: number;
  waha_base_url: string;
  n8n_base_url: string;
};
export default function Automation() {
  const [data, setData] = useState<any>(null),
    [form, setForm] = useState<Settings | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [maxConcurrency,setMaxConcurrency] = useState(4),
    [maxAttempts,setMaxAttempts] = useState(3);
  async function load() {
    try {
      const r = await fetch("/api/control/settings", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
      setForm(d.settings);
      setMaxConcurrency(Number(d.attention?.ai_max_concurrency ?? 4));
      setMaxAttempts(Number(d.attention?.ai_max_attempts ?? 3));
      setDirty(false);
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function edit(patch: Partial<Settings>) {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setDirty(true);
  }
  async function save() {
    if (!form || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/control/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: data.version, settings: form }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData({ ...data, ...d });
      setForm(d.settings);
      setDirty(false);
      setMessage(
        "Tersimpan sebagai versi " +
          d.version +
          ". Menunggu worker membaca konfigurasi ini.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retry(id: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/control/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "retry", id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await load();
      setMessage("Pekerjaan FAILED kembali masuk antrean.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveMaxAttempts() {
    if(busy)return;
    setBusy(true);
    try {
      const r=await fetch("/api/control/settings",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"ai_max_attempts",max:maxAttempts})
      });
      const d=await r.json();if(!r.ok)throw new Error(d.error||"Gagal menyimpan batas percobaan");
      await load();setMessage("Maksimal percobaan AI tersimpan untuk retry berikutnya.");
    } catch(e) {setMessage((e as Error).message)} finally {setBusy(false)}
  }
  async function saveConcurrency() {
    if(busy)return;
    setBusy(true);
    try {
      const r=await fetch("/api/control/settings",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"ai_concurrency",max:maxConcurrency})
      });
      const d=await r.json();if(!r.ok)throw new Error(d.error||"Gagal menyimpan batas AI");
      await load();setMessage("Batas concurrency tersimpan. Worker akan menerapkan pada klaim berikutnya.");
    } catch(e) {setMessage((e as Error).message)} finally {setBusy(false)}
  }
  return (
    <>
      <div className="notice section"><a className="btn" href="/api/campaigns/workflow?kind=all">Unduh workflow lengkap v3</a></div>
      <ContactExclusions/>
      <div className="pageHead">
        <div>
          <h1>Kontrol Bot & Workflow</h1>
          <p>
            Atur dari My Control. n8n membaca konfigurasi dan menjalankan
            prosesnya.
          </p>
        </div>
        <div className="actions">
          <button
            className="btn"
            disabled={busy || dirty}
            onClick={() => void load()}
          >
            Perbarui status
          </button>
          <button
            className="btn primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {busy ? "Menyimpan…" : "Simpan perubahan"}
          </button>
        </div>
      </div>
      {message && (
        <div className="notice section" role="status">
          {message}
        </div>
      )}
      {!form ? (
        <div className="card section">Memuat konfigurasi…</div>
      ) : (
        <>
          <div className="notice section">
            <b>
              {dirty
                ? "Ada perubahan belum disimpan"
                : "Konfigurasi tersimpan · versi " + data.version}
            </b>
            <p>
              Status tersimpan tidak berarti worker sudah membacanya. Tidak ada
              status aktif palsu jika n8n belum tersambung.
            </p>
          </div>
          <div className="grid2 section">
            <section className="card">
              <h2>Bot dan respons</h2>
              <p className="muted">
                Provider: Groq. Pengambilalihan admin selalu tersedia di Inbox
                dan verifikasi pembayaran tetap wajib.
              </p>
              {(
                [
                  [
                    "bot_enabled",
                    "Bot WhatsApp",
                    "Sakelar utama balasan otomatis.",
                  ],
                  [
                    "ai_auto_reply",
                    "AI Auto Reply",
                    "Izinkan AI membalas percakapan yang tidak diambil alih admin.",
                  ],
                ] as const
              ).map(([key, title, description]) => (
                <label className="settingRow" key={key}>
                  <div>
                    <b>{title}</b>
                    <span>{description}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={(e) => edit({ [key]: e.target.checked })}
                  />
                </label>
              ))}
              <label className="fieldLabel">
                Model Groq
                <input
                  className="input"
                  maxLength={120}
                  value={form.ai_model}
                  onChange={(e) => edit({ ai_model: e.target.value })}
                  placeholder="Kosong = model dari konfigurasi n8n"
                />
              </label>
              <p className="muted">
                Pilih ID model yang tersedia di akun Groq. API key tetap
                menggunakan credential Groq di n8n; tidak ditampilkan di
                browser.
              </p>
              <label className="fieldLabel">
                Instruksi tambahan bot
                <textarea
                  className="input"
                  rows={6}
                  maxLength={6000}
                  value={form.bot_instructions}
                  onChange={(e) => edit({ bot_instructions: e.target.value })}
                  placeholder="Contoh: sapa dengan Kak, jawab singkat, gali kebutuhan sebelum menawarkan."
                />
              </label>
              <p className="muted">
                Instruksi ini melengkapi aturan tetap: gunakan produk resmi,
                jangan mengarang harga atau mengonfirmasi pembayaran.
              </p>
            </section>
            <section className="card">
              <h2>Follow-up & waktu</h2>
              <label className="settingRow">
                <div>
                  <b>Follow-up proaktif</b>
                  <span>
                    OFF menghentikan dispatch follow-up. Pelanggan tetap bisa
                    mendapat balasan.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={form.followup_enabled}
                  onChange={(e) => edit({ followup_enabled: e.target.checked })}
                />
              </label>
              <div className="formGrid">
                <label className="fieldLabel">
                  Jam mulai WIB
                  <input
                    className="input"
                    type="time"
                    value={form.working_hours_start}
                    onChange={(e) =>
                      edit({ working_hours_start: e.target.value })
                    }
                  />
                </label>
                <label className="fieldLabel">
                  Jam selesai WIB
                  <input
                    className="input"
                    type="time"
                    value={form.working_hours_end}
                    onChange={(e) =>
                      edit({ working_hours_end: e.target.value })
                    }
                  />
                </label>
                <label className="fieldLabel">
                  Maksimum follow-up
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={3}
                    value={form.max_followups}
                    onChange={(e) =>
                      edit({ max_followups: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="fieldLabel">
                  Jeda minimum (detik)
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={60}
                    value={form.reply_delay_min_seconds}
                    onChange={(e) =>
                      edit({ reply_delay_min_seconds: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="fieldLabel">
                  Jeda maksimum (detik)
                  <input
                    className="input"
                    type="number"
                    min={form.reply_delay_min_seconds}
                    max={60}
                    value={form.reply_delay_max_seconds}
                    onChange={(e) =>
                      edit({ reply_delay_max_seconds: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <p className="muted">
                Jam ini mengatur follow-up, bukan mematikan layanan balasan.
                Kampanye tidak menambahkan follow-up proaktif otomatis;
                pengingat CRM tetap manual.
              </p>
              <Link className="btn" href="/campaigns">
                Atur / jeda kampanye
              </Link>
              <Link className="btn" href="/inbox">
                Ambil alih chat di Inbox
              </Link>
            </section>
          </div>
          <section className="card section">
            <h2>Alamat integrasi</h2>
            <div className="formGrid">
              <label className="fieldLabel">
                WAHA · URL HTTPS publik
                <input
                  className="input"
                  value={form.waha_base_url}
                  onChange={(e) =>
                    edit({ waha_base_url: e.target.value.replace(/\/$/, "") })
                  }
                  placeholder="https://waha.domainmu.com"
                />
              </label>
              <label className="fieldLabel">
                n8n · URL HTTPS publik
                <input
                  className="input"
                  value={form.n8n_base_url}
                  onChange={(e) =>
                    edit({ n8n_base_url: e.target.value.replace(/\/$/, "") })
                  }
                  placeholder="https://n8n.domainmu.com"
                />
              </label>
            </div>
            <p className="muted">
              Kosong memakai konfigurasi server yang sudah ada. API key WAHA dan
              credential AI tetap disetel di n8n. URL internal Docker tetap
              boleh digunakan melalui environment n8n.
            </p>
            <Link className="btn" href="/integrations">
              Tes koneksi dan lihat status integrasi
            </Link>
          </section>
          <section className="card section" aria-label="Metrik antrean AI dan outbound">
            <h2>Antrean &amp; performa</h2>
            <p className="muted">Dihitung dari database untuk akun WhatsApp aktif. Angka ini bukan tanda bahwa pengiriman WhatsApp telah diterima pelanggan.</p>
            <div className="grid3">
              {([
                ["AI menunggu", data.metrics?.ai_pending ?? "—"],
                ["AI diproses", data.metrics?.ai_processing ?? "—"],
                ["AI retry", data.metrics?.ai_retry ?? "—"],
                ["AI gagal", data.metrics?.ai_failed ?? "—"],
                ["Outbound antre", data.metrics?.outbound_pending ?? "—"],
                ["Outbound diproses", data.metrics?.outbound_processing ?? "—"],
                ["Outbound retry", data.metrics?.outbound_retry ?? "—"],
                ["Outbound gagal", data.metrics?.outbound_failed ?? "—"],
                ["Outbound UNKNOWN", data.metrics?.outbound_unknown ?? "—"],
                ["LID tanpa nomor", data.metrics?.lid_unmapped ?? "—"],
                ["Antrean tertua (detik)", data.metrics?.ai_oldest_wait_seconds ?? "—"],
                ["Rata-rata AI (detik)", data.metrics?.ai_avg_seconds ?? "—"],
                ["Rata-rata outbound (detik)", data.metrics?.outbound_avg_seconds ?? "—"],
              ] as [string,number | string][]).map(([label,value])=>(
                <div className="card" key={label}>
                  <small className="muted">{label}</small>
                  <h3>{value}</h3>
                </div>
              ))}
            </div>
            <p className="muted">UNKNOWN harus direkonsiliasi satu per satu. Nomor LID yang belum terpetakan tidak boleh menjadi target Blash.</p>
          </section>
          <section className="card section" aria-label="Kontrol concurrency">
            <h2>Batas AI paralel</h2>
            <p className="muted">Maksimal AI job berjalan untuk akun aktif. Satu kontak tetap diproses berurutan. Worker live harus memakai pemanggilan batch agar beberapa job dapat dimulai dalam satu polling.</p>
            <div className="actions">
              <label className="fieldLabel">Maksimum job AI
                <input className="input" type="number" min={1} max={6} step={1}
                  value={maxConcurrency} onChange={e=>setMaxConcurrency(Number(e.target.value))} />
              </label>
              <button className="btn" type="button" disabled={busy || !Number.isInteger(maxConcurrency) || maxConcurrency<1 || maxConcurrency>6}
                onClick={()=>void saveConcurrency()}>Simpan batas AI</button>
              <label className="fieldLabel">Maksimal percobaan AI
                <input className="input" type="number" min={1} max={5} step={1}
                  value={maxAttempts} onChange={e=>setMaxAttempts(Number(e.target.value))} />
              </label>
              <button className="btn" type="button" disabled={busy || !Number.isInteger(maxAttempts) || maxAttempts<1 || maxAttempts>5}
                onClick={()=>void saveMaxAttempts()}>Simpan percobaan</button>
            </div>
          </section>
          <section className="card section" aria-label="Jobs bermasalah">
            <h2>AI FAILED / RETRY / PROCESSING</h2>
            {!(data.attention?.ai_jobs||[]).length ? <p className="muted">Tidak ada AI job dalam status ini.</p> :
            <div className="tableWrap"><table className="table">
              <thead><tr><th>Job</th><th>Kontak WhatsApp</th><th>Status</th><th>Percobaan</th><th>Alasan</th></tr></thead>
              <tbody>{(data.attention?.ai_jobs||[]).map((job:any)=>(
                <tr key={job.id}><td><small>{job.id}</small></td><td>{job.phone?"+"+job.phone:job.chat_id}</td>
                <td>{job.status}</td><td>{job.attempt_count}</td>
                <td>{job.last_error||"Belum tersedia detail error asli"}</td></tr>
              ))}</tbody>
            </table></div>}
            <p className="muted">Pemulihan AI tidak dijalankan otomatis. Periksa apakah ada pesan baru atau error deterministik sebelum memulai ulang job.</p>
          </section>
          <section className="card section" aria-label="Identitas dan nomor kontak">
            <h2>LID tanpa nomor &amp; kontak invalid</h2>
            <p className="muted">Kontak WhatsApp belum memiliki nomor yang dapat digunakan untuk Blash. Pertahankan ID sebagai identitas percakapan; jangan ubah angkanya menjadi nomor telepon.</p>
            <div className="tableWrap"><table className="table">
              <thead><tr><th>Jenis</th><th>Identitas</th><th>Kontak</th></tr></thead>
              <tbody>
                {(data.attention?.unmapped_lids||[]).map((item:any)=>(
                  <tr key={item.chat_id}><td>LID belum terpetakan</td><td>{item.chat_id}</td><td>{item.display_name||"—"}</td></tr>
                ))}
                {(data.attention?.invalid_contacts||[]).map((item:any,i:number)=>(
                  <tr key={item.input+"-"+i}><td>INVALID_PHONE</td><td>{item.input}</td><td>{item.name||"—"}</td></tr>
                ))}
                {!(data.attention?.unmapped_lids||[]).length && !(data.attention?.invalid_contacts||[]).length &&
                  <tr><td colSpan={3}>Tidak ada kontak LID belum terpetakan atau nomor invalid yang terdaftar.</td></tr>}
              </tbody>
            </table></div>
          </section>
          <section className="section">
            <h2>Konfigurasi yang dibaca worker</h2>
            <div className="grid3">
              {["AI", "OUTBOUND", "FOLLOWUP"].map((component) => {
                const workers = (data.workers || []).filter(
                  (w: any) => w.component === component,
                );
                const w = workers[0];
                const fresh =
                  w && Date.now() - new Date(w.last_seen).getTime() < 90000;
                const applied = fresh && w.applied_version === data.version;
                return (
                  <div className="card" key={component}>
                    <b>{component}</b>
                    <p className={"badge " + (applied ? "ok" : "warn")}>
                      {!w
                        ? "Belum ada laporan"
                        : !fresh
                          ? "Laporan kedaluwarsa"
                          : applied
                            ? "Versi terbaru dibaca"
                            : "Menunggu versi terbaru"}
                    </p>
                    <p className="muted">
                      {w
                        ? "Versi " +
                          w.applied_version +
                          " · " +
                          new Date(w.last_seen).toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                          })
                        : "Pasang workflow penghubung terbaru di n8n."}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="muted">
              Laporan ini membuktikan konfigurasi diterima worker, bukan
              keberhasilan panggilan AI atau pengiriman WhatsApp.
            </p>
          </section>
          <section className="card section">
            <h2>Workflow n8n yang terpisah</h2>
            <div className="controlGrid">
              {[
                ["inbound", "1. Terima pesan", "Validasi → simpan → antrekan"],
                [
                  "ai",
                  "2. Proses AI",
                  "Baca kontrol → memori/produk → jawaban",
                ],
                ["outbound", "3. Kirim pesan", "Cek izin → teks/video → hasil"],
                [
                  "followup",
                  "4. Follow-up",
                  "Baca aturan → cek jadwal → antrekan",
                ],
              ].map(([kind, title, desc]) => (
                <a
                  key={kind}
                  className="controlTile card"
                  href={"/api/campaigns/workflow?kind=" + kind}
                >
                  <div>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                    <small>Unduh workflow</small>
                  </div>
                </a>
              ))}
            </div>
            <p className="muted">
              Pemasangan pertama, credential, dan perubahan susunan node tetap
              di n8n. Pengaturan harian dilakukan dari halaman ini.
            </p>
          </section>
          <section className="card section">
            <h2>Pengiriman perlu tindakan</h2>
            {!(data.queue || []).length ? (
              <p className="muted">
                Tidak ada pengiriman gagal atau belum pasti yang tercatat.
              </p>
            ) : (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Kontak</th>
                      <th>Status</th>
                      <th>Keterangan</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.queue.map((j: any) => (
                      <tr key={j.id}>
                        <td>{j.chat_id}</td>
                        <td>{j.status}</td>
                        <td>{j.last_error || "—"}</td>
                        <td>
                          {j.status === "FAILED" && j.kind !== "CAMPAIGN" ? (
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() => void retry(j.id)}
                            >
                              Coba ulang kegagalan
                            </button>
                          ) : (
                            <span className="muted">
                              Periksa hasil di WhatsApp; jangan kirim ulang
                              buta.
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <details className="card section">
            <summary>Error worker terbaru</summary>
            {(data.errors || []).map((e: any) => (
              <p key={e.id}>
                <b>
                  {e.component} · {e.category}
                </b>{" "}
                — {e.error_message}
              </p>
            ))}
            {!(data.errors || []).length && <p>Belum ada error tercatat.</p>}
          </details>
        </>
      )}
    </>
  );
}
