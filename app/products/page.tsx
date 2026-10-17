"use client";
import StorePagination from "@/components/StorePagination";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useStore, rupiah } from "@/components/Store";
const sheet =
  "https://docs.google.com/spreadsheets/d/1IPnxqxjCNJE5rY1cXu88XCfZgApQ0u_NxjD-KoGF5VI/edit";
export default function Products() {
  const s = useStore();
  const [show, setShow] = useState(false);
  const [sheetState,setSheetState]=useState<{configured:boolean;sheet_id:string;latest?:{rows_updated:number;synced_at:string}}|null>(null);
  const [syncBusy,setSyncBusy]=useState(false),[syncError,setSyncError]=useState("");
  useEffect(()=>{fetch("/api/sheets/sync",{cache:"no-store"}).then(r=>r.json()).then(d=>{if(d.sheet_id)setSheetState(d)}).catch(()=>{})},[]);
  async function syncSheet(){
    setSyncBusy(true);setSyncError("");
    try{
      const r=await fetch("/api/sheets/sync",{method:"POST"});
      const d=await r.json();if(!r.ok)throw new Error(d.error||"Sinkronisasi gagal");
      await s.refresh();
      const status=await fetch("/api/sheets/sync",{cache:"no-store"});
      if(status.ok)setSheetState(await status.json());
    }catch(e){setSyncError((e as Error).message)}finally{setSyncBusy(false)}
  }

  const [f, setF] = useState({
    id: "",
    name: "",
    price: "",
    cost: "",
    promoPrice: "",
    description: "",fullDescription:"",benefits:"",demoUrl:"",checkoutUrl:"",
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name) return;
    const payload={
      id: f.id || undefined,
      name: f.name,
      price: Number(f.price) || 0,
      cost: Number(f.cost) || 0,
      promoPrice: Number(f.promoPrice) || 0,
      status: s.products.find(p=>p.id===f.id)?.status || "ACTIVE" as const,
      description: f.description,fullDescription:f.fullDescription,benefits:f.benefits,demoUrl:f.demoUrl,checkoutUrl:f.checkoutUrl,
    };
    if(f.id&&s.products.some(p=>p.id===f.id))s.updateProduct(f.id,payload);else s.addProduct(payload);
    setF({
      id: "",
      name: "",
      price: "",
      cost: "",
      promoPrice: "",
      description: "",fullDescription:"",benefits:"",demoUrl:"",checkoutUrl:"",
    });
    setShow(false);
  }
  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Produk & Pengetahuan AI</h1>
          <p>
            Produk dari spreadsheet disinkronkan ke Supabase dan langsung tersedia di My Control serta sumber pengetahuan AI.
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/campaigns/intelligence">Strategi promosi AI</Link>
          <button className="btn" disabled={syncBusy||sheetState?.configured===false} onClick={()=>void syncSheet()}>
           {syncBusy?"Menyinkronkan…":"Sinkronkan Google Sheet"}
          </button>
          <a className="btn" href={sheet} target="_blank">
            Buka Spreadsheet
          </a>
          <button className="btn primary" onClick={() => setShow(!show)}>
            + Produk
          </button>
        </div>
      </div>
      <div className="notice section" role="status">
        <b>Google Sheets → Supabase → Katalog web dan AI</b>
        <p>{sheetState?.latest?"Sinkron terakhir: "+new Date(sheetState.latest.synced_at).toLocaleString("id-ID")+" · "+sheetState.latest.rows_updated+" produk.":"Memuat status sinkronisasi…"}</p>
        {sheetState?.configured===false&&<p>Import awal sudah dilakukan. Untuk perubahan spreadsheet otomatis selanjutnya, pasang akses service account Google Sheets di Vercel dan berikan akses Viewer ke spreadsheet.</p>}
        {syncError&&<p className="errorText">{syncError}</p>}
        <small>Harga kosong bukan berarti gratis. Hanya produk ACTIVE yang ditawarkan AI.</small>
      </div>
      {show && (
        <form className="card formGrid sectionless" onSubmit={submit}>
          <input
            className="input"
            placeholder="ID produk (opsional)"
            value={f.id}
            onChange={(e) => setF({ ...f, id: e.target.value })}
          />
          <input
            className="input"
            placeholder="Nama produk"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <input
            className="input"
            type="number"
            placeholder="Harga"
            value={f.price}
            onChange={(e) => setF({ ...f, price: e.target.value })}
          />
          <input
            className="input"
            type="number"
            placeholder="HPP"
            value={f.cost}
            onChange={(e) => setF({ ...f, cost: e.target.value })}
          />
          <input
            className="input"
            type="number"
            placeholder="Harga promo"
            value={f.promoPrice}
            onChange={(e) => setF({ ...f, promoPrice: e.target.value })}
          />
          <input
            className="input"
            placeholder="Deskripsi singkat"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
          {([['fullDescription','Penjelasan lengkap: cocok untuk siapa, cara kerja, batasan'],['benefits','Manfaat terverifikasi dan jawaban keberatan'],['demoUrl','Link demo resmi (kosongkan jika belum ada)'],['checkoutUrl','Link pembelian resmi']] as const).map(([key,label])=><label className="fieldLabel span2" key={key}>{label}{key.endsWith('Url')?<input className="input" type="url" value={f[key]} onChange={e=>setF({...f,[key]:e.target.value})}/>:<textarea className="input" rows={4} value={f[key]} onChange={e=>setF({...f,[key]:e.target.value})}/>}</label>)}
          <div className="actions span2">
            <button className="btn primary">Simpan</button>
            <button
              type="button"
              className="btn"
              onClick={() => setShow(false)}
            >
              Batal
            </button>
          </div>
        </form>
      )}
      <div className="card tableWrap section">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Produk</th>
              <th>Harga</th>
              <th>Promo</th>
              <th>HPP</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {s.products.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>
                  <b>{p.name}</b>
                  <div className="tiny muted">
                    {p.description || "Belum ada deskripsi"}
                  </div>
                </td>
                <td>{rupiah(p.price)}</td>
                <td>{p.promoPrice ? rupiah(p.promoPrice) : "-"}</td>
                <td>{rupiah(p.cost)}</td>
                <td>
                  <button
                    className={"badge " + (p.status === "ACTIVE" ? "ok" : "")}
                    onClick={() =>
                      s.updateProduct(p.id, {
                        status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                      })
                    }
                  >
                    {p.status}
                  </button>
                </td>
                <td>
                  <button className="btn" onClick={()=>{setF({id:p.id,name:p.name,price:String(p.price),cost:String(p.cost),promoPrice:String(p.promoPrice),description:p.description,fullDescription:p.fullDescription||"",benefits:p.benefits||"",demoUrl:p.demoUrl||"",checkoutUrl:p.checkoutUrl||""});setShow(true)}}>Edit pengetahuan</button>
                  <button
                    className="linkBtn dangerText"
                    onClick={() => s.deleteProduct(p.id)}
                  >
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <StorePagination/>
    </>
  );
}
