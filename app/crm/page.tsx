"use client";
import Link from "next/link";
import { useState } from "react";
import { campaignRequest } from "@/lib/campaigns";
import { useCampaignData } from "@/components/useCampaignData";
const stages: Record<string, string> = {
  NEW: "Baru",
  INTERESTED: "Tertarik",
  FOLLOW_UP: "Follow-up",
  AWAITING_PAYMENT: "Menunggu pembayaran",
  WON: "Menang",
  LOST: "Tidak lanjut",
};
export default function CRM() {
  const { data, error, loading, refresh } = useCampaignData("?view=crm");
  const { data: contacts } = useCampaignData("?view=contacts");
  const [filter, setFilter] = useState(""),
    [active, setActive] = useState<any>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const rows = (data?.opportunities || []).filter(
    (o: any) => !filter || o.stage === filter,
  );
  async function save() {
    if (!active) return;
    setBusy(true);
    try {
      await campaignRequest({ action: "opportunity", ...active });
      setActive(null);
      setNotice("Peluang diperbarui oleh admin");
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="pageHead">
        <div>
          <h1>CRM per produk</h1>
          <p>Pantau kebutuhan, tindak lanjut, dan pembelian setiap kontak.</p>
        </div>
        <Link className="btn" href="/sales">
          Pipeline lama
        </Link>
      </div>
      <div className="crmStageTabs">
        <button
          className={"btn " + (!filter ? "primary" : "")}
          onClick={() => setFilter("")}
        >
          Semua
        </button>
        {Object.entries(stages).map(([id, label]) => (
          <button
            key={id}
            className={"btn " + (filter === id ? "primary" : "")}
            onClick={() => setFilter(id)}
          >
            {label}{" "}
            <span className="badge">
              {
                (data?.opportunities || []).filter((o: any) => o.stage === id)
                  .length
              }
            </span>
          </button>
        ))}
      </div>
      {(error || notice) && (
        <div className="notice section" role="status">
          {error || notice}
        </div>
      )}
      {active && (
        <section className="card section">
          <h2>Edit peluang · {active.product_id}</h2>
          <div className="formGrid">
            <label className="fieldLabel">
              Tahap
              <select
                className="input"
                value={active.stage}
                onChange={(e) =>
                  setActive({ ...active, stage: e.target.value })
                }
              >
                {Object.entries(stages).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="fieldLabel">
              Pengingat follow-up WIB
              <input
                className="input"
                type="datetime-local"
                value={
                  active.next_followup_at
                    ? new Date(
                        new Date(active.next_followup_at).getTime() +
                          7 * 3600000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(e) =>
                  setActive({
                    ...active,
                    next_followup_at: e.target.value
                      ? e.target.value + ":00+07:00"
                      : null,
                  })
                }
              />
            </label>
            <label className="fieldLabel span2">
              Catatan
              <textarea
                className="input"
                rows={4}
                value={active.note}
                onChange={(e) => setActive({ ...active, note: e.target.value })}
              />
            </label>
          </div>
          {active.stage === "WON" && (
            <p className="notice">
              Menang di CRM merupakan keputusan admin. Tindakan ini tidak
              mengubah pembayaran menjadi PAID.
            </p>
          )}
          <div className="actions section">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void save()}
            >
              Simpan
            </button>
            <button className="btn" onClick={() => setActive(null)}>
              Batal
            </button>
          </div>
        </section>
      )}
      <div className="campaignList section">
        {rows.map((o: any) => {
          const c = contacts?.contacts?.find(
            (c: any) => c.phone === o.chat_id.split("@")[0],
          );
          return (
            <article className="card" key={o.id}>
              <div className="sectionTitle">
                <h2>{c?.name || o.chat_id.split("@")[0]}</h2>
                <span className="badge">{stages[o.stage]}</span>
              </div>
              <p>{o.product_id}</p>
              <p className="muted">
                {o.note || "Belum ada catatan kebutuhan."}
              </p>
              {o.next_followup_at && (
                <p>
                  Follow-up:{" "}
                  {new Date(o.next_followup_at).toLocaleString("id-ID", {
                    timeZone: "Asia/Jakarta",
                  })}
                </p>
              )}
              <div className="actions">
                <Link
                  className="btn"
                  href={"/inbox?chat=" + encodeURIComponent(o.chat_id)}
                >
                  Buka chat
                </Link>
                <button className="btn" onClick={() => setActive({ ...o })}>
                  Detail / edit
                </button>
              </div>
            </article>
          );
        })}
        {!rows.length && (
          <div className="card empty">
            <strong>
              {loading ? "Memuat CRM…" : "Belum ada peluang pada tahap ini"}
            </strong>
            Peluang per produk terbentuk ketika kampanye dimulai. Pipeline lama
            tetap tersedia.
          </div>
        )}
      </div>
      <p className="muted">
        Pengingat di CRM tidak otomatis mengirim pesan. Pengiriman follow-up
        mengikuti aturan bot dan izin pelanggan.
      </p>
    </>
  );
}
