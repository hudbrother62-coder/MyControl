"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, Clock3, MessageCircle, Shield, Star, X } from "lucide-react";
import { campaignRequest } from "@/lib/campaigns";

export type ManagedContact = {
  chat_id: string;
  phone: string | null;
  name: string;
  pause_until?: string | null;
  followup_enabled: boolean;
  exclusion?: string | null;
  consent?: boolean;
  opted_out_at?: string | null;
  priority?: string;
  note?: string;
  last_customer_message_at?: string | null;
  last_ai_message_at?: string | null;
};
export function contactAiPaused(value?: string | null) {
  return value === "infinity" || !!(value && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now());
}
function when(value?: string | null) {
  if (!value) return "Belum ada";
  if (value === "infinity") return "Sampai diaktifkan manual";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Tidak tersedia" : date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short"
  }) + " WIB";
}
const pauseOptions = [
  { value: "15", label: "15 menit" },
  { value: "60", label: "1 jam" },
  { value: "480", label: "8 jam" },
  { value: "1440", label: "24 jam" },
  { value: "10080", label: "7 hari" },
  { value: "-1", label: "Sampai diaktifkan manual" },
];
export default function ContactBotControls({
  contact, onClose, onSaved
}: { contact: ManagedContact; onClose: () => void; onSaved: () => Promise<void> }) {
  const [current, setCurrent] = useState(contact);
  const [duration, setDuration] = useState("60");
  const [scope, setScope] = useState(contact.exclusion || "NONE");
  const [note, setNote] = useState(contact.note || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const paused = contactAiPaused(current.pause_until);
  const blocked = current.exclusion === "ALL_AUTOMATION";
  const phoneReady = !!current.phone && /^[1-9][0-9]{7,14}$/.test(current.phone) && !current.chat_id.endsWith("@lid");

  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);

  async function run(body: Record<string, unknown>, onSuccess: (d: any) => void, text: string) {
    if (busy) return;
    setBusy(true); setNotice(""); setFailed(false);
    try {
      const r = await fetch("/api/control/action", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, conversationId: current.chat_id }), cache: "no-store"
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal menyimpan pengaturan");
      onSuccess(d);
      await onSaved();
      setNotice(text);
    } catch (e) {
      setFailed(true);
      setNotice(e instanceof Error ? e.message : "Pengaturan gagal disimpan");
    } finally {
      setBusy(false);
    }
  }
  function setPause(minutes: number) {
    void run({ action: "contact_pause", minutes },
      d => setCurrent(c => ({ ...c, pause_until: d.pause_until || null })),
      minutes === 0 ? "AI kembali diizinkan menerima pesan baru." :
        "AI dijeda. Pesan otomatis yang masih antre dibatalkan; tidak dikirim ulang.");
  }
  function savePreferences(update: Record<string, unknown>) {
    void run({ action: "contact_preferences", ...update },
      d => setCurrent(c => ({ ...c, followup_enabled: d.followup_enabled, priority: d.priority, note: d.note })),
      "Pengaturan kontak tersimpan.");
  }
  async function saveScope() {
    if (!phoneReady || busy) return;
    setBusy(true); setNotice(""); setFailed(false);
    try {
      await campaignRequest({
        action: "exclusion", phone: current.phone,
        scope: scope === "NONE" ? null : scope,
        reason: "Ditetapkan owner melalui pengaturan kontak"
      });
      setCurrent(c => ({ ...c, exclusion: scope === "NONE" ? null : scope }));
      await onSaved();
      setNotice("Aturan pengecualian disimpan. Pencabutan pengecualian tidak memulihkan izin promosi atau antrean lama.");
    } catch (e) {
      setFailed(true);
      setNotice(e instanceof Error ? e.message : "Gagal mengatur pengecualian");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="contactControlOverlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={"Pengaturan bot untuk " + current.name} className="contactControlModal">
        <header className="contactControlHeader">
          <div className="contactControlIdentity">
            <div className="contactControlAvatar"><Bot size={22}/></div>
            <div><small>KENDALI PER KONTAK</small><h2>{current.name}</h2>
              <p>{phoneReady ? "+" + current.phone : "ID WhatsApp: " + current.chat_id}</p></div>
          </div>
          <button className="btn" type="button" aria-label="Tutup" disabled={busy} onClick={onClose}><X size={18}/></button>
        </header>
        <div className="contactControlBody">
          <div className="contactControlStatus">
            <div><b>{blocked ? "Semua otomatisasi diblokir" : paused ? "AI dijeda untuk kontak ini" : "AI diizinkan membalas"}</b>
            <span>{blocked ? "Pengecualian global per nomor masih aktif." : paused ? "Berakhir: " + when(current.pause_until) : "Tetap mengikuti sakelar utama bot di menu Otomasi & AI."}</span></div>
            <span className={"badge " + (blocked || paused ? "warn" : "ok")}>{blocked || paused ? "NONAKTIF" : "DIIZINKAN"}</span>
          </div>
          <div className="contactControlSection">
            <h3><Clock3 size={17}/> Durasi jeda AI</h3>
            <p>Pilih berapa lama bot tidak membalas kontak ini. Setelah selesai, hanya pesan baru yang diproses. Admin tetap bisa mengirim pesan manual.</p>
            <div className="contactControlActions">
              <select className="input" aria-label="Durasi jeda AI" disabled={busy} value={duration} onChange={e => setDuration(e.target.value)}>
                {pauseOptions.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
              <button className="btn primary" type="button" disabled={busy} onClick={() => setPause(Number(duration))}>{busy ? "Memproses..." : "Jeda AI"}</button>
              {paused && <button className="btn" type="button" disabled={busy} onClick={() => setPause(0)}>Aktifkan AI</button>}
            </div>
          </div>
          <div className="contactControlSection">
            <h3><MessageCircle size={17}/> Follow-up dan pengingat</h3>
            <label className="settingRow">
              <div><b>Follow-up untuk kontak ini</b><span>OFF membatalkan pengingat yang antre dan memblokir follow-up baru. Tidak mengubah izin promosi.</span></div>
              <input type="checkbox" checked={current.followup_enabled !== false} disabled={busy} onChange={e => savePreferences({ followupEnabled: e.target.checked })}/>
            </label>
            <p className="muted">Follow-up tetap bergantung pada sakelar global di Otomasi & AI.</p>
          </div>
          <div className="contactControlSection">
            <h3><Shield size={17}/> Pengecualian pesan otomatis</h3>
            {phoneReady ? <>
              <div className="contactControlActions">
                <select className="input" aria-label="Aturan pengecualian" disabled={busy} value={scope} onChange={e => setScope(e.target.value)}>
                  <option value="NONE">Tidak ada pengecualian</option>
                  <option value="PROMOTION">Blokir kampanye dan follow-up</option>
                  <option value="ALL_AUTOMATION">Blokir semua otomatisasi</option>
                </select>
                <button className="btn" disabled={busy || scope === (current.exclusion || "NONE")} onClick={() => void saveScope()}>Simpan</button>
              </div>
              <p className="muted">Izin promosi tidak otomatis diberikan saat pengecualian dihapus.</p>
            </> : <p className="muted">Pengecualian nomor baru bisa diatur setelah nomor telepon terverifikasi. Identitas @lid tidak dianggap nomor.</p>}
          </div>
          <div className="contactControlSection">
            <h3><Star size={17}/> Tandai penting</h3>
            <label className="settingRow">
              <div><b>Prioritaskan kontak</b><span>Kontak penting tampil lebih dahulu dalam daftar untuk ditangani admin.</span></div>
              <input type="checkbox" disabled={busy} checked={current.priority === "IMPORTANT"}
                onChange={e => savePreferences({ priority: e.target.checked ? "IMPORTANT" : "NORMAL" })}/>
            </label>
          </div>
          <div className="contactControlSection">
            <h3>Catatan internal</h3>
            <textarea className="input contactControlNote" maxLength={2000} rows={3}
              disabled={busy} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Contoh: calon pembeli Gajian Pro, minta dihubungi kembali setelah rapat."/>
            <div className="contactControlActions">
              <small className="muted">{note.length}/2000 karakter · hanya untuk admin</small>
              <button className="btn" disabled={busy || note.trim() === (current.note || "")} onClick={() => savePreferences({ note: note.trim() })}>Simpan catatan</button>
            </div>
          </div>
          <div className="contactControlSection">
            <h3>Aktivitas terakhir</h3>
            <div className="contactControlHistory">
              <div><span>Pesan pelanggan</span><b>{when(current.last_customer_message_at)}</b></div>
              <div><span>Balasan AI</span><b>{when(current.last_ai_message_at)}</b></div>
            </div>
          </div>
          {notice && <div role="status" className={"notice " + (failed ? "errorNotice" : "")}>{notice}</div>}
        </div>
        <footer className="contactControlFooter">
          <span>Pengaturan langsung berlaku pada antrean bot.</span>
          <div className="actions"><Link className="btn" href={"/inbox?chat=" + encodeURIComponent(current.chat_id)}>Buka chat</Link>
            <button className="btn primary" disabled={busy} onClick={onClose}>Selesai</button></div>
        </footer>
      </section>
    </div>
  );
}