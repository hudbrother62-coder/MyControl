"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, ChevronLeft, CheckCircle2, Clock3, Megaphone, RefreshCw, ShieldCheck } from "lucide-react";

type Product={id:string;name:string;status:string;base_price:number;short_description:string|null;full_description:string|null;benefits:string|null};
type Guide={product_id:string;target_customers:string;customer_problems:string;key_benefits:string;verified_features:string;differentiators:string;use_cases:string;objections:string;proof_points:string;limitations:string;next_step:string};
type Offer={id:string;product_id:string;name:string;discount_type:"FIXED"|"PERCENT";discount_value:number;start_at:string|null;end_at:string|null;notes:string|null;active:boolean};
const descriptions:[
  ["target_customers","Untuk siapa produk ini?","Contoh: pemilik usaha, HR, admin penggajian. Tulis sasaran spesifik."],
  ["customer_problems","Masalah pelanggan yang dibantu","Masalah sebelum memakai produk. Bukan daftar fitur."],
  ["key_benefits","Manfaat & hasil yang realistis","Hubungkan masalah pelanggan → manfaat. Hindari janji hasil pasti."],
  ["verified_features","Fitur yang SUDAH dipastikan aktif","Hanya fitur yang sudah diperiksa di aplikasi saat ini. Jika belum yakin, kosongkan."],
  ["differentiators","Kekuatan dan pembeda produk","Alasan pelanggan mempertimbangkan produk ini, berdasar kemampuan nyata."],
  ["use_cases","Contoh situasi penggunaan","Contoh masalah pelanggan dan cara produk membantu, tanpa mengarang integrasi."],
  ["objections","Keberatan pelanggan & jawaban","Misal: apakah sulit? apakah cocok untuk usaha kecil? Jawab sesuai informasi resmi."],
  ["proof_points","Bukti dan referensi resmi","Demo, hasil uji, atau fakta terverifikasi. Jangan mengarang testimoni."],
  ["limitations","Batasan dan hal yang tidak boleh dijanjikan","Integrasi, fitur beta, batas paket, atau kebijakan yang belum dikonfirmasi."],
  ["next_step","CTA dan langkah lanjut yang tersedia","Ajak bertanya, melihat contoh, atau checkout hanya jika link sudah resmi."]
] as const;
type GuideField=typeof descriptions[number][0];
const empty=():Guide=>Object.fromEntries(descriptions.map(([key])=>[key,""])) as unknown as Guide;
function rupiah(n:number){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n)}
function toInput(s:string|null){if(!s)return "";const d=new Date(s);return Number.isFinite(d.getTime())?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16):""}
export default function SalesIntelligence(){
 const [data,setData]=useState<{products:Product[];guides:Guide[];promotions:Offer[]}|null>(null);
 const [product,setProduct]=useState("");
 const [tab,setTab]=useState<"guide"|"offers">("guide");
 const [guide,setGuide]=useState<Guide>(empty());
 const [offer,setOffer]=useState({id:"",name:"",discount_type:"FIXED",discount_value:"",start_at:"",end_at:"",notes:"",active:false});
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState(""),[error,setError]=useState("");
 const load=useCallback(async()=>{
   setLoading(true);try{
    const r=await fetch("/api/campaigns/intelligence",{cache:"no-store"});
    const d=await r.json();if(!r.ok)throw new Error(d.error||"Gagal memuat pengetahuan");
    setData(d);setProduct(prev=>prev||d.products?.[0]?.id||"");setError("");
   }catch(e){setError((e as Error).message)}finally{setLoading(false)}
 },[]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{
  const g=data?.guides.find(x=>x.product_id===product);
  setGuide({...empty(),...g,product_id:product});
 },[product,data]);
 const p=data?.products.find(x=>x.id===product);
 const offers=(data?.promotions||[]).filter(x=>x.product_id===product);
 const filled=descriptions.filter(([k])=>!!guide[k]?.trim()).length;
 async function post(payload:Record<string,unknown>,success:string) {
  if(busy)return;setBusy(true);setNotice("");setError("");
  try{
   const r=await fetch("/api/campaigns/intelligence",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
   const d=await r.json();if(!r.ok)throw new Error(d.error||"Gagal menyimpan");
   await load();setNotice(success);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 function editOffer(x:Offer){
  setOffer({id:x.id,name:x.name,discount_type:x.discount_type,discount_value:String(x.discount_value),
   start_at:toInput(x.start_at),end_at:toInput(x.end_at),notes:x.notes||"",active:x.active});
  setTab("offers");
 }
 const preview=[
  ["Pelanggan bertanya: cocok untuk siapa?",guide.target_customers||"Isi sasaran pembeli terlebih dahulu"],
  ["Pelanggan bertanya: manfaatnya apa?",guide.key_benefits||"Isi manfaat yang didukung fakta produk"],
  ["Pelanggan ragu atau membandingkan",guide.objections||"Tambahkan jawaban keberatan yang faktual"]
 ];
 return <div className="salesBrain">
   <div className="pageHead">
    <div><Link className="linkBtn" href="/campaigns"><ChevronLeft size={15}/> Kembali ke kampanye</Link>
     <h1>Materi Promosi & Otak AI</h1>
     <p>Ajari AI memahami produk, bukan hanya menghafal jawaban. Materi tersimpan langsung di Supabase.</p>
    </div>
    <button className="btn" disabled={loading||busy} onClick={()=>void load()}><RefreshCw size={15}/> Perbarui</button>
   </div>
   <div className="notice section">**Sumber resmi AI:** manfaat boleh dijelaskan dengan bahasa yang fleksibel, tetapi harga, promo, fitur aktif, demo, hasil dan integrasi harus berdasarkan data terverifikasi. Memori percakapan pelanggan tidak mengubah fakta produk.</div>
   {error&&<div role="alert" className="notice errorNotice section">{error}</div>}
   {notice&&<div role="status" className="notice section">{notice}</div>}
   <section className="card section brainToolbar">
    <label className="fieldLabel">Pilih produk yang ingin diajarkan ke AI
     <select className="input" value={product} disabled={busy||loading} onChange={e=>setProduct(e.target.value)}>
      {(data?.products||[]).map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
     </select>
    </label>
    <div className="brainProductMeta">
     <span className={"badge "+(p?.status==="ACTIVE"?"ok":"warn")}>{p?.status||"Belum dipilih"}</span>
     <span>{p?.base_price && Number(p.base_price)>0 ? rupiah(Number(p.base_price)) : "Harga belum dikonfirmasi"}</span>
    </div>
   </section>
   <div className="brainTabs" role="group" aria-label="Pengelolaan promosi">
    <button className={"btn "+(tab==="guide"?"primary":"")} onClick={()=>setTab("guide")}><BookOpen size={16}/> Pengetahuan Penjualan</button>
    <button className={"btn "+(tab==="offers"?"primary":"")} onClick={()=>setTab("offers")}><Megaphone size={16}/> Penawaran Promo</button>
   </div>
   {!data?.products?.length&&!loading&&<div className="card empty">Belum ada produk. <Link href="/products">Tambahkan produk dulu.</Link></div>}
   {p&&tab==="guide"&&<>
    <div className="brainMain">
     <section className="card brainEditor">
      <div className="sectionTitle"><div><h2>Profil kekuatan produk</h2><p className="muted">Lengkapi materi agar AI dapat menjawab pertanyaan yang tidak tertulis persis di FAQ.</p></div><span className="badge">{filled}/10 terisi</span></div>
      {descriptions.map(([key,label,hint])=><label className="fieldLabel" key={key}>
       {label}
       <small className="muted">{hint}</small>
       <textarea className="input" rows={key==="key_benefits"||key==="objections"?4:3}
        maxLength={key==="next_step"?1800:key==="target_customers"||key==="differentiators"||key==="proof_points"||key==="limitations"?2500:3500}
        value={guide[key]||""} disabled={busy} onChange={e=>setGuide(old=>({...old,[key]:e.target.value}))}/>
      </label>)}
      <div className="actions"><button className="btn primary" disabled={busy} onClick={()=>void post({action:"save_guide",product_id:product,guide},"Materi produk tersimpan sebagai sumber resmi AI. Tidak perlu impor ulang workflow.")}>{busy?"Menyimpan…":"Simpan pengetahuan AI"}</button>
       <Link className="btn" href="/products">Edit katalog & harga</Link></div>
     </section>
     <aside className="card brainPreview">
      <h2><CheckCircle2 size={18}/> Persiapan AI</h2>
      <p className="muted">{p.short_description||"Deskripsi katalog belum terisi"}</p>
      <div className="brainReady"><b>{filled} dari 10 bagian tersedia</b><div className="brainProgress"><span style={{width:(filled*10)+"%"}}/></div></div>
      <h3>Contoh konteks yang bisa dipakai AI</h3>
      {preview.map(([question,answer])=><div key={question} className="brainExample"><small>{question}</small><p>{answer}</p></div>)}
      <div className="notice"><ShieldCheck size={17}/> Pratinjau sumber, bukan balasan AI yang sudah diuji. Konten baru dipakai setelah disimpan.</div>
     </aside>
    </div>
   </>}
   {p&&tab==="offers"&&<div className="brainMain">
    <section className="card brainEditor">
     <div className="sectionTitle"><div><h2>{offer.id?"Edit penawaran":"Buat penawaran"}</h2><p className="muted">Promo resmi akan dibaca bot hanya saat aktif dan berada dalam periode berlakunya.</p></div></div>
     <label className="fieldLabel">Nama penawaran
       <input className="input" maxLength={120} value={offer.name} onChange={e=>setOffer({...offer,name:e.target.value})} placeholder="Contoh: Diskon pendaftaran Oktober"/>
     </label>
     <div className="formGrid">
      <label className="fieldLabel">Jenis diskon<select className="input" value={offer.discount_type} onChange={e=>setOffer({...offer,discount_type:e.target.value})}><option value="FIXED">Potongan rupiah</option><option value="PERCENT">Persentase (%)</option></select></label>
      <label className="fieldLabel">Nilai diskon<input className="input" type="number" step="0.01" min="0.01" max={offer.discount_type==="PERCENT"?"100":undefined} value={offer.discount_value} onChange={e=>setOffer({...offer,discount_value:e.target.value})}/></label>
      <label className="fieldLabel">Mulai (waktu lokal perangkat)<input className="input" type="datetime-local" value={offer.start_at} onChange={e=>setOffer({...offer,start_at:e.target.value})}/></label>
      <label className="fieldLabel">Berakhir<input className="input" type="datetime-local" value={offer.end_at} onChange={e=>setOffer({...offer,end_at:e.target.value})}/></label>
     </div>
     <label className="fieldLabel">Syarat dan penjelasan resmi<textarea className="input" rows={4} maxLength={2000} value={offer.notes} onChange={e=>setOffer({...offer,notes:e.target.value})} placeholder="Siapa yang berhak, batasan, dan syarat promo. Jangan tulis janji yang belum disetujui."/></label>
     <label className="checkLine"><input type="checkbox" checked={offer.active} onChange={e=>setOffer({...offer,active:e.target.checked})}/> Aktifkan penawaran ini setelah datanya dipastikan benar.</label>
     <div className="actions">
      <button className="btn primary" disabled={busy||!offer.name.trim()||!(Number(offer.discount_value)>0)} onClick={()=>void post({
       action:"save_offer",...(offer.id?{id:offer.id}:{}),name:offer.name,product_id:product,
       discount_type:offer.discount_type,discount_value:Number(offer.discount_value),notes:offer.notes,
       start_at:offer.start_at?new Date(offer.start_at).toISOString():null,
       end_at:offer.end_at?new Date(offer.end_at).toISOString():null,active:offer.active
      },"Penawaran disimpan dan disinkronkan ke pengetahuan AI.")}>{busy?"Menyimpan…":"Simpan promo"}</button>
      <button className="btn" onClick={()=>setOffer({id:"",name:"",discount_type:"FIXED",discount_value:"",start_at:"",end_at:"",notes:"",active:false})}>Kosongkan</button>
     </div>
     <p className="muted">Promo ini tidak otomatis mengirim broadcast. Pengiriman kampanye tetap memerlukan pilihan penerima, izin promosi, dan persetujuan admin.</p>
    </section>
    <aside className="card brainPreview">
      <h2><Clock3 size={18}/> Daftar penawaran {p.name}</h2>
      {!offers.length&&<p className="muted">Belum ada penawaran. Isi diskon dan syaratnya untuk membuat promo resmi.</p>}
      {offers.map(x=>{const inPeriod=(!x.start_at||new Date(x.start_at)<=new Date())&&(!x.end_at||new Date(x.end_at)>=new Date());
       return <div className="brainOffer" key={x.id}>
        <div className="sectionTitle"><b>{x.name}</b><span className={"badge "+(x.active&&inPeriod?"ok":"warn")}>{!x.active?"Nonaktif":inPeriod?"Berlaku":"Di luar periode"}</span></div>
        <p>{x.discount_type==="PERCENT"?x.discount_value+"%":rupiah(Number(x.discount_value))} potongan</p>
        <small className="muted">{x.start_at?new Date(x.start_at).toLocaleDateString("id-ID"):"Tanpa awal"} – {x.end_at?new Date(x.end_at).toLocaleDateString("id-ID"):"Tanpa akhir"}</small>
        {x.notes&&<p className="muted">{x.notes}</p>}
        <div className="actions">
          <button className="btn" disabled={busy} onClick={()=>editOffer(x)}>Edit</button>
          <button className="btn" disabled={busy} onClick={()=>void post({action:"toggle_offer",id:x.id,active:!x.active},x.active?"Promosi dinonaktifkan.":"Promosi diaktifkan; periksa periode berlaku.")}>{x.active?"Nonaktifkan":"Aktifkan"}</button>
        </div>
       </div>
      })}
      <div className="notice">Jika harga utama belum dikonfirmasi, AI tidak boleh menghitung atau mengiklankan harga akhir seolah-olah sudah resmi.</div>
    </aside>
   </div>}
 </div>
}
