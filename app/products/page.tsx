"use client";
import StorePagination from "@/components/StorePagination";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useStore, type Product, rupiah } from "@/components/Store";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1IPnxqxjCNJE5rY1cXu88XCfZgApQ0u_NxjD-KoGF5VI/edit";
const FIELD_NAMES = [
  "product_id","product_name","status","base_price","cost_hpp","promo_price",
  "short_description","full_description","benefits","demo_url","checkout_url",
  "keywords","delivery_type","faq_qna","objection_handling","target_customer",
  "feature_review_status",
] as const;
type FormData = Record<(typeof FIELD_NAMES)[number],string>;
const blank:FormData = {
  product_id:"",product_name:"",status:"DRAFT",base_price:"",cost_hpp:"",promo_price:"",
  short_description:"",full_description:"",benefits:"",demo_url:"",checkout_url:"",
  keywords:"",delivery_type:"DIGITAL",faq_qna:"",objection_handling:"",
  target_customer:"",feature_review_status:"PERLU_VERIFIKASI_FITUR"
};
type SheetStatus={configured:boolean;sheet_id:string;latest?:{rows_updated:number;synced_at:string}};
async function readResponse(res:Response){
  const json=await res.json().catch(()=>({})) as Record<string,any>;
  if(!res.ok) throw new Error(String(json.error||json.message||"Permintaan gagal ("+res.status+")"));
  return json;
}

