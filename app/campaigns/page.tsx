"use client";
import { useState } from "react";
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
    [testPhone, setTestPhone] = useState(""),
    [confirm, setConfirm] = useState("");
  const c = data?.campaign;
  const readiness = data?.readiness;
  const testReady = readiness?.test_status === "SENT";
  const eligibleCount = readiness?.eligible_total ?? 0;
  async function action(action: string) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
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
  async function test() {
    if (busy) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      await campaignRequest({ action: "test", id, phone: testPhone });
      setNotice("Pesan uji masuk antrean. Tunggu status Diterima gateway dan cek video di WhatsApp milikmu sebelum memulai Blash.");
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
          <div className="campaignReadiness section" role="status">
            <strong>Siapkan pengiriman Blash</strong>
            <div className="campaignReadinessGrid">
              <span className={eligibleCount > 0 ? "ready" : "blocked"}>1. {eligibleCount} penerima memenuhi syarat izin</span>
              <span className={testReady ? "ready" : "blocked"}>2. {testReady ? "Uji diterima gateway" : "Uji pengiriman belum berhasil"}</span>
              <span className={readiness?.has_video && !readiness?.video_supported && !testReady ? "blocked" : "ready"}>3. {readiness?.has_video ? "Video: lakukan uji ke nomor sendiri" : "Pesan teks siap diuji"}</span>
            </div>
            {eligibleCount === 0 && <p className="muted">Semua penerima belum berizin atau dikecualikan. Draft boleh disimpan, tetapi Blash tidak dapat mengirim sebelum izin promosi pelanggan tercatat.</p>}
          </div>
          <div className="campaignToolbar section">
            <input
              className="input"
              aria-label="Nomor uji"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="Nomor WhatsApp milikmu untuk uji"
            />
            <button
              className="btn"
              disabled={busy || !testPhone}
              onClick={() => void test()}
            >
              Kirim uji ke nomor ini
            </button>
          </div>
          <div className="campaignToolbar section">
            <label className="fieldLabel">
              Jadwal WIB
              <input
                className="input"
                type="datetime-local"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
              />
            </label>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => { setActionError(""); setNotice(""); setConfirm(schedule ? "SCHEDULE" : "START"); }}
            >
              {schedule ? "Jadwalkan Blash" : "Mulai Blash"}
            </button>
          </div>
          <p className="muted">
            Uji ke nomor WhatsApp sendiri wajib diterima gateway sebelum Blash dijadwalkan atau dimulai. Untuk video, periksa juga apakah MP4 benar-benar diterima dan bisa diputar.
          </p>
        </>
      )}
      {confirm && (
        <div className="notice section campaignActionConfirm" role="group" aria-label="Konfirmasi Blash">
          <b>
            {confirm === "CANCEL"
              ? "Batalkan sisa pengiriman?"
              : confirm === "SCHEDULE" ? "Jadwalkan Blash untuk " + new Date(schedule + ":00+07:00").toLocaleString("id-ID", {timeZone:"Asia/Jakarta",dateStyle:"medium",timeStyle:"short"}) + " WIB?"
              : "Mulai Blash untuk " + (c?.recipient_count ?? data.recipients.length) + " penerima?"}
          </b>
          <p>Server akan memeriksa izin promosi, hasil uji, dan kesiapan worker. Pesan yang sudah dikirim tidak dapat ditarik kembali.</p>
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
      <div className="notice section">
        Diterima gateway belum berarti sampai atau dibaca. UNKNOWN memerlukan
        rekonsiliasi; tidak dikirim ulang otomatis.
      </div>
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
  const campaigns = data?.campaigns || [];
  const runtime = data?.runtime?.[0];
  const online =
    runtime && Date.now() - new Date(runtime.last_seen).getTime() < 90000;
  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Blash WhatsApp</h1>
          <p>Kelola penawaran, bekali AI dengan pengetahuan produk, dan pantau pengiriman.</p>
        </div>
        <div className="actions">
          <Link className="btn" href="/campaigns/intelligence">Materi Promosi & Otak AI</Link>
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
      <div className="campaignMetrics">
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
          <small>Pengirim v2</small>
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
      </div>
      {!online && (
        <div className="notice section">
          Pengiriman menunggu worker Blash v2.{" "}
          <a href="/api/campaigns/workflow">Pengirim v2</a> ·{" "}
          <a href="/api/campaigns/workflow?kind=inbound">Penerima + delivery</a>{" "}
          · <a href="/api/campaigns/workflow?kind=ai">Bot Groq + CRM</a> ·{" "}
          <Link href="/integrations">Periksa integrasi</Link>
        </div>
      )}
      {error && (
        <div className="notice errorNotice section" role="alert">
          {error}
        </div>
      )}
      {editor ? (
        <CampaignEditor
          videoSupported={Boolean(runtime?.video_supported && online)}
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
                {loading ? "Memuat kampanye…" : "Siapkan Blash pertamamu"}
              </strong>
              Import kontak, pilih produk, lalu susun video dan pesan.
              Pengiriman selalu dimulai dari tindakanmu.
            </div>
          )}
        </div>
      )}
      <div className="actions section"><button className="btn" disabled={!listOffset} onClick={()=>setListOffset(Math.max(0,listOffset-20))}>Sebelumnya</button><span>Halaman {listOffset/20+1}</span><button className="btn" disabled={campaigns.length<20} onClick={()=>setListOffset(listOffset+20)}>Berikutnya</button></div>
    </>
  );
}
