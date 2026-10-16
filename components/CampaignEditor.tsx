"use client";
import { useState } from "react";
import Link from "next/link";
import { CampaignStep, campaignRequest, validateSteps } from "@/lib/campaigns";
import { useCampaignData } from "./useCampaignData";
export default function CampaignEditor({
  products,
  onDone,
  onClose,
}: {
  products: any[];
  onDone: (id: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0);
  const { data } = useCampaignData(
    "?view=contacts&q=" + encodeURIComponent(search) + "&offset=" + offset,
  );
  const [step, setStep] = useState(0),
    [name, setName] = useState(""),
    [product, setProduct] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [steps, setSteps] = useState<CampaignStep[]>([{ type: "TEXT", body: "" }]),
    [bot, setBot] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const contacts = (data?.contacts || []).filter(
    (c: any) => c.consent && !c.opted_out_at,
  );
  const visible = contacts.filter((c: any) =>
    (c.name + " " + c.phone + " " + c.tags)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  function next() {
    try {
      if (step === 0 && (!name.trim() || !product))
        throw new Error("Isi nama kampanye dan pilih produk");
      if (step === 1 && !selected.length)
        throw new Error("Pilih setidaknya satu penerima");
      if (step === 2) validateSteps(steps);
      setError("");
      setStep(Math.min(4, step + 1));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await campaignRequest({
        action: "create",
        campaign: {
          name,
          product_id: product,
          phones: selected,
          steps,
          bot_enabled: bot,
        },
      });
      onDone(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(i: number, file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await fetch("/api/campaigns/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: file.type, size: file.size }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      const put = await fetch(d.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type, "x-upsert": "false" },
        body: file,
      });
      if (!put.ok) throw new Error("Upload video gagal");
      edit(i, { media_url: d.path });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(i: number, patch: Partial<CampaignStep>) {
    setSteps(steps.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  }
  return (
    <section className="card campaignEditor">
      <div className="sectionTitle">
        <h2>Buat kampanye</h2>
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      </div>
      <ol className="campaignStepper">
        {["Produk", "Penerima", "Pesan", "Bot", "Tinjau"].map((s, i) => (
          <li
            key={s}
            className={step === i ? "current" : step > i ? "done" : ""}
          >
            <span>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      {step === 0 && (
        <div className="formGrid">
          <label className="fieldLabel span2">
            Nama kampanye
            <input
              className="input"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Promosi Sekolapro Oktober"
            />
          </label>
          <label className="fieldLabel span2">
            Produk
            <select
              className="input"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            >
              <option value="">Pilih produk</option>
              {products.map((p) => (
                <option key={p.source_key} value={p.source_key}>
                  {p.payload.product_name || p.payload.name || p.source_key}
                </option>
              ))}
            </select>
          </label>
          <div className="notice span2">
            Balasan akan membawa konteks produk ini ke Kendaliku. Harga dan
            tautan tetap mengambil katalog produk.
          </div>
        </div>
      )}
      {step === 1 && (
        <>
          <div className="campaignToolbar">
            <input
              className="input"
              placeholder="Cari nama, label, nomor…"
              aria-label="Cari penerima"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
            <button
              className="btn"
              onClick={async()=>{try{const d=await campaignRequest(undefined,'?view=selection&q='+encodeURIComponent(search));setSelected(d.phones)}catch(e){setError((e as Error).message)}}}
            >
              Pilih hingga 1.000 hasil
            </button>
            <button className="btn" onClick={() => setSelected([])}>
              Kosongkan
            </button>
          </div>
          <p>
            {selected.length} dipilih · {contacts.length} kontak dengan izin
            promosi. <Link href="/contacts">Kelola kontak</Link>
          </p>
          <div className="recipientPicker">
            {visible.map((c: any) => (
              <label key={c.phone} className="checkLine">
                <input
                  type="checkbox"
                  checked={selected.includes(c.phone)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? Array.from(new Set([...selected, c.phone])).slice(
                            0,
                            1000,
                          )
                        : selected.filter((p) => p !== c.phone),
                    )
                  }
                />
                <span>
                  <b>{c.name}</b>
                  <small>
                    +{c.phone} · {c.tags || "Tanpa label"}
                  </small>
                </span>
              </label>
            ))}
            {!visible.length && (
              <div className="empty">
                Belum ada kontak yang memenuhi filter dan izin promosi.
              </div>
            )}
          </div>
          <div className="actions section">
            <button
              className="btn"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Sebelumnya
            </button>
            <span>Halaman {offset / 50 + 1}</span>
            <button
              className="btn"
              disabled={(data?.contacts?.length || 0) < 50}
              onClick={() => setOffset(offset + 50)}
            >
              Berikutnya
            </button>
          </div>
        </>
      )}
      {step === 2 && (
        <div className="campaignCompose">
          <div>
            {steps.map((s, i) => (
              <div className="messageEditor" key={i}>
                <div className="sectionTitle">
                  <h3>Pesan {i + 1}</h3>
                  {i > 0 && (
                    <button
                      className="linkBtn dangerText"
                      onClick={() => setSteps(steps.slice(0, 1))}
                    >
                      Hapus
                    </button>
                  )}
                </div>
                <label className="fieldLabel">
                  Bentuk pesan
                  <select
                    className="input"
                    value={s.type}
                    onChange={(e) =>
                      edit(i, { type: e.target.value as CampaignStep["type"] })
                    }
                  >
                    <option value="TEXT">Teks</option>
                    <option value="VIDEO">Video + caption</option>
                  </select>
                </label>
                {s.type === "VIDEO" && (
                  <div>
                    <label className="fieldLabel">
                      Unggah MP4 (maks. 25 MB)
                      <input
                        className="input"
                        type="file"
                        accept="video/mp4"
                        disabled={busy}
                        onChange={(e) => void upload(i, e.target.files?.[0])}
                      />
                    </label>
                    <label className="fieldLabel">
                      URL video HTTPS
                      <input
                        className="input"
                        value={s.media_url || ""}
                        onChange={(e) => edit(i, { media_url: e.target.value })}
                        placeholder="https://…/video.mp4"
                      />
                      <small>
                        Gunakan link file langsung. Dukungan video dan format
                        diuji sebelum kirim.
                      </small>
                    </label>
                  </div>
                )}
                <label className="fieldLabel">
                  {s.type === "VIDEO" ? "Caption" : "Isi pesan"}
                  <textarea
                    className="input"
                    rows={6}
                    maxLength={4000}
                    value={s.body}
                    onChange={(e) => edit(i, { body: e.target.value })}
                    placeholder="Halo {{nama}}, …"
                  />
                </label>
                <small className="muted">
                  {s.body.length}/4.000 · {"{{nama}}"} untuk nama penerima
                </small>
              </div>
            ))}
            {steps.length < 2 && (
              <button
                className="btn"
                onClick={() =>
                  setSteps([...steps, { type: "VIDEO", body: "" }])
                }
              >
                + Tambah pesan kedua
              </button>
            )}
          </div>
          <aside className="messagePreview">
            <small>PREVIEW PENERIMA</small>
            <h3>
              {contacts.find((c: any) => selected.includes(c.phone))?.name ||
                "Nama pelanggan"}
            </h3>
            {steps.map((s, i) => (
              <div className="previewBubble" key={i}>
                {s.type === "VIDEO" && (
                  <div className="videoPlaceholder">▷ Video promosi</div>
                )}
                <p>
                  {s.body.replaceAll(
                    "{{nama}}",
                    contacts.find((c: any) => selected.includes(c.phone))
                      ?.name || "Pelanggan",
                  ) || "Pesan akan tampil di sini."}
                </p>
              </div>
            ))}
          </aside>
        </div>
      )}
      {step === 3 && (
        <>
          <label className="checkLine">
            <input
              type="checkbox"
              checked={bot}
              onChange={(e) => setBot(e.target.checked)}
            />
            <span>
              <b>Kendaliku menangani balasan kampanye</b>
              <small>
                Bot tetap mengikuti master switch dan pengambilalihan admin.
              </small>
            </span>
          </label>
          <div className="notice section">
            Pesan promosi berikutnya berhenti ketika pelanggan membalas.
            Follow-up proaktif mengikuti pengaturan yang sudah ada; kampanye ini
            tidak menambahkan jadwal follow-up otomatis.
          </div>
          <p className="muted">
            Bot menjawab dari katalog produk dan riwayat kontak. Pembayaran
            memerlukan verifikasi.
          </p>
        </>
      )}
      {step === 4 && (
        <>
          <div className="campaignReview">
            <div>
              <small>Kampanye</small>
              <b>{name}</b>
            </div>
            <div>
              <small>Penerima</small>
              <b>{selected.length} kontak</b>
            </div>
            <div>
              <small>Pesan</small>
              <b>{steps.length} bagian per kontak</b>
            </div>
            <div>
              <small>Bot</small>
              <b>{bot ? "Aktif saat membalas" : "Ditangani admin"}</b>
            </div>
          </div>
          <div className="notice section">
            Simpan sebagai draft terlebih dahulu. Dari detail kampanye, kirim
            uji ke nomor sendiri dan periksa hasilnya sebelum mulai atau
            menjadwalkan.
          </div>
        </>
      )}
      {error && (
        <div className="notice errorNotice section" role="alert">
          {error}
        </div>
      )}
      <div className="actions section">
        <button
          className="btn"
          disabled={!step || busy}
          onClick={() => setStep(step - 1)}
        >
          Kembali
        </button>
        {step < 4 ? (
          <button className="btn primary" disabled={busy} onClick={next}>
            Lanjutkan
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Menyimpan…" : "Simpan draft"}
          </button>
        )}
      </div>
    </section>
  );
}
