"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {Bot,CalendarClock,CheckCircle2,Clock3,History,MessageCircle,Shield,UserRoundCog,X} from "lucide-react";
import {campaignRequest} from "@/lib/campaigns";

export type ManagedContact={
 chat_id:string;phone:string|null;name:string;pause_until?:string|null;followup_enabled:boolean;
 exclusion?:string|null;consent?:boolean;opted_out_at?:string|null;priority?:string;note?:string;
 last_customer_message_at?:string|null;last_ai_message_at?:string|null;
 automation_mode?:string;response_style?:string;custom_instruction?:string;customer_profile?:string;
 lifecycle?:string;max_followups?:number;
 reply_window_enabled?:boolean;reply_window_start?:string;reply_window_end?:string;
 reply_cooldown_seconds?:number;max_reply_chars?:number;
};
type Subscription={id:string;chat_id:string;product_id:string;plan_name:string;amount:number;due_at:string;status:string;
 reminder_enabled:boolean;service_opt_in:boolean;consent_evidence:string;grace_days:number;last_paid_at:string|null;updated_at:string};
type Snapshot={subscriptions:Subscription[];payments:{id:string;subscription_id:string;amount:number;paid_at:string;reference:string}[];
 drafts:{id:string;reply:string;created_at:string;status:string}[];audit:{id:string;action:string;created_at:string;detail:any}[];
 memory:{summary?:string;updated_at?:string};consent:{consent?:boolean;consent_at?:string;source?:string;opted_out_at?:string};
 products:{id:string;name:string}[];
 auto_insights?:{source:string;product_name?:string;contact_product_id?:string;product_confidence?:string;
 suggested_response_style?:string;inferred_lifecycle?:string;latest_customer_message?:string;
 conversation_excerpt?:string;lead_status?:string;crm_stage?:string;subscription?:{plan_name?:string;amount?:number;due_at?:string;status?:string}};
 verified_orders?:{id:string;product_id:string;product_name:string;total:number;paid_at:string;status:string}[];
};
const dateWib=(value?:string|null)=>{
 if(!value)return "Belum ada";
 if(value==="infinity")return "Sampai diaktifkan";
 const date=new Date(value);
 return Number.isNaN(date.getTime())?"Tidak tersedia":date.toLocaleString("id-ID",{timeZone:"Asia/Jakarta",dateStyle:"medium",timeStyle:"short"})+" WIB";
};
const dateToInput=(value?:string|null)=>{
 if(!value)return "";
 const d=new Date(value);return Number.isFinite(d.getTime())?new Date(d.getTime()+7*3600000).toISOString().slice(0,16):"";
};
const inputToIso=(value:string)=>new Date(value+":00+07:00").toISOString();
const formatCurrency=(v:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(v)||0);
export function contactAiPaused(value?:string|null){return value==="infinity" || !!(value&&Date.parse(value)>Date.now());}
const tabs=[["ai","AI & Kendali"],["promosi","Promosi"],["billing","Langganan"],["memory","Memori"],["audit","Audit"]] as const;
const modes=[["AI","AI Otomatis","AI langsung menjawab sesuai kebijakan."],["HYBRID","Hybrid","AI menyusun draft. Admin memutuskan untuk mengirimnya."],["MANUAL","Admin Manual","Tidak ada balasan AI. Percakapan tetap masuk Inbox."]] as const;
const blankSub={id:"",productId:"",planName:"",amount:"",dueAt:"",reminderEnabled:false,serviceOptIn:false,evidence:"",graceDays:"3"};
function prettyAction(value:string){const names:Record<string,string>={
 OWNER_CONTACT_MODE:"Mode AI diubah",OWNER_CONTACT_PAUSE:"Jeda AI diubah",
 OWNER_CONTACT_PREFERENCES:"Preferensi kontak diubah",OWNER_CONTACT_SALES_PROFILE:"Profil & strategi diubah",
 OWNER_PROMO_CONSENT:"Izin promosi diperbarui",OWNER_SUBSCRIPTION_SAVE:"Langganan disimpan",
 OWNER_PAYMENT_VERIFIED:"Pembayaran diverifikasi",OWNER_SUBSCRIPTION_CANCEL:"Langganan dihentikan",
 OWNER_AI_DRAFT_REVIEW:"Draft AI ditinjau",OWNER_CONTACT_AI_CONTROL:"Jeda AI diubah",
 };return names[value]||value.replaceAll("_"," ").toLowerCase();}