export default function Products(){
  const store=useStore();
  const [sheetState,setSheetState]=useState<SheetStatus|null>(null);
  const [syncBusy,setSyncBusy]=useState(false);
  const [syncError,setSyncError]=useState("");
  const [notice,setNotice]=useState("");
  const [show,setShow]=useState(false);
  const [detailBusy,setDetailBusy]=useState(false);
  const [saveBusy,setSaveBusy]=useState(false);
  const [saveError,setSaveError]=useState("");
  const [form,setForm]=useState<FormData>({...blank});
  const [mode,setMode]=useState<"new"|"edit">("new");

  async function loadStatus(){
    try {
      const json=await readResponse(await fetch("/api/sheets/sync",{cache:"no-store"}));
      setSheetState(json as SheetStatus);
    } catch(e){setSyncError((e as Error).message);}
  }
  useEffect(()=>{void loadStatus();},[]);
  useEffect(()=>{
    if(!show)return;
    const key=(e:KeyboardEvent)=>{if(e.key==="Escape"&&!saveBusy)setShow(false);};
    window.addEventListener("keydown",key);
    return()=>window.removeEventListener("keydown",key);
  },[show,saveBusy]);

  function setField(name:keyof FormData,value:string){setForm(prev=>({...prev,[name]:value}));}
  function newProduct(){
    setForm({...blank});setMode("new");setSaveError("");setDetailBusy(false);setShow(true);
  }
  async function openEdit(p:Product){
    setForm({...blank,product_id:p.id,product_name:p.name,status:p.status,
      base_price:p.price?String(p.price):"",cost_hpp:p.cost?String(p.cost):"",
      promo_price:p.promoPrice?String(p.promoPrice):"",short_description:p.description,
      full_description:p.fullDescription||"",benefits:p.benefits||"",
      demo_url:p.demoUrl||"",checkout_url:p.checkoutUrl||""});
    setMode("edit");setSaveError("");setShow(true);setDetailBusy(true);
    try {
      const data=await readResponse(await fetch("/api/products/knowledge?id="+encodeURIComponent(p.id),{cache:"no-store"}));
      setForm(prev=>{
        const copy={...prev};
        for(const key of FIELD_NAMES)if(data.product?.[key]!==undefined&&data.product?.[key]!==null)
          copy[key]=String(data.product[key]);
        return copy;
      });
    }catch(e){setSaveError("Tidak bisa memuat seluruh pengetahuan: "+(e as Error).message);}
    finally{setDetailBusy(false);}
  }

  async function save(e:FormEvent){
    e.preventDefault(); if(detailBusy||saveBusy)return;
    setSaveBusy(true);setSaveError("");
    try {
      const product={...form,product_id:form.product_id.trim()||"PRD-"+Date.now().toString(36).toUpperCase()};
      const json=await readResponse(await fetch("/api/products/knowledge",{
        method:"PUT",headers:{"content-type":"application/json"},
        body:JSON.stringify({product})
      }));
      await store.refresh();
      await loadStatus();
      setNotice(json.sheet_synced
        ?"Produk dan pengetahuan AI berhasil disimpan ke Supabase serta Google Sheets."
        :"Produk dan pengetahuan AI sudah tersimpan di My Control. "+(json.warning||"Sinkronisasi Google Sheets masih tertunda."));
      setShow(false);
    }catch(e){setSaveError((e as Error).message);}
    finally{setSaveBusy(false);}
  }
  async function syncSheet(){
    setSyncBusy(true);setSyncError("");setNotice("");
    try {
      const response=await fetch("/api/sheets/sync",{method:"POST"});
      const result=await readResponse(response);
      await store.refresh();await loadStatus();
      setNotice("Sinkronisasi selesai: "+(result.products||0)+" produk diproses. Data dan pengetahuan AI telah diperbarui.");
    }catch(e){setSyncError((e as Error).message);}finally{setSyncBusy(false);}
  }
  async function toggleStatus(p:Product){
    setNotice("");setSaveError("");
    try {
      const data=await readResponse(await fetch("/api/products/knowledge?id="+encodeURIComponent(p.id),{cache:"no-store"}));
      const updated={...data.product,status:p.status==="ACTIVE"?"INACTIVE":"ACTIVE"};
      const result=await readResponse(await fetch("/api/products/knowledge",{
        method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({product:updated})
      }));
      await store.refresh();
      setNotice(result.sheet_synced?"Status produk tersimpan di My Control dan Sheets.":
        "Status produk tersimpan di My Control; perubahan Google Sheets masih menunggu koneksi Editor.");
    }catch(e){setSyncError((e as Error).message);}
  }
  async function removeProduct(id:string){
    if(!window.confirm("Hapus produk "+id+" dari My Control? Produk di Google Sheets tidak terhapus otomatis."))return;
    try {
      await readResponse(await fetch("/api/database/products?id=eq."+encodeURIComponent(id),{method:"DELETE"}));
      await store.refresh();setNotice("Produk dihapus dari My Control. Periksa juga baris di master Google Sheets agar tidak diimpor kembali.");
    }catch(e){setSyncError((e as Error).message);}
  }

  const Field=({field,label,rows=0,span=false}:{field:keyof FormData;label:string;rows?:number;span?:boolean})=>(
    <label className={"fieldLabel"+(span?" span2":"")}>
      {label}
      {rows>0?
        <textarea className="input" rows={rows} value={form[field]} onChange={e=>setField(field,e.target.value)}/>:
        <input className="input" value={form[field]} onChange={e=>setField(field,e.target.value)}/>}
    </label>
  );

  return <>
    <div className="pageHead">
      <div>
        <h1>Produk & Pengetahuan AI</h1>
        <p>Satu katalog untuk My Control, CRM, Blash, dan jawaban AI. Google Sheets adalah master impor.</p>
      </div>
      <div className="actions">
        <Link className="btn" href="/campaigns/intelligence">Strategi promosi AI</Link>
        <button className="btn" type="button" disabled={syncBusy||sheetState?.configured===false}
          onClick={()=>void syncSheet()}>{syncBusy?"Menyinkronkan…":"Sinkronkan Google Sheets"}</button>
        <a className="btn" href={SHEET_URL} target="_blank" rel="noopener noreferrer">Buka Spreadsheet</a>
        <button className="btn primary" type="button" onClick={newProduct}>+ Produk</button>
      </div>
    </div>
    <div className="notice section" role="status">
      <strong>Google Sheets → Supabase → AI CS</strong>
      <p>{sheetState?.latest?
        "Sinkron terakhir: "+new Date(sheetState.latest.synced_at).toLocaleString("id-ID")+" · "+sheetState.latest.rows_updated+" produk.":
        "Memuat status sinkronisasi…"}</p>
      {sheetState?.configured===false&&
        <p><strong>Sinkron otomatis belum terhubung.</strong> Vercel memerlukan GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON dan izin Editor pada Google Sheets. Edit di web tetap disimpan di database, dengan peringatan jika belum dapat dikirim ke Sheets.</p>}
      {notice&&<p role="status">{notice}</p>}
      {syncError&&<p className="errorText" role="alert">{syncError}</p>}
      <small>Harga belum diisi ≠ gratis. AI hanya menawarkan produk aktif dan informasi yang terverifikasi.</small>
    </div>

    <div className="card tableWrap section">
      <table className="table">
        <thead><tr><th>ID</th><th>Produk</th><th>Harga</th><th>Promo</th><th>HPP</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>{store.products.map(p=>(
          <tr key={p.id}>
            <td>{p.id}</td>
            <td><b>{p.name}</b><div className="tiny muted">{p.description||"Belum ada deskripsi"}</div></td>
            <td>{p.price>0?rupiah(p.price):"Belum diisi"}</td>
            <td>{p.promoPrice>0?rupiah(p.promoPrice):"-"}</td>
            <td>{p.cost>0?rupiah(p.cost):"-"}</td>
            <td><button className={"badge "+(p.status==="ACTIVE"?"ok":"")} type="button"
              onClick={()=>void toggleStatus(p)}>{p.status}</button></td>
            <td><button className="btn" type="button" onClick={()=>void openEdit(p)}>
              Edit pengetahuan</button>{" "}
              <button className="linkBtn dangerText" type="button" onClick={()=>void removeProduct(p.id)}>Hapus</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
    <StorePagination/>

    {show&&<div className="contactControlOverlay" role="presentation">
      <div className="contactControlModal" role="dialog" aria-modal="true"
        aria-label={mode==="edit"?"Edit pengetahuan "+form.product_name:"Tambah produk"}>
        <header style={{padding:"18px 20px",borderBottom:"1px solid var(--line)",display:"flex",
          alignItems:"center",justifyContent:"space-between",gap:12}}>
          <div><strong style={{fontSize:18}}>{mode==="edit"?"Edit pengetahuan produk":"Tambah produk baru"}</strong>
            <div className="tiny muted">{form.product_name||"Lengkapi master produk"} · AI CS menggunakan data resmi ini</div></div>
          <button type="button" className="btn" disabled={saveBusy}
            onClick={()=>setShow(false)} aria-label="Tutup formulir">Tutup ×</button>
        </header>
        <form onSubmit={e=>void save(e)} style={{overflowY:"auto",padding:"18px 20px",
          display:"flex",flexDirection:"column",gap:15,minHeight:0}}>
          {detailBusy?<p>Memuat data produk lengkap, FAQ, dan panduan AI…</p>:<>
            <div className="formGrid">
              <Field field="product_id" label="ID produk" />
              <Field field="product_name" label="Nama produk" />
              <label className="fieldLabel">Status
                <select className="input" value={form.status} onChange={e=>setField("status",e.target.value)}>
                  <option value="ACTIVE">Aktif · boleh ditawarkan AI</option>
                  <option value="DRAFT">Draf · tidak ditawarkan AI</option>
                  <option value="INACTIVE">Nonaktif</option>
                </select></label>
              <label className="fieldLabel">Verifikasi fitur
                <select className="input" value={form.feature_review_status}
                  onChange={e=>setField("feature_review_status",e.target.value)}>
                  <option value="PERLU_VERIFIKASI_FITUR">Perlu verifikasi</option>
                  <option value="TERVERIFIKASI">Sudah terverifikasi owner</option>
                </select></label>
              <Field field="base_price" label="Harga utama (kosong = belum diketahui)" />
              <Field field="promo_price" label="Harga promo (opsional)" />
              <Field field="cost_hpp" label="HPP (internal, tidak diumumkan AI)" />
              <Field field="delivery_type" label="Jenis pengiriman / delivery" />
              <Field field="short_description" label="Ringkasan katalog" rows={3} span/>
              <Field field="full_description" label="Penjelasan lengkap & cara kerja" rows={6} span/>
              <Field field="benefits" label="Manfaat / keunggulan terverifikasi" rows={4} span/>
              <Field field="target_customer" label="Target pelanggan" rows={3} span/>
              <Field field="faq_qna" label="FAQ untuk AI (satu pasangan tanya-jawab per baris)" rows={6} span/>
              <Field field="objection_handling" label="Cara menjawab keberatan pelanggan" rows={5} span/>
              <Field field="keywords" label="Kata kunci pencarian (pisahkan koma)" rows={2} span/>
              <Field field="demo_url" label="URL demo HTTPS (jika ada)" span/>
              <Field field="checkout_url" label="URL pembelian HTTPS (jika ada)" span/>
            </div>
            <small className="muted">Informasi yang tidak terverifikasi tidak boleh dijanjikan oleh AI. Jika Google belum terhubung, perubahan disimpan di My Control dan diberi status menunggu sinkronisasi.</small>
          </>}
          {saveError&&<p role="alert" className="errorText">{saveError}</p>}
          <div className="actions" style={{position:"sticky",bottom:0,padding:"12px 0",
            borderTop:"1px solid var(--line)",background:"var(--panel)"}}>
            <button className="btn primary" type="submit" disabled={detailBusy||saveBusy||!form.product_name.trim()}>
              {saveBusy?"Menyimpan…":"Simpan pengetahuan"}</button>
            <button className="btn" type="button" disabled={saveBusy} onClick={()=>setShow(false)}>Batal</button>
          </div>
        </form>
      </div>
    </div>}
  </>;
}
