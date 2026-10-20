"use client";
import Link from "next/link";
import ContactExclusions from "@/components/ContactExclusions";
import ContactBotControls, { contactAiPaused } from "@/components/ContactBotControls";
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
    [preview, setPreview] = useState<ReturnType<typeof parseContacts> | null>(
      null,
    ),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  const [managedContact, setManagedContact] = useState<any>(null);
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);
  const [selectAllContacts, setSelectAllContacts] = useState(false);
  const [bulkEvidence, setBulkEvidence] = useState("");
  const [bulkConfirmed, setBulkConfirmed] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const contacts = data?.contacts || [];
  const eligible = useMemo(
    () => contacts.filter((c: any) => c.phone && c.consent && !c.opted_out_at && !c.exclusion).length,
    [contacts],
  );
  const selectablePage = useMemo(
    () => contacts.filter((c: any) =>
      typeof c.phone === "string" && /^[1-9][0-9]{7,14}$/.test(c.phone) &&
      !c.opted_out_at && !c.exclusion),
    [contacts],
  );
  const allPageSelected = selectablePage.length > 0 &&
    selectablePage.every((c: any) => selectedPhones.includes(c.phone));
  function togglePage() {
    if (selectAllContacts) {
      setSelectAllContacts(false);
      setSelectedPhones([]);
      return;
    }
    const pagePhones = selectablePage.map((c: any) => c.phone as string);
    setSelectedPhones((prev) => allPageSelected
      ? prev.filter((p) => !pagePhones.includes(p))
      : [...new Set([...prev, ...pagePhones])]);
  }
  function togglePhone(phone: string) {
    setSelectAllContacts(false);
    setSelectedPhones((prev) => prev.includes(phone)
      ? prev.filter((p) => p !== phone) : [...prev, phone]);
  }
  async function allowBulkPromotions() {
    if (bulkBusy || (!selectAllContacts && selectedPhones.length === 0) ||
        !bulkConfirmed || bulkEvidence.trim().length < 12) return;
    setBulkBusy(true);
    setNotice("");
    try {
      const result = await campaignRequest({
        action: "bulk_consent",
        all: selectAllContacts,
        search: selectAllContacts ? search : "",
        phones: selectAllContacts ? [] : selectedPhones,
        evidence: bulkEvidence.trim(),
      });
      setNotice(
        `Izin promosi diperbarui untuk ${result.updated} kontak. ` +
        `${result.already_allowed} sudah berizin; ${result.skipped} dilewati ` +
        "(berhenti promosi, dikecualikan, atau belum memenuhi syarat).",
      );
      setSelectedPhones([]);
      setSelectAllContacts(false);
      setBulkEvidence("");
      setBulkConfirmed(false);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Gagal memperbarui izin promosi.");
    } finally {
      setBulkBusy(false);
    }
  }
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
      // A batch-wide proof is used only if the owner actually supplies it.
      // An empty evidence field imports contacts without manufacturing opt-in.
      const evidence=source.trim();
      if(evidence&&evidence.length<12)throw new Error("Bukti persetujuan minimal 12 karakter atau kosongkan jika belum ada izin.");
      const r = await campaignRequest({
        action: "import",
        contacts: preview.contacts.map((c) => ({
          ...c,source:evidence||"Impor kontak tanpa persetujuan promosi",
          consent:evidence.length>=12
        })),
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
      <div className="pageHead">
        <div>
          <h1>Kontak</h1>
          <p>Atur AI, durasi jeda, follow-up, dan catatan untuk setiap pelanggan.</p>
        </div>
        <button className="btn primary" onClick={() => setShow(!show)}>
          + Import kontak
        </button>
      </div>
      <div className="campaignMetrics">
        <div className="card">
          <small>Semua kontak terhubung</small>
          <strong>{data?.total ?? contacts.length}</strong>
        </div>
        <div className="card">
          <small>Nomor dengan izin promosi tercatat</small>
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
                Bukti persetujuan promo untuk seluruh daftar (opsional)
                <input
                  className="input"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Contoh: formulir persetujuan PRIME STORE, tanggal..."
                />
                <small className="muted">Isi sekali jika seluruh kontak dalam file memang telah menyetujui promosi PRIME STORE. Jika kosong, kontak tetap tersimpan tetapi belum berizin promo.</small>
              </label>
              <button
                className="btn primary"
                disabled={
                  busy ||
                  !preview.contacts.length ||
                  (source.trim().length>0 && source.trim().length<12)
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
            setSelectedPhones([]);
            setSelectAllContacts(false);
          }}
        />
        <button className="btn" onClick={() => void refresh()}>
          Perbarui
        </button>
      </div>
      <section className="card section" aria-label="Izin promosi massal">
        <div className="sectionTitle">
          <h2>Izin promosi massal</h2>
          <span className="muted">
            {selectAllContacts ? "Seluruh kontak yang cocok dengan pencarian" :
              selectedPhones.length + " kontak dipilih"}
          </span>
        </div>
        <p className="muted">
          Pilih kotak di samping kontak, atau gunakan Pilih semua kontak untuk
          mencakup seluruh halaman hasil pencarian. Kontak yang telah berhenti,
          dikecualikan, atau belum memiliki nomor WhatsApp terverifikasi dilewati.
        </p>
        <div className="actions">
          <button className="btn" disabled={bulkBusy || selectablePage.length === 0}
            onClick={togglePage}>
            {allPageSelected && !selectAllContacts ? "Batalkan pilihan halaman" : "Pilih semua di halaman"}
          </button>
          <button className="btn" disabled={bulkBusy || !data?.total}
            onClick={() => {
              setSelectAllContacts((value) => !value);
              setSelectedPhones([]);
            }}>
            {selectAllContacts ? "Batalkan pilih semua" : "Pilih semua kontak"}
          </button>
          {(selectedPhones.length > 0 || selectAllContacts) &&
            <button className="btn" disabled={bulkBusy} onClick={() => {
              setSelectedPhones([]);
              setSelectAllContacts(false);
            }}>Bersihkan pilihan</button>}
        </div>
        {(selectedPhones.length > 0 || selectAllContacts) && (
          <div className="section" style={{ maxWidth: 650 }}>
            <label className="fieldLabel">
              Sumber persetujuan promosi
              <input className="input" value={bulkEvidence} maxLength={500}
                placeholder="Contoh: formulir persetujuan pelanggan tanggal ..."
                onChange={(e) => setBulkEvidence(e.target.value)} />
            </label>
            <label className="checkLine">
              <input type="checkbox" checked={bulkConfirmed}
                onChange={(e) => setBulkConfirmed(e.target.checked)} />
              Saya memastikan kontak yang dipilih telah memberi izin promosi.
            </label>
            <div className="actions">
              <button className="btn primary" disabled={bulkBusy || !bulkConfirmed ||
                  bulkEvidence.trim().length < 12}
                onClick={() => void allowBulkPromotions()}>
                {bulkBusy ? "Menyimpan izin…" :
                  selectAllContacts ? "Izinkan promosi semua kontak" :
                  "Izinkan promosi " + selectedPhones.length + " kontak"}
              </button>
            </div>
          </div>
        )}
      </section>
      <div className="card tableWrap section">
        <table className="table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Pilih semua kontak di halaman"
                  disabled={bulkBusy || selectablePage.length === 0}
                  checked={selectAllContacts || allPageSelected}
                  onChange={togglePage} />
              </th>
              <th>Kontak</th>
              <th>Label</th>
              <th>Promosi</th>
              <th>Status AI</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c: any) => (
              <tr key={c.chat_id}>
                <td>
                  <input type="checkbox" aria-label={"Pilih kontak " + c.name}
                    disabled={bulkBusy || !c.phone ||
                      !/^[1-9][0-9]{7,14}$/.test(c.phone) ||
                      !!c.opted_out_at || !!c.exclusion}
                    checked={!!(c.phone && !c.opted_out_at && !c.exclusion &&
                      /^[1-9][0-9]{7,14}$/.test(c.phone)) &&
                      (selectAllContacts || selectedPhones.includes(c.phone))}
                    onChange={() => togglePhone(c.phone)} />
                </td>
                <td>
                  <b>{c.name}</b>{c.priority === "IMPORTANT" && <span className="badge warn" style={{ marginLeft: 8 }}>Penting</span>}
                  <div className="muted">{c.phone ? "+" + c.phone : "ID WhatsApp: " + c.chat_id}</div>
                </td>
                <td>{c.tags || (c.origin === "WHATSAPP" ? "Dari WhatsApp" : "Impor")}</td>
                <td>
                  <span
                    className={
                      "badge " + (c.phone && c.consent && !c.opted_out_at && !c.exclusion ? "ok" : "warn")
                    }
                  >
                    {c.exclusion ? "Dikecualikan" : c.opted_out_at
                      ? "Berhenti"
                      : !c.phone
                        ? "Nomor WA belum terpetakan"
                        : c.consent
                          ? "Berizin"
                          : "Belum ada persetujuan"}
                  </span>
                </td>
                <td><span className={"badge " + (c.exclusion === "ALL_AUTOMATION" || contactAiPaused(c.pause_until) || c.automation_mode === "MANUAL" ? "warn" : "ok")}>{c.exclusion === "ALL_AUTOMATION" ? "Dikecualikan" : c.automation_mode === "MANUAL" ? "Admin Manual" : contactAiPaused(c.pause_until) ? "AI dijeda" : c.automation_mode === "HYBRID" ? "Hybrid" : "AI diizinkan"}</span></td>
                <td>
                  <div className="actions">
                    <button className="btn primary" onClick={() => setManagedContact(c)}>Atur Bot</button>
                    <Link
                      className="btn"
                      href={
                        "/inbox?chat=" + encodeURIComponent(c.chat_id || c.phone + "@c.us")
                      }
                    >
                      Chat
                    </Link>
                    {c.consent && c.phone && (
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
              : "Belum ada kontak yang cocok. Percakapan WhatsApp akan terdaftar otomatis."}
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
      <ContactExclusions/>
      {managedContact && (
        <ContactBotControls key={managedContact.chat_id} contact={managedContact} onClose={() => setManagedContact(null)} onSaved={refresh} />
      )}
    </>
  );
}