export default function ContactBotControls({contact,onClose,onSaved}:{contact:ManagedContact;onClose:()=>void;onSaved:()=>Promise<void>}){
 const [c,setC]=useState<ManagedContact>(contact);
 const [active,setActive]=useState<"ai"|"promosi"|"billing"|"memory"|"audit">("ai");
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState(false);
 const [duration,setDuration]=useState("60"),[customMinutes,setCustomMinutes]=useState("120");
 const [style,setStyle]=useState(contact.response_style||"CONSULTATIVE"),[profile,setProfile]=useState(contact.customer_profile||"");
 const [instruction,setInstruction]=useState(contact.custom_instruction||""),[lifecycle,setLifecycle]=useState(contact.lifecycle||"PROSPECT");
 const [maxFollowups,setMaxFollowups]=useState(Number(contact.max_followups??3));
 const [note,setNote]=useState(contact.note||""),[permissionEvidence,setPermissionEvidence]=useState("");
 const [replyWindow,setReplyWindow]=useState(contact.reply_window_enabled||false);
 const [replyStart,setReplyStart]=useState(contact.reply_window_start||"08:00");
 const [replyEnd,setReplyEnd]=useState(contact.reply_window_end||"22:00");
 const [cooldown,setCooldown]=useState(Number(contact.reply_cooldown_seconds??3));
 // Panjang balasan ditentukan AI secara adaptif, bukan batas karakter manual.
 const [confirmedConsent,setConfirmedConsent]=useState(false),[scope,setScope]=useState(contact.exclusion||"NONE");
 const [sub,setSub]=useState({...blankSub}),[paymentChecks,setPaymentChecks]=useState<Record<string,boolean>>({});
 const phoneReady=!!c.phone&&/^[1-9][0-9]{7,14}$/.test(c.phone)&&!c.chat_id.endsWith("@lid");
 const paused=contactAiPaused(c.pause_until);
 const isBlocked=c.exclusion==="ALL_AUTOMATION";
 const load=async()=>{
  const r=await fetch("/api/control/contact?chat="+encodeURIComponent(contact.chat_id),{cache:"no-store"});
  const d=await r.json();if(!r.ok)throw new Error(d.error||"Gagal memuat kendali kontak");
  setSnapshot(d as Snapshot);
 };
 useEffect(()=>{
  let mounted=true;
  void fetch("/api/control/contact?chat="+encodeURIComponent(contact.chat_id),{cache:"no-store"})
    .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Gagal memuat data");if(mounted)setSnapshot(d)})
    .catch(e=>{if(mounted){setError(true);setNotice(e.message)}})
    .finally(()=>{if(mounted)setLoading(false)});
  return()=>{mounted=false};
 },[contact.chat_id]);
 useEffect(()=>{
  function esc(e:KeyboardEvent){if(e.key==="Escape"&&!busy)onClose();}
  window.addEventListener("keydown",esc);return()=>window.removeEventListener("keydown",esc);
 },[busy,onClose]);
 async function mutate(payload:Record<string,unknown>,message:string,apply?:(d:any)=>void){
  if(busy)return;setBusy(true);setError(false);setNotice("");
  try{
   const r=await fetch("/api/control/action",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({...payload,conversationId:c.chat_id}),cache:"no-store"});
   const d=await r.json();if(!r.ok)throw new Error(d.error||"Gagal menyimpan");
   apply?.(d);await load();await onSaved();setNotice(message);
  }catch(e){setError(true);setNotice(e instanceof Error?e.message:"Gagal menyimpan")}
  finally{setBusy(false)}
 }
 async function exclusions(){
  if(busy||!phoneReady)return;setBusy(true);setNotice("");setError(false);
  try{
   await campaignRequest({action:"exclusion",phone:c.phone,scope:scope==="NONE"?null:scope,reason:"Aturan Contact Control Pro"});
   setC(prev=>({...prev,exclusion:scope==="NONE"?null:scope}));
   await load();await onSaved();setNotice("Pengecualian tersimpan. Izin promosi tidak berubah.");
  }catch(e){setError(true);setNotice((e as Error).message)}finally{setBusy(false)}
 }
 function saveSubscription(){
  if(!sub.productId||!sub.planName.trim()||!sub.dueAt||!(Number(sub.amount)>0)){setError(true);setNotice("Isi produk, paket, nominal dan jatuh tempo.");return}
  if(sub.reminderEnabled&&(!sub.serviceOptIn||sub.evidence.trim().length<8)){setError(true);setNotice("Pengingat otomatis membutuhkan bukti persetujuan layanan.");return}
  void mutate({action:"subscription_save",id:sub.id||null,productId:sub.productId,planName:sub.planName,
    amount:Number(sub.amount),dueAt:inputToIso(sub.dueAt),reminderEnabled:sub.reminderEnabled,
    serviceOptIn:sub.serviceOptIn,evidence:sub.evidence,graceDays:Number(sub.graceDays)},
    "Langganan disimpan. Jadwal pengingat berikutnya diperbarui.",()=>setSub({...blankSub}));
 }
 function editSubscription(s:Subscription){
  setSub({id:s.id,productId:s.product_id,planName:s.plan_name,amount:String(s.amount),
   dueAt:dateToInput(s.due_at),reminderEnabled:s.reminder_enabled,serviceOptIn:s.service_opt_in,
   evidence:s.consent_evidence||"",graceDays:String(s.grace_days)});setActive("billing");
 }
 const subs=snapshot?.subscriptions||[];
 const auto=snapshot?.auto_insights;
 const verifiedOrders=snapshot?.verified_orders||[];
 const pendingDrafts=(snapshot?.drafts||[]).filter(x=>x.status==="PENDING");
 const effectiveStatus=isBlocked?"Diblokir":c.automation_mode==="MANUAL"?"Admin Manual":paused?"Dijeda":
  c.automation_mode==="HYBRID"?"Hybrid · perlu persetujuan":"AI Otomatis";
 const consent=snapshot?.consent;
 const promoStatus=consent?.opted_out_at?"BERHENTI":consent?.consent?"DIIZINKAN":"BELUM ADA IZIN";
 const lifecycleLabels:Record<string,string>={PROSPECT:"Prospek",BUYER:"Pembeli",ACTIVE:"Aktif",DUE_SOON:"Akan jatuh tempo",
 OVERDUE:"Menunggak",CHURNED:"Berhenti"};
 return <div className="contactControlOverlay" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
  <section role="dialog" aria-modal="true" aria-label={"Contact Control Pro "+c.name} className="contactControlModal contactProModal">
   <header className="contactControlHeader">
    <div className="contactControlIdentity"><div className="contactControlAvatar"><Bot size={21}/></div><div>
      <small>CONTACT CONTROL PRO</small><h2>{c.name}</h2><p>{phoneReady?"+"+c.phone:"ID WhatsApp: "+c.chat_id}</p>
    </div></div>
    <button className="btn" disabled={busy} aria-label="Tutup" onClick={onClose}><X size={18}/></button>
   </header>
   <nav className="contactProTabs" aria-label="Pengaturan kontak">
    {tabs.map(([key,label])=><button key={key} disabled={busy} className={"contactProTab "+(active===key?"active":"")}
      onClick={()=>setActive(key)}>{label}{key==="ai"&&pendingDrafts.length>0?" ("+pendingDrafts.length+")":""}</button>)}
   </nav>
   <div className="contactControlBody contactProBody">
    <div className="contactControlStatus"><div><b>{effectiveStatus}</b>
      <span>{paused?"Jeda berakhir: "+dateWib(c.pause_until):"Tetap mengikuti sakelar bot global dan kebijakan per kontak."}</span>
    </div><span className={"badge "+(isBlocked||paused||c.automation_mode==="MANUAL"?"warn":"ok")}>{isBlocked||paused?"OFF":"TERKENDALI"}</span></div>
    {active==="ai"&&<>
      <div className="contactProAutoPanel">
       <div className="sectionTitle"><b>AI membaca kontak ini otomatis</b><span className="badge ok">DARI CHAT & CRM</span></div>
       <div className="contactProAutoGrid">
        <div><small>Produk terdeteksi</small><b>{auto?.product_name||"Belum terdeteksi"}</b></div>
        <div><small>Gaya bahasa adaptif</small><b>{auto?.suggested_response_style?.replaceAll("_"," ").toLowerCase()||"Sopan natural"}</b></div>
        <div><small>Status pelanggan</small><b>{lifecycleLabels[auto?.inferred_lifecycle||""]||"Prospek"}</b></div>
       </div>
       <p>{auto?.latest_customer_message?"Pesan terakhir: “"+auto.latest_customer_message+"”":"Belum ada pesan pelanggan yang bisa dianalisis."}</p>
       <small className="muted">AI tetap sopan. Minat dan gaya disimpulkan dari percakapan; status bayar harus diverifikasi.</small>
      </div>
      <section className="contactControlSection"><h3><UserRoundCog size={17}/> Mode operasional</h3>
      <div className="contactModeOptions">{modes.map(([mode,label,desc])=><button key={mode} disabled={busy}
       className={"contactModeOption "+((c.automation_mode||"AI")===mode?"selected":"")}
       onClick={()=>void mutate({action:"contact_mode",mode},"Mode diubah. Pesan lama yang dibatalkan tidak dikirim ulang.",
        d=>setC(v=>({...v,automation_mode:d.automation_mode,pause_until:d.pause_until||null})))}>
       <b>{label}</b><small>{desc}</small></button>)}</div></section>
      <section className="contactControlSection"><h3><Clock3 size={17}/> Jeda AI dan durasi</h3>
       <div className="contactControlActions">
        <select className="input" aria-label="Durasi jeda" value={duration} disabled={busy} onChange={e=>setDuration(e.target.value)}>
         {[[15,"15 menit"],[60,"1 jam"],[480,"8 jam"],[1440,"24 jam"],[10080,"7 hari"],[-1,"Sampai diaktifkan manual"],["custom","Custom"]].map(([v,l])=><option key={v} value={String(v)}>{l}</option>)}
        </select>
        {duration==="custom"&&<input className="input" aria-label="Jeda custom dalam menit" type="number" min="5" max="10080" value={customMinutes} onChange={e=>setCustomMinutes(e.target.value)}/>}
        <button className="btn" disabled={busy||!Number.isInteger(Number(duration==="custom"?customMinutes:duration))} onClick={()=>void mutate({action:"contact_pause",minutes:Number(duration==="custom"?customMinutes:duration)},
         "Jeda disimpan. Antrean otomatis lama dibatalkan.",d=>setC(v=>({...v,pause_until:d.pause_until||null})))}>
         Jeda AI</button>
        {paused&&<button className="btn primary" disabled={busy} onClick={()=>void mutate({action:"contact_pause",minutes:0},
          "Jeda diakhiri. Hanya pesan baru diproses.",()=>setC(v=>({...v,pause_until:null})))}>Akhiri jeda</button>}
       </div>
       <p>Custom: 5–10.080 menit. Pengiriman manual tetap tersedia.</p></section>
      <section className="contactControlSection"><h3><MessageCircle size={17}/> Smart Follow-up</h3>
       <label className="settingRow"><div><b>Follow-up per kontak</b><span>OFF membatalkan antrean pengingat promosi; tidak menghapus langganan.</span></div>
        <input type="checkbox" checked={c.followup_enabled!==false} disabled={busy}
         onChange={e=>void mutate({action:"contact_preferences",followupEnabled:e.target.checked},"Pengaturan follow-up tersimpan.",
          d=>setC(v=>({...v,followup_enabled:d.followup_enabled})))}/></label>
       <label className="fieldLabel">Batas follow-up pelanggan
        <select className="input" value={maxFollowups} onChange={e=>setMaxFollowups(Number(e.target.value))}>
         {[0,1,2,3].map(x=><option value={x} key={x}>{x} kali</option>)}
        </select>
       </label></section>
      <section className="contactControlSection"><h3><Clock3 size={17}/> Jadwal dan tempo balasan</h3>
       <label className="checkLine"><input type="checkbox" checked={replyWindow} onChange={e=>setReplyWindow(e.target.checked)}/>
        Batasi jam pengiriman AI khusus kontak ini (WIB)</label>
       {replyWindow&&<div className="contactProForm">
        <label className="fieldLabel">Mulai<input className="input" type="time" value={replyStart} onChange={e=>setReplyStart(e.target.value)}/></label>
        <label className="fieldLabel">Selesai<input className="input" type="time" value={replyEnd} onChange={e=>setReplyEnd(e.target.value)}/></label>
       </div>}
       <label className="fieldLabel">Jeda respons (detik)
        <input className="input" type="number" min="0" max="120" value={cooldown} onChange={e=>setCooldown(Number(e.target.value))}/>
       </label>
       <p>AI bebas menyesuaikan panjang jawaban mengikuti pertanyaan pelanggan. Tidak ada target karakter yang perlu diatur.</p>
       <p>Pesan AI di luar jam pengiriman akan menunggu, lalu diperiksa lagi sebelum dikirim. Balasan manual tidak dijadwalkan ulang.</p>
       <button className="btn primary" disabled={busy} onClick={()=>void mutate({action:"reply_policy",enabled:replyWindow,start:replyStart,
        end:replyEnd,cooldown,maxChars:1200},"Jadwal dan jeda respons tersimpan.",
        d=>setC(v=>({...v,...d})))}>Simpan jadwal</button>
      </section>
      <details className="contactControlSection">
       <summary>Pengaturan khusus (opsional) — standar AI sudah otomatis</summary>
       <h3>Preferensi jika ingin mengoreksi AI</h3>
       <p>AI menentukan gaya dari chat. Isi instruksi berikut hanya jika ada pengecualian yang penting.</p>
       <p className="muted">Gaya default: sopan, adaptif terhadap interaksi terbaru.</p>
       <label className="fieldLabel">Instruksi per pelanggan<textarea className="input" rows={3} maxLength={1500} value={instruction}
        onChange={e=>setInstruction(e.target.value)} placeholder="Contoh: utamakan penjelasan manfaat untuk usaha kecil"/></label>
       <button className="btn primary" disabled={busy} onClick={()=>void mutate({action:"sales_profile",
        responseStyle:style,customerProfile:profile,customInstruction:instruction,lifecycle,maxFollowups},
        "Profil AI dan batas follow-up tersimpan.",d=>setC(v=>({...v,...d})))}>
        Simpan strategi AI</button>
      </details>
      {pendingDrafts.length>0&&<section className="contactControlSection"><h3>Menunggu persetujuan admin ({pendingDrafts.length})</h3>
        {pendingDrafts.map(d=><div className="contactProDraft" key={d.id}>
          <small>{dateWib(d.created_at)} · Draft AI, belum dikirim</small><p>{d.reply}</p>
          <div className="actions">
           <button className="btn primary" disabled={busy} onClick={()=>void mutate({action:"review_draft",draftId:d.id,approve:true},
            "Jawaban disetujui dan dimasukkan ke antrean manual.")}>Setujui & kirim</button>
           <button className="btn" disabled={busy} onClick={()=>void mutate({action:"review_draft",draftId:d.id,approve:false},
            "Draft ditolak, tidak dikirim.")}>Tolak</button>
          </div>
         </div>)}
      </section>}
     </>}
    {active==="promosi"&&<>
      <section className="contactControlSection"><h3><Shield size={17}/> Izin promosi</h3>
       <div className="contactProKpi"><b>{promoStatus}</b><span>{consent?.source||"Belum ada sumber persetujuan"}</span></div>
       <p>Kontak terdaftar otomatis, tetapi persetujuan promosi harus dicatat sebelum dikirim. Status berhenti tetap berlaku hingga ada izin baru yang terdokumentasi.</p>
       {phoneReady?<><label className="fieldLabel">Bukti persetujuan yang diberikan pelanggan
        <textarea className="input" rows={3} maxLength={500} value={permissionEvidence}
         onChange={e=>setPermissionEvidence(e.target.value)} placeholder="Misalnya persetujuan dalam formulir tanggal ..., atau pesan WA tanggal ..."/></label>
        <label className="checkLine"><input type="checkbox" checked={confirmedConsent}
         onChange={e=>setConfirmedConsent(e.target.checked)}/> Saya memastikan ada persetujuan promosi yang dapat dibuktikan.</label>
        <div className="actions">
         <button className="btn primary" disabled={busy||!confirmedConsent||permissionEvidence.trim().length<12}
          onClick={()=>void mutate({action:"promo_consent",allowed:true,evidence:permissionEvidence},"Izin promosi tersimpan dengan sumber.",
           ()=>{setC(v=>({...v,consent:true,opted_out_at:null}));setConfirmedConsent(false);setPermissionEvidence("")})}>Catat izin promosi</button>
         <button className="btn" disabled={busy||!!consent?.opted_out_at} onClick={()=>void mutate({action:"promo_consent",allowed:false,evidence:""},
          "Promosi dihentikan dan antrean terkait dibatalkan.",()=>setC(v=>({...v,consent:false})))}>Hentikan promosi</button>
        </div></>:<p>Kontak @lid belum memiliki nomor telepon terverifikasi untuk broadcast. Bot tetap dapat melayani percakapan masuk.</p>}
      </section>
      <section className="contactControlSection"><h3>Pengecualian otomatis</h3>
       {phoneReady?<div className="contactControlActions">
        <select className="input" value={scope} onChange={e=>setScope(e.target.value)}>
         <option value="NONE">Tidak dikecualikan</option><option value="PROMOTION">Blokir promosi & follow-up</option>
         <option value="ALL_AUTOMATION">Blokir seluruh otomatisasi</option></select>
        <button className="btn" disabled={busy||scope===(c.exclusion||"NONE")} onClick={()=>void exclusions()}>Simpan</button>
       </div>:<p>Pengecualian nomor menunggu identitas nomor terverifikasi.</p>}
       <p>Pesan layanan dan tagihan berlangganan memakai persetujuan layanan tersendiri.</p>
      </section>
    </>}
    {active==="billing"&&<>
      <section className="contactControlSection"><h3><CalendarClock size={17}/> Langganan pelanggan</h3>
       {subs.length===0&&<p>Belum ada langganan aktif yang terkonfirmasi. Bot tidak akan menganggap minat chat sebagai pembelian.</p>}
       {auto?.product_name&&<div className="contactProAutoPanel">
         <b>Produk yang terdeteksi: {auto.product_name}</b>
         <p>Status: {lifecycleLabels[auto.inferred_lifecycle||""]||"Prospek"} · bersumber dari percakapan/CRM.</p>
         {verifiedOrders.length===0&&<small>Belum ada pesanan dengan pembayaran terverifikasi. Nominal dan jatuh tempo belum dapat dibuat otomatis.</small>}
        </div>}
       {verifiedOrders.map(o=><div className="contactProAutoPanel" key={o.id}>
         <b>Pesanan telah terverifikasi: {o.product_name}</b>
         <p>{formatCurrency(o.total)} · {dateWib(o.paid_at)}. Periksa apakah produknya memang berlangganan bulanan.</p>
         <button className="btn" onClick={()=>setSub(s=>({...s,productId:o.product_id,planName:o.product_name,amount:String(o.total)}))}>Gunakan detail transaksi untuk formulir</button>
        </div>)}
       {subs.map(s=><div key={s.id} className="contactProSubscription">
        <div className="sectionTitle"><b>{s.plan_name}</b><span className={"badge "+(s.status==="ACTIVE"?"ok":"warn")}>{s.status==="ACTIVE"?"AKTIF":"BERHENTI"}</span></div>
        <div className="contactControlHistory">
         <div><span>Tagihan</span><b>{formatCurrency(s.amount)}</b></div>
         <div><span>Jatuh tempo</span><b>{dateWib(s.due_at)}</b></div>
        </div>
        <small className="muted">{s.reminder_enabled?"Pengingat aktif":"Pengingat nonaktif"} · {s.service_opt_in?"Persetujuan layanan tercatat":"Belum ada persetujuan layanan"}</small>
        <div className="actions">
         {s.status==="ACTIVE"&&<>
          <button className="btn" disabled={busy} onClick={()=>editSubscription(s)}>Edit</button>
          <button className="btn primary" disabled={busy} onClick={()=>setPaymentChecks(v=>({...v,[s.id]:!v[s.id]}))}>Verifikasi pembayaran</button>
          <button className="btn" disabled={busy} onClick={()=>void mutate({action:"subscription_cancel",id:s.id},
            "Langganan dihentikan. Pengingat berikutnya dibatalkan.")}>Hentikan</button>
         </>}
        </div>
        {paymentChecks[s.id]&&<div className="contactProPayment">
         <p>Konfirmasi hanya setelah admin memeriksa pembayaran benar-benar diterima. Data ini tidak boleh diverifikasi otomatis dari chat pelanggan.</p>
         <input className="input" id={"ref-"+s.id} placeholder="Referensi pembayaran / bukti transfer"/>
         <button className="btn primary" disabled={busy} onClick={()=>{
           const ref=(document.getElementById("ref-"+s.id) as HTMLInputElement)?.value||"";
           if(ref.trim().length<3){setError(true);setNotice("Masukkan referensi pembayaran yang telah diverifikasi.");return}
           void mutate({action:"subscription_payment",id:s.id,amount:Number(s.amount),paidAt:new Date().toISOString(),reference:ref},
            "Pembayaran tercatat dan pengingat periode sebelumnya dibatalkan. Jatuh tempo berikutnya disusun ulang.",
            ()=>setPaymentChecks({}));
          }}>Saya sudah memverifikasi pembayaran</button>
        </div>}
       </div>)}
      </section>
      <details className="contactControlSection" open={!!sub.id}>
       <summary>{sub.id?"Edit detail paket":"Koreksi atau tambahkan kontrak berlangganan (jika belum tercatat)"}</summary>
       <p>Produk dan histori pelanggan dibaca otomatis. Lengkapi hanya kontrak/tanggal jatuh tempo yang belum punya bukti di sistem.</p>
       <div className="contactProForm">
        <label className="fieldLabel">Produk<select className="input" value={sub.productId} onChange={e=>setSub(v=>({...v,productId:e.target.value}))}>
         <option value="">Pilih produk</option>{(snapshot?.products||[]).map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <label className="fieldLabel">Nama paket<input className="input" maxLength={100} value={sub.planName}
          onChange={e=>setSub(v=>({...v,planName:e.target.value}))} placeholder="Contoh: Gajian Pro Bulanan"/></label>
        <label className="fieldLabel">Nominal (Rp)<input className="input" type="number" min="1" value={sub.amount} onChange={e=>setSub(v=>({...v,amount:e.target.value}))}/></label>
        <label className="fieldLabel">Jatuh tempo (WIB)<input className="input" type="datetime-local" value={sub.dueAt} onChange={e=>setSub(v=>({...v,dueAt:e.target.value}))}/></label>
        <label className="fieldLabel">Toleransi keterlambatan (hari)<input className="input" type="number" min="0" max="30" value={sub.graceDays} onChange={e=>setSub(v=>({...v,graceDays:e.target.value}))}/></label>
       </div>
       <label className="checkLine"><input type="checkbox" checked={sub.serviceOptIn} onChange={e=>setSub(v=>({...v,serviceOptIn:e.target.checked,reminderEnabled:e.target.checked?v.reminderEnabled:false}))}/> Pelanggan sudah setuju menerima pengingat layanan.</label>
       <label className="fieldLabel">Bukti persetujuan pengingat (wajib ketika diaktifkan)<textarea className="input" rows={2}
        maxLength={500} value={sub.evidence} onChange={e=>setSub(v=>({...v,evidence:e.target.value}))}
        placeholder="Contoh: Disetujui saat daftar layanan tanggal ..."/></label>
       <label className="checkLine"><input type="checkbox" checked={sub.reminderEnabled} disabled={!sub.serviceOptIn}
        onChange={e=>setSub(v=>({...v,reminderEnabled:e.target.checked}))}/> Aktifkan pengingat otomatis H-7, H-3, H-1, H, H+1</label>
       <p>Pengingat mengikuti jadwal WIB yang dipilih, tidak dikirim apabila periode sudah dibayar atau layanan dihentikan. Pastikan aturan WhatsApp dan periode layanan berlaku.</p>
       <div className="actions"><button className="btn primary" disabled={busy} onClick={saveSubscription}>Simpan langganan</button>
        <button className="btn" disabled={busy} onClick={()=>setSub({...blankSub})}>Kosongkan</button></div>
      </details>
      <section className="contactControlSection"><h3>Riwayat pembayaran terverifikasi</h3>
       {(snapshot?.payments||[]).length===0?<p>Belum ada pembayaran terverifikasi.</p>:(snapshot?.payments||[]).map(x=><div className="contactProHistoryRow" key={x.id}>
        <b>{formatCurrency(x.amount)}</b><small>{dateWib(x.paid_at)} · {x.reference||"Tanpa referensi"}</small></div>)}
      </section>
    </>}
    {active==="memory"&&<>
      <section className="contactControlSection">
       <h3><MessageCircle size={17}/> Memori otomatis dari interaksi</h3>
       <div className="contactProAutoGrid">
        <div><small>Produk diminati</small><b>{auto?.product_name||"Belum diketahui"}</b></div>
        <div><small>Tahap pelanggan</small><b>{lifecycleLabels[auto?.inferred_lifecycle||""]||"Prospek"}</b></div>
        <div><small>Gaya komunikasi</small><b>{auto?.suggested_response_style?.replaceAll("_"," ").toLowerCase()||"Sopan"}</b></div>
       </div>
       <p className="contactProMemoryText">{auto?.conversation_excerpt||"Belum ada pesan pelanggan yang bisa dirangkum."}</p>
       <p>Informasi tersebut dibaca dari WhatsApp, CRM dan transaksi terverifikasi. Tidak perlu input manual.</p>
      </section>
      <details className="contactControlSection"><summary>Perbaiki profil secara manual (opsional)</summary>
       <h3>Profil tambahan dari owner</h3>
       <label className="fieldLabel">Tahap pelanggan<select className="input" value={lifecycle} onChange={e=>setLifecycle(e.target.value)}>
        {Object.entries(lifecycleLabels).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
       <label className="fieldLabel">Kebutuhan dan konteks pelanggan<textarea rows={4} maxLength={2000} className="input" value={profile}
        onChange={e=>setProfile(e.target.value)} placeholder="Contoh: usaha memiliki 8 pegawai, sedang mempertimbangkan Gajian Pro"/></label>
       <button className="btn primary" disabled={busy} onClick={()=>void mutate({action:"sales_profile",responseStyle:style,customInstruction:instruction,
         customerProfile:profile,lifecycle,maxFollowups},"Memori owner untuk AI tersimpan.",d=>setC(v=>({...v,...d})))}>
        Simpan profil AI</button>
      </details>
      <details className="contactControlSection"><summary>Catatan hanya untuk admin (opsional)</summary><h3>Catatan admin</h3>
       <textarea className="input" rows={3} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/>
       <button className="btn" disabled={busy||note.trim()===(c.note||"")} onClick={()=>void mutate({action:"contact_preferences",note:note.trim()},
        "Catatan admin disimpan.",d=>setC(v=>({...v,note:d.note})))}>Simpan catatan</button></details>
      <section className="contactControlSection"><h3>Memori riwayat percakapan</h3>
       <p className="contactProMemoryText">{snapshot?.memory?.summary||"Memori belum terisi. Riwayat chat tetap tersedia di Inbox."}</p>
       <small className="muted">Terakhir diperbarui: {dateWib(snapshot?.memory?.updated_at)}</small>
      </section>
    </>}
    {active==="audit"&&<>
      <section className="contactControlSection"><h3><History size={17}/> Riwayat perubahan owner</h3>
       {(snapshot?.audit||[]).length===0?<p>Belum ada catatan perubahan.</p>:(snapshot?.audit||[]).map(row=><div className="contactProHistoryRow" key={row.id}>
        <b>{prettyAction(row.action)}</b><small>{dateWib(row.created_at)} · {row.detail?.actor||"Sistem"}</small>
       </div>)}
      </section>
      <section className="contactControlSection"><h3>Riwayat interaksi</h3><div className="contactControlHistory">
       <div><span>Pesan pelanggan terakhir</span><b>{dateWib(c.last_customer_message_at)}</b></div>
       <div><span>Balasan AI terakhir</span><b>{dateWib(c.last_ai_message_at)}</b></div></div>
      </section>
    </>}
    {loading&&<div className="notice">Memuat data pengaturan…</div>}
    {notice&&<div role="status" className={"notice section "+(error?"errorNotice":"")}>{notice}</div>}
   </div>
   <footer className="contactControlFooter"><span><CheckCircle2 size={13}/> Pengaturan dikirim ke Supabase dan digunakan antrean bot.</span>
    <div className="actions"><Link href={"/inbox?chat="+encodeURIComponent(c.chat_id)} className="btn">Buka chat</Link>
     <button className="btn primary" disabled={busy} onClick={onClose}>Selesai</button></div>
   </footer>
  </section>
 </div>;
}
