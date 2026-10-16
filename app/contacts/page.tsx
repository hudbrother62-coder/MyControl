"use client";
import Link from "next/link";
import ContactExclusions from "@/components/ContactExclusions";
import { useMemo, useState } from "react";
import { campaignRequest, parseContacts } from "@/lib/campaigns";
import { useCampaignData } from "@/components/useCampaignData";
export default function Contacts() {
  const [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0);
  const { data, error, loading, refresh } = useCampaignData(
    "?view=contacts&offset=" + offset + "&q=" + encodeURIComponent(search),
  );
  const [raw, setRaw] = useState(""),
    [source, setSource] = useState(""),
    [consent, setConsent] = useState(false),
    [preview, setPreview] = useState<ReturnType<typeof parseContacts> | null>(
      null,
    ),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  const contacts = data?.contacts || [];
  const eligible = useMemo(
    () => contacts.filter((c: any) => c.consent && !c.opted_out_at && !c.exclusion).length,
    [contacts],
  );
  function parse(text = raw) {
    try {
      setPreview(parseContacts(text));
      setNotice("");
    } catch (e) {
      setNotice((e as Error).message);
      setPreview(null);
    }
  }
  async function file(f?: File) {
    if (!f) return;
    try {
      if (f.size > 5_000_000) throw new Error("Maksimal ukuran file 5 MB");
      let text = "";
      if (/\.xlsx$/i.test(f.name)) {
        const { Workbook } = await import("exceljs");
        const wb = new Workbook();
        await wb.xlsx.load(await f.arrayBuffer());
        const sheet = wb.worksheets[0];
        if (!sheet) throw new Error("Sheet kosong");
        const lines: string[] = [];
        sheet.eachRow((row) => {
          lines.push(
            [1, 2, 3]
              .map(
                (i) =>
                  '"' +
                  String(row.getCell(i).text || "").replaceAll('"', '""') +
                  '"',
              )
              .join(","),
          );
        });
        text = lines.join("\n");
      } else text = await f.text();
      setRaw(text);
      parse(text);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function save() {
    if (!preview?.contacts.length || busy) return;
    setBusy(true);
    try {
      const r = await campaignRequest({
        action: "import",
        contacts: preview.contacts.map((c) => ({ ...c, source, consent })),
      });
      setNotice(
        r.processed +
          " kontak tersimpan. Nomor ganda diperbarui tanpa membuka blokir promosi.",
      );
      setPreview(null);
      setRaw("");
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ContactExclusions/>
      <div className="pageHead">
        <div>
          <h1>Kontak</h1>
          <p>Satu kontak, seluruh percakapan dan riwayat promosi.</p>
        </div>
        <button className="btn primary" onClick={() => setShow(!show)}>
          + Import kontak
        </button>
      </div>
      <div className="campaignMetrics">
        <div className="card">
          <small>Kontak di halaman ini</small>
          <strong>{contacts.length}</strong>
        </div>
        <div className="card">
          <small>Memiliki izin promosi</small>
          <strong>{eligible}</strong>
        </div>
        <div className="card">
          <small>Privasi kontak</small>
          <p>Permintaan berhenti tetap berlaku saat import ulang.</p>
        </div>
      </div>
      {show && (
        <section className="card section">
          <div className="sectionTitle">
            <h2>Import Excel atau CSV</h2>
            <a
              className="btn"
              href="data:text/csv;charset=utf-8,nama%2Cnomor%2Clabel%0AContoh%2C081234567890%2Csekolah"
              download="template-kontak.csv"
            >
              Template CSV
            </a>
          </div>
          <p className="muted">
            Urutan kolom Excel: nama, nomor, label. Maksimal 1.000 kontak; nomor
            disimpan dengan kode negara.
          </p>
          <label className="fieldLabel">
            Pilih file
            <input
              className="input"
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => void file(e.target.files?.[0])}
            />
          </label>
          <label className="fieldLabel">
            Atau tempel CSV
            <textarea
              className="input"
              rows={5}
              value={raw}
              placeholder={"nama,nomor,label\nBu Ani,081234567890,sekolah"}
              onChange={(e) => {
                setRaw(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <div className="actions">
            <button className="btn" onClick={() => parse()}>
              Periksa data
            </button>
          </div>
          {preview && (
            <>
              <div className="notice section">
                {preview.contacts.length} valid · {preview.duplicates} duplikat
                · {preview.errors.length} baris bermasalah
              </div>
              {preview.errors.length > 0 && (
                <details>
                  <summary>Lihat baris yang dilewati</summary>
                  {preview.errors.map((x) => (
                    <p key={x}>{x}</p>
                  ))}
                </details>
              )}
              <div className="contactPreview">
                {preview.contacts.slice(0, 5).map((c) => (
                  <div key={c.phone}>
                    <b>{c.name}</b>
                    <span>{c.phone}</span>
                  </div>
                ))}
              </div>
              <label className="fieldLabel">
                Sumber kontak / bukti izin
                <input
                  className="input"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Contoh: formulir pelanggan, 16 Oktober 2026"
                />
              </label>
              <label className="checkLine">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Kontak pada import ini telah mengizinkan pesan promosi.
              </label>
              <button
                className="btn primary"
                disabled={
                  busy ||
                  !preview.contacts.length ||
                  (consent && !source.trim())
                }
                onClick={() => void save()}
              >
                {busy
                  ? "Menyimpan…"
                  : "Simpan " + preview.contacts.length + " kontak"}
              </button>
            </>
          )}
        </section>
      )}
      {(error || notice) && (
        <div className="notice section" role="status">
          {error || notice}
        </div>
      )}
      <div className="campaignToolbar section">
        <input
          className="input"
          aria-label="Cari kontak"
          placeholder="Cari nama atau nomor…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <button className="btn" onClick={() => void refresh()}>
          Perbarui
        </button>
      </div>
      <div className="card tableWrap section">
        <table className="table">
          <thead>
            <tr>
              <th>Kontak</th>
              <th>Label</th>
              <th>Promosi</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c: any) => (
              <tr key={c.phone}>
                <td>
                  <b>{c.name}</b>
                  <div className="muted">+{c.phone}</div>
                </td>
                <td>{c.tags || "—"}</td>
                <td>
                  <span
                    className={
                      "badge " + (c.consent && !c.opted_out_at && !c.exclusion ? "ok" : "warn")
                    }
                  >
                    {c.exclusion ? "Dikecualikan" : c.opted_out_at
                      ? "Berhenti"
                      : c.consent
                        ? "Diizinkan"
                        : "Belum ada izin"}
                  </span>
                </td>
                <td>
                  <div className="actions">
                    <Link
                      className="btn"
                      href={
                        "/inbox?chat=" + encodeURIComponent(c.phone + "@c.us")
                      }
                    >
                      Chat
                    </Link>
                    {c.consent && (
                      <button
                        className="linkBtn dangerText"
                        onClick={async () => {
                          try {
                            await campaignRequest({
                              action: "optout",
                              phone: c.phone,
                            });
                            await refresh();
                          } catch (e) {
                            setNotice((e as Error).message);
                          }
                        }}
                      >
                        Hentikan promosi
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!contacts.length && (
          <div className="empty">
            {loading
              ? "Memuat kontak…"
              : "Belum ada kontak yang cocok. Import untuk mulai."}
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
          disabled={contacts.length < 50}
          onClick={() => setOffset(offset + 50)}
        >
          Berikutnya
        </button>
      </div>
    </>
  );
}
