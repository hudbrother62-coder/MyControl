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
    [preview, setPreview] = useState<ReturnType<typeof parseContacts> | null>(
      null,
    ),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  const [managedContact, setManagedContact] = useState<any>(null);
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);
  const [selectAllContacts, setSelectAllContacts] = useState(false);
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
  async function changePromotion(enabled: boolean, phone?: string) {
    if (bulkBusy || (!phone && !selectAllContacts && !selectedPhones.length)) return;
    setBulkBusy(true);setNotice("");
    try {
      const r = await campaignRequest({
        action:"promo_toggle",enabled,
        all:phone ? false : selectAllContacts,
        search:phone || !selectAllContacts ? "" : search,
        phones:phone ? [phone] : selectAllContacts ? [] : selectedPhones,
      });
      setNotice(`Promosi ${enabled?"diaktifkan":"dinonaktifkan"} pada ${r.changed} kontak. ${r.already_set} sudah sesuai, ${r.skipped} dilewati.`);
      setSelectedPhones([]);setSelectAllContacts(false);
      await refresh();
    }catch(e){setNotice(e instanceof Error?e.message:"Gagal mengubah promosi");}
    finally{setBulkBusy(false);}
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
    setNotice("");
    try {
      if (f.size > 4*1024*1024) throw new Error("Maksimal ukuran file 4 MB");
      const form = new FormData();
      form.append("file",f,f.name);
      const response=await fetch("/api/campaigns/import",{
        method:"POST",body:form,credentials:"same-origin",cache:"no-store"
      });
      const data=await response.json();
      if (!response.ok||data.ok===false) throw new Error(data.error||"Gagal membaca file");
      setRaw("");
      setPreview({
        contacts:data.contacts.map((c:{phone:string;name:string;tags:string})=>({
          phone:c.phone,name:c.name,tags:c.tags
        })),
        duplicates:data.duplicates,
        errors:data.errors,
      });
      setNotice(data.contacts.length+" nomor berhasil dibaca dari "+f.name+".");
    } catch (e) {
      setPreview(null);
      setNotice((e as Error).message||"Gagal membaca Excel/CSV");
    }
  }
  async function save() {
    if (!preview?.contacts.length || busy) return;
    setBusy(true);
    try {
      const r=await campaignRequest({
        action:"import",
        contacts:preview.contacts.map((c)=>({
          ...c,source:"Import My Control - pengaturan bawaan",consent:false
        })),
      });
      setNotice(
        r.processed +
          " kontak tersimpan. Promosi aktif bawaan kecuali nomor yang telah berhenti atau diblokir.",
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
          <small>Kontak dengan promosi aktif</small>
          <strong>{eligible}</strong>
        </div>
        <div className="card">
          <small>Pengaturan bawaan</small>
          <p>Promosi aktif untuk kontak baru, kecuali yang meminta berhenti.</p>
        </div>
      </div>
      {show && (
        <section className="card section">
          <div className="sectionTitle">
            <h2>Import Excel atau CSV</h2>
          </div>
          <p className="muted">
            Langsung unggah Excel berisi satu kolom A nomor WhatsApp tanpa judul, seperti file 101 -200.xlsx.
            Nomor 08, 8, atau 62 otomatis diseragamkan; nama boleh kosong.
          </p>
          <label className="fieldLabel">
            Pilih file
            <input
              className="input"
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => {const chosen=e.currentTarget.files?.[0];e.currentTarget.value="";void file(chosen)}}
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
              <p className="muted">Pengaturan promosi aktif bawaan untuk nomor yang valid. Riwayat berhenti dan blokir tetap dihormati.</p>
              <button
                className="btn primary"
                disabled={
                  busy ||
                  !preview.contacts.length
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
      <section className="card section" aria-label="Promosi massal">
        <div className="sectionTitle"><h2>Atur Promosi</h2><span className="muted">
          {selectAllContacts?"Semua hasil pencarian dipilih":selectedPhones.length+" kontak dipilih"}
        </span></div>
        <p className="muted">Promosi aktif bawaan untuk nomor WhatsApp valid. Kamu bisa mematikan atau mengaktifkan kembali tanpa mengisi formulir. Pelanggan yang meminta berhenti dan ID @lid belum terpetakan tetap dibatasi.</p>
        <div className="actions">
          <button className="btn" disabled={bulkBusy||!selectablePage.length} onClick={togglePage}>
            {allPageSelected&&!selectAllContacts?"Batalkan pilihan halaman":"Pilih semua di halaman"}
          </button>
          <button className="btn" disabled={bulkBusy||!data?.total}
            onClick={()=>{setSelectAllContacts(v=>!v);setSelectedPhones([])}}>
            {selectAllContacts?"Batalkan pilih semua":"Pilih semua kontak"}
          </button>
          {(selectedPhones.length>0||selectAllContacts)&&
            <button className="btn" disabled={bulkBusy} onClick={()=>{setSelectedPhones([]);setSelectAllContacts(false)}}>
              Bersihkan pilihan
            </button>}
        </div>
        {(selectedPhones.length>0||selectAllContacts)&&
          <div className="actions section">
            <button className="btn primary" disabled={bulkBusy} onClick={()=>void changePromotion(true)}>
              {bulkBusy?"Menyimpan…":"Aktifkan promosi"}
            </button>
            <button className="btn" disabled={bulkBusy} onClick={()=>void changePromotion(false)}>
              {bulkBusy?"Menyimpan…":"Nonaktifkan promosi"}
            </button>
          </div>}
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
                      ? "Berhenti (pelanggan)"
                      : !c.phone
                        ? "Nomor WA belum terpetakan"
                        : c.consent
                          ? "Aktif"
                          : "Nonaktif"}
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
                    {c.phone && /^[1-9][0-9]{7,14}$/.test(c.phone) &&
                      !c.opted_out_at && !c.exclusion && (
                      <button className={"linkBtn "+(c.consent?"dangerText":"")}
                        disabled={bulkBusy} onClick={()=>void changePromotion(!c.consent,c.phone)}>
                        {c.consent?"Matikan promosi":"Aktifkan promosi"}
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
