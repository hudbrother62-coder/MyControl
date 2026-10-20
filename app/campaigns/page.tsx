"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { campaignLabels as labels, campaignRequest } from "@/lib/campaigns";
import { useCampaignData } from "@/components/useCampaignData";
import CampaignEditor from "@/components/CampaignEditor";
function Detail({
  id,
  onClose,
  onChange,
}: {
  id: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const [offset,setOffset]=useState(0);
  const { data, error, loading, refresh } = useCampaignData("?view=detail&id="+id+"&offset="+offset);
  const [notice, setNotice] = useState(""),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState(false),
    [schedule, setSchedule] = useState(""),
    [sendMode, setSendMode] = useState<"NOW"|"LATER">("NOW"),
    [testPhone, setTestPhone] = useState(""),
    [permissionSource,setPermissionSource] = useState(""),
    [confirm, setConfirm] = useState("");
  const c = data?.campaign;
  const readiness = data?.readiness;
  const testReady = readiness?.test_status === "SENT";
  const eligibleCount = readiness?.eligible_total ?? 0;
  const alreadyBlasted = readiness?.already_blasted_total ?? 0;
   const aiReplyReady = !c?.bot_enabled || readiness?.ai_auto_reply_ready === true;
  const testPending = ["PENDING","PROCESSING","RETRY"].includes(readiness?.test_status);
  useEffect(()=>{
    if(!testPending)return;
    const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh()},3000);
    return()=>clearInterval(timer);
  },[testPending,refresh]);
  async function action(action: string) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      if (action === "START" || action === "SCHEDULE") {
        if (!readiness?.worker_online) throw new Error("Pengirim belum terhubung. Buka Integrasi untuk memeriksa koneksi.");
         // AI Auto Reply is independent of direct campaign sending.
        if (readiness?.has_image && !readiness?.image_supported) throw new Error("Pengirim gambar belum siap. Periksa koneksi di Integrasi.");
        if (eligibleCount < 1) throw new Error("Belum ada penerima berizin yang siap. Jika daftar sudah menyetujui promosi, catat sumber izinnya satu kali di atas tombol Kirim.");
      }
      if (action === "SCHEDULE") {
        if (!schedule) throw new Error("Pilih tanggal dan jam WIB dahulu.");
        if (new Date(schedule + ":00+07:00").getTime() <= Date.now())
          throw new Error("Jadwal harus berada di waktu mendatang (WIB).");
      }
      const result = await campaignRequest({
        action,
        id,
        schedule: action === "SCHEDULE" ? schedule + ":00+07:00" : null,
      });
      if (result?.ok === false) throw new Error(result.error || "Aksi belum berhasil");
      setConfirm("");
      setNotice(action === "SCHEDULE" ? "Blash berhasil dijadwalkan. Periksa status Terjadwal." : "Tindakan berhasil diproses.");
      await refresh();
      onChange();
    } catch (e) {
      setActionError((e as Error).message || "Permintaan gagal. Periksa koneksi dan coba lagi.");
    } finally {
      setBusy(false);
    }
  }
  async function recordPermission() {
    if(busy)return;
    setBusy(true);setActionError("");setNotice("");
    try{
      const result=await campaignRequest({action:"record_permission",id,source:permissionSource.trim()});
      setPermissionSource("");
      setNotice((result?.recorded??0)+" nomor impor telah diperbarui dari sumber izin yang kamu konfirmasi. Tidak ada pesan yang dikirim.");
      await refresh();
      onChange();
    }catch(e){setActionError((e as Error).message||"Gagal mencatat sumber izin");}
    finally{setBusy(false);}
  }
  async function test() {
    if (busy) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      if(readiness?.has_image && !readiness?.image_supported)
        throw new Error("Pengirim gambar belum siap. Periksa koneksi di Integrasi.");
      await campaignRequest({ action: "test", id, phone: testPhone });
      setNotice("Pesan percobaan sedang dikirim. Status diperbarui otomatis. Cek juga WhatsApp di nomor tujuan.");
      await refresh();
      onChange();
    } catch (e) {
      setActionError((e as Error).message || "Pengiriman uji gagal.");
    } finally {
      setBusy(false);
    }
  }
  if (!c)
    return (
      <div className="card section">
        <button className="btn" onClick={onClose}>
          Kembali
        </button>
        <p>
          {error || (loading ? "Memuat detail…" : "Blash tidak ditemukan")}
        </p>
      </div>
    );
  return (
    <section className="card section">
      <div className="pageHead">
        <div>
          <button className="linkBtn" onClick={onClose}>
            ← Semua Blash
          </button>
          <h2>{c.name}</h2>
          <span className="badge">{labels[c.status] || c.status}</span>
        </div>
        <div className="actions">
          {["RUNNING", "SCHEDULED"].includes(c.status) && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => void action("PAUSE")}
            >
              Jeda
            </button>
          )}
          {c.status === "PAUSED" && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void action("RESUME")}
            >
              Lanjutkan
            </button>
          )}
          {!["COMPLETED", "CANCELLED"].includes(c.status) && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => setConfirm("CANCEL")}
            >
              Batalkan
            </button>
          )}
        </div>
      </div>
      {c.status === "DRAFT" && (
        <>
          <div className="blashNextStep section" role="status">
            <strong>{testReady ? "Percobaan diterima pengirim" : testPending ? "Mengirim pesan percobaan…" : "Draft tersimpan. Nomor baru dari Excel atau input manual siap diperiksa."}</strong>
            <p>{testReady ? "Percobaan berhasil, tetapi percobaan pribadi bersifat opsional." : testPending ? "Status diperbarui otomatis setiap beberapa detik." : "Percobaan pribadi opsional. Kamu bisa langsung mengirim ke kontak yang memiliki nomor WhatsApp."}</p>
          </div>
          <details className="campaignReadiness section">
            <summary>Periksa kesiapan pengiriman</summary>
            <div className="campaignReadinessGrid">
              <span className={eligibleCount > 0 ? "ready" : "blocked"}>1. {eligibleCount} nomor langsung dari Blash yang belum pernah dikirimi</span>
              <span className={alreadyBlasted ? "blocked" : "ready"}>{alreadyBlasted} nomor sudah tercatat dalam Blash lain dan otomatis dilewati</span>
              <span className={testReady ? "ready" : "blocked"}>2. Percobaan pribadi opsional</span>
               <span className={aiReplyReady?"ready":"blocked"}>{c.bot_enabled?(aiReplyReady?"AI balasan otomatis sudah diaktifkan":"AI balasan OFF; Blash tetap dapat dikirim dan pesan masuk tetap tampil di Inbox"):"AI balasan untuk Blash ini dimatikan"}</span>
              <span className={readiness?.has_image && !readiness?.image_supported ? "blocked" : "ready"}>3. {readiness?.has_image ? (readiness?.image_supported ? "Pengirim gambar WAHA siap diuji" : "Pengirim gambar di n8n belum diperbarui") : readiness?.has_video ? "Video harus diuji" : "Pesan teks siap diuji"}</span>
            </div>
            {eligibleCount === 0 && <p className="muted">Tidak ada nomor WhatsApp baru yang dapat dikirimi dari draft ini. Tambahkan nomor di Blash baru, tanpa memindahkan data ke Kontak.</p>}
            {readiness?.has_image && !readiness?.image_supported && <p className="muted">Sambungan pengirim gambar belum siap. <Link href="/integrations">Periksa koneksi →</Link></p>}
            <button type="button" className="btn" onClick={()=>void refresh()} disabled={busy}>Perbarui status</button>
          </details>
          <div className="campaignTestPanel section">
            <strong>Opsional: Coba ke WhatsApp sendiri</strong>
            <p className="muted">Nomor boleh diawali 08 atau 62. Poster dan pesan akan dikirim sesuai isianmu.</p>
            <div className="campaignToolbar">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              aria-label="Nomor uji"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="Nomor WhatsApp milikmu untuk uji"
            />
            <button
              className="btn"
              disabled={busy || !testPhone || testPending}
              onClick={() => void test()}
            >
              {testPending ? "Menunggu hasil…" : busy ? "Menyiapkan…" : testReady ? "Kirim percobaan lagi" : "Kirim percobaan"}
            </button>
            </div>
            <p className="muted" role="status">Status: {testReady ? "Diterima pengirim; cek hasilnya di WhatsApp" : testPending ? "Sedang diproses" : ["FAILED","UNKNOWN"].includes(readiness?.test_status) ? "Belum berhasil. Periksa koneksi sebelum mencoba lagi." : "Belum dicoba"}</p>
          </div>
          {readiness?.staged_total>0&&<div className="campaignTestPanel section">
            <strong>Daftar nomor baru: konfirmasi izin sekaligus</strong>
            <p className="muted">Jika nomor pada daftar ini memang sudah menyetujui promosi, cukup catat satu sumber persetujuan untuk seluruh nomor baru. Tidak perlu membuka menu Kontak atau mengubahnya satu per satu. Nomor yang sudah berhenti promosi tetap dilewati.</p>
            <label className="fieldLabel">Sumber persetujuan pelanggan
              <input className="input" maxLength={500} value={permissionSource}
                onChange={e=>setPermissionSource(e.target.value)}
                placeholder="Contoh: Form pendaftaran pelanggan Oktober 2026" />
            </label>
            <button type="button" className="btn" disabled={busy||permissionSource.trim().length<12}
               onClick={()=>void recordPermission()}>
              Catat sumber izin untuk seluruh daftar
            </button>
          </div>}
          <div className="campaignTestPanel section">
            <strong>Kirim langsung ke nomor yang ditambahkan di Blash</strong>
            <p className="muted">{eligibleCount} nomor berizin siap diproses dari daftar Blash ini. Tidak perlu masuk menu Kontak. Nomor yang sudah pernah di-Blash dan opt-out tetap dilewati.</p>
            {eligibleCount===0&&<p className="notice">Belum ada penerima baru yang memenuhi syarat dalam draft ini. Buat Blash baru, lalu masukkan nomor melalui Excel, tempel massal, atau ketik langsung di bagian Penerima. Tidak perlu membuka menu Kontak.</p>}
            <div className="blashSendMode" role="group" aria-label="Waktu pengiriman">
              <button className={"btn "+(sendMode==="NOW"?"primary":"")} aria-pressed={sendMode==="NOW"} onClick={()=>setSendMode("NOW")}>Kirim sekarang</button>
              <button className={"btn "+(sendMode==="LATER"?"primary":"")} aria-pressed={sendMode==="LATER"} onClick={()=>setSendMode("LATER")}>Jadwalkan</button>
            </div>
            {sendMode==="LATER"&&
            <label className="fieldLabel">
              Tanggal dan jam (WIB)
              <input
                className="input"
                type="datetime-local"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
              />
            </label>}
            <button
              className="btn primary"
              disabled={busy || eligibleCount<1 || !readiness?.worker_online || (readiness?.has_image && !readiness?.image_supported) || (sendMode==="LATER"&&!schedule)}
              onClick={() => { setActionError(""); setNotice(""); setConfirm(sendMode==="LATER" ? "SCHEDULE" : "START"); }}
            >
              {sendMode==="LATER" ? "Simpan jadwal pengiriman" : "Kirim ke "+eligibleCount+" penerima"}
            </button>
          </div>
        </>
      )}
      {confirm && (
        <div className="notice section campaignActionConfirm" role="group" aria-label="Konfirmasi Blash">
          <b>
            {confirm === "CANCEL"
              ? "Batalkan sisa pengiriman?"
              : confirm === "SCHEDULE" ? "Jadwalkan Blash untuk " + new Date(schedule + ":00+07:00").toLocaleString("id-ID", {timeZone:"Asia/Jakarta",dateStyle:"medium",timeStyle:"short"}) + " WIB?"
              : "Mulai Blash untuk " + eligibleCount + " kontak bernomor WhatsApp?"}
          </b>
          <p>Server akan memeriksa nomor WhatsApp, pengecualian owner, duplikasi, dan kesiapan worker. Pesan yang sudah dikirim tidak dapat ditarik kembali.</p>
          {actionError && <div className="notice errorNotice campaignInlineError" role="alert"><strong>Tidak dapat melanjutkan:</strong> {actionError}</div>}
          <div className="actions">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void action(confirm)}
            >
              {busy ? "Memeriksa…" : confirm === "CANCEL" ? "Ya, batalkan" : confirm === "SCHEDULE" ? "Ya, jadwalkan" : "Ya, mulai"}
            </button>
            <button className="btn" disabled={busy} onClick={() => {setConfirm("");setActionError("");}}>
              Kembali
            </button>
          </div>
        </div>
      )}
      {(error || notice || (actionError && !confirm)) && (
        <div className={"notice section "+((error||actionError)?"errorNotice":"")} role={(error||actionError)?"alert":"status"}>
          {error || actionError || notice}
        </div>
      )}
      <details className="blashExtra section"><summary>Arti status pengiriman</summary><p>Diterima gateway berarti pesan diterima pengirim WhatsApp. Status Sampai dan Dibaca menunggu laporan dari WhatsApp. Pengiriman yang belum pasti tidak diulang otomatis.</p></details>
      <div className="tableWrap section campaignDetailTable">
        <table className="table">
          <thead>
            <tr>
              <th>Penerima</th>
              <th>Pesan</th>
              <th>Balasan</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {data.recipients.map((r: any) => (
              <tr key={r.id}>
                <td data-label="Penerima">
                  <b>{r.name}</b>
                  <div className="muted">+{r.phone}</div>
                </td>
                <td data-label="Pesan">
                  {r.excluded_reason ||
                    data.jobs
                      .filter((j: any) => j.recipient_id === r.id)
                      .map((j: any) => (
                        <div key={j.id}>
                          <span
                            className={
                              "badge " +
                              (["FAILED", "UNKNOWN"].includes(j.status)
                                ? "warn"
                                : "")
                            }
                          >
                            {j.step_no}.{" "}
                            {labels[j.delivery_status || j.status] || j.status}
                          </span>
                          {j.last_error && (
                            <small className="muted">{j.last_error}</small>
                          )}
                        </div>
                      ))}
                </td>
                <td data-label="Balasan">{r.replied_at ? "Sudah membalas" : "Belum ada balasan"}</td>
                <td data-label="Aksi">
                  <Link
                    className="btn"
                    href={
                      "/inbox?chat=" + encodeURIComponent(r.phone + "@c.us")
                    }
                  >
                    Buka chat
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions section"><button className="btn" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Sebelumnya</button><span>Halaman {offset/50+1}</span><button className="btn" disabled={data.recipients.length<50} onClick={()=>setOffset(offset+50)}>Berikutnya</button></div>
      <details className="section">
        <summary>Riwayat aktivitas</summary>
        {data.audit.map((a: any) => (
          <p key={a.id}>
            {new Date(a.created_at).toLocaleString("id-ID", {
              timeZone: "Asia/Jakarta",
            })}{" "}
            · {a.action}
          </p>
        ))}
      </details>
    </section>
  );
}
export default function Campaigns() {
  const [listOffset,setListOffset]=useState(0);
  const { data, error, loading, refresh } = useCampaignData("?offset="+listOffset);
  const [editor, setEditor] = useState(false),
    [active, setActive] = useState("");
  useEffect(()=>{if(editor||active)document.getElementById("blash-workspace")?.scrollIntoView({block:"start"})},[editor,active]);
  const campaigns = data?.campaigns || [];
  const runtime = data?.runtime?.[0];
  const online =
    runtime && Date.now() - new Date(runtime.last_seen).getTime() < 90000;
  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Blash WhatsApp</h1>
          <p>Kirim poster, pesan, atau video ke pelanggan dari satu tempat.</p>
        </div>
        <div className="actions">
          <Link className="btn" href="/campaigns/intelligence">Materi produk & AI</Link>
          <button
            className="btn"
            onClick={async () => {
              await campaignRequest({ action: "pause_all" });
              await refresh();
            }}
          >
            Jeda semua Blash
          </button>
          <button
            className="btn primary"
            onClick={() => {
              setEditor(true);
              setActive("");
            }}
          >
            + Buat Blash
          </button>
        </div>
      </div>
      {!editor && !active && <div className="campaignMetrics">
        <div className="card">
          <small>Blash berjalan</small>
          <strong>
            {campaigns.filter((c: any) => c.status === "RUNNING").length}
          </strong>
        </div>
        <div className="card">
          <small>Kontak membalas Blash</small>
          <strong>
            {campaigns.reduce((n: number, c: any) => n + Number(c.replies), 0)}
          </strong>
        </div>
        <div className="card">
          <small>Koneksi WhatsApp</small>
          <b>{online ? "Terhubung" : "Belum terhubung"}</b>
          <p className="muted">
            {runtime
              ? "Terakhir " +
                new Date(runtime.last_seen).toLocaleString("id-ID", {
                  timeZone: "Asia/Jakarta",
                })
              : "Draft dan kontak dapat disiapkan."}
          </p>
        </div>
      </div>}
      {!online && (
        <div className="notice section">
          {loading ? "Memeriksa sambungan WhatsApp…" : "WhatsApp belum terhubung. Draft tetap bisa disimpan."}{" "}
          <Link href="/integrations">Periksa integrasi</Link>
        </div>
      )}
      {error && (
        <div className="notice errorNotice section" role="alert">
          {error}
        </div>
      )}
      <div id="blash-workspace" className="blashWorkspace">{editor ? (
        <CampaignEditor
          videoSupported={Boolean(runtime?.video_supported && online)}
          imageSupported={Boolean(runtime?.image_supported && online)}
          products={data?.products || []}
          onClose={() => setEditor(false)}
          onDone={(id) => {
            setEditor(false);
            setActive(id);
            void refresh();
          }}
        />
      ) : active ? (
        <Detail
          id={active}
          onClose={() => setActive("")}
          onChange={() => void refresh()}
        />
      ) : (
        <div className="campaignList section">
          {campaigns.map((c: any) => (
            <button
              className="card campaignCard"
              key={c.id}
              onClick={() => setActive(c.id)}
            >
              <div className="sectionTitle">
                <h2>{c.name}</h2>
                <span
                  className={"badge " + (c.status === "RUNNING" ? "ok" : "")}
                >
                  {labels[c.status]}
                </span>
              </div>
              <p className="muted">
                {c.product_id} · {c.recipients} penerima · {c.step_count}{" "}
                pesan
              </p>
              <div className="campaignProgress">
                <span
                  style={{
                    width:
                      (c.total
                        ? (100 * Number(c.accepted)) / Number(c.total)
                        : 0) + "%",
                  }}
                />
              </div>
              <div className="campaignCounts">
                <span>
                  <b>{c.accepted}</b> diterima gateway
                </span>
                <span>
                  <b>{c.replies}</b> membalas
                </span>
                <span>
                  <b>{c.unknown}</b> belum pasti
                </span>
              </div>
            </button>
          ))}
          {!campaigns.length && (
            <div className="card empty">
              <strong>
                {loading ? "Memuat Blash…" : "Siapkan Blash pertamamu"}
              </strong>
              Pilih Buat Blash, tambahkan penerima, lalu unggah poster atau tulis pesan.
            </div>
          )}
        </div>
      )}</div>
      {!editor && !active && campaigns.length>0 && <div className="actions section"><button className="btn" disabled={!listOffset} onClick={()=>setListOffset(Math.max(0,listOffset-20))}>Sebelumnya</button><span>Halaman {listOffset/20+1}</span><button className="btn" disabled={campaigns.length<20} onClick={()=>setListOffset(listOffset+20)}>Berikutnya</button></div>}
    </>
  );
}
