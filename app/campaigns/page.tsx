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
    [busy, setBusy] = useState(false),
    [schedule, setSchedule] = useState(""),
    [testPhone, setTestPhone] = useState(""),
    [confirm, setConfirm] = useState("");
  const c = data?.campaign;
  async function action(action: string) {
    setBusy(true);
    try {
      await campaignRequest({
        action,
        id,
        schedule: schedule ? schedule + ":00+07:00" : null,
      });
      setNotice("Perubahan tersimpan");
      setConfirm("");
      await refresh();
      onChange();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    try {
      const r = await campaignRequest({ action: "test", id, phone: testPhone });
      setNotice("Uji masuk antrean. Buka kampanye uji untuk memeriksa hasil.");
      await refresh();
      onChange();
    } catch (e) {
      setNotice((e as Error).message);
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
          {error || (loading ? "Memuat detail…" : "Kampanye tidak ditemukan")}
        </p>
      </div>
    );
  return (
    <section className="card section">
      <div className="pageHead">
        <div>
          <button className="linkBtn" onClick={onClose}>
            ← Semua kampanye
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
              onClick={() => setConfirm(schedule ? "SCHEDULE" : "START")}
            >
              {schedule ? "Jadwalkan" : "Mulai kampanye"}
            </button>
          </div>
          <p className="muted">
            Uji harus diterima gateway terlebih dahulu. Mulai hanya setelah kamu
            memeriksa video dan teks di WhatsApp. Konten dikunci ketika dikirim.
          </p>
        </>
      )}
      {confirm && (
        <div className="notice section" role="alert">
          <b>
            {confirm === "CANCEL"
              ? "Batalkan sisa pengiriman?"
              : "Kirim ke " + data.recipients.length + " penerima?"}
          </b>
          <p>Pesan yang sudah diproses gateway tidak dapat ditarik kembali.</p>
          <div className="actions">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void action(confirm)}
            >
              Ya, {confirm === "CANCEL" ? "batalkan" : "lanjutkan"}
            </button>
            <button className="btn" onClick={() => setConfirm("")}>
              Kembali
            </button>
          </div>
        </div>
      )}
      {(error || notice) && (
        <div className="notice section" role="status">
          {error || notice}
        </div>
      )}
      <div className="notice section">
        Diterima gateway belum berarti sampai atau dibaca. UNKNOWN memerlukan
        rekonsiliasi; tidak dikirim ulang otomatis.
      </div>
      <div className="tableWrap section">
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
                <td>
                  <b>{r.name}</b>
                  <div className="muted">+{r.phone}</div>
                </td>
                <td>
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
                <td>{r.replied_at ? "Sudah membalas" : "Belum ada balasan"}</td>
                <td>
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
          <h1>Kampanye WhatsApp</h1>
          <p>Kirim promosi, tangani balasan, pantau hasil per kontak.</p>
        </div>
        <div className="actions">
          <button
            className="btn"
            onClick={async () => {
              await campaignRequest({ action: "pause_all" });
              await refresh();
            }}
          >
            Jeda semua kampanye
          </button>
          <button
            className="btn primary"
            onClick={() => {
              setEditor(true);
              setActive("");
            }}
          >
            + Buat kampanye
          </button>
        </div>
      </div>
      <div className="campaignMetrics">
        <div className="card">
          <small>Kampanye berjalan</small>
          <strong>
            {campaigns.filter((c: any) => c.status === "RUNNING").length}
          </strong>
        </div>
        <div className="card">
          <small>Kontak membalas kampanye</small>
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
          Pengiriman menunggu worker kampanye v2.{" "}
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
                {loading ? "Memuat kampanye…" : "Siapkan kampanye pertamamu"}
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
