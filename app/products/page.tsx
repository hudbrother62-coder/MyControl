"use client";
import StorePagination from "@/components/StorePagination";
import { FormEvent, useState } from "react";
import { useStore, rupiah } from "@/components/Store";
const sheet =
  "https://docs.google.com/spreadsheets/d/1IPnxqxjCNJE5rY1cXu88XCfZgApQ0u_NxjD-KoGF5VI/edit";
export default function Products() {
  const s = useStore();
  const [show, setShow] = useState(false);
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
            Kelola pengetahuan resmi AI di sini. Perubahan tersimpan langsung ke database; spreadsheet menjadi referensi pengisian.
          </p>
        </div>
        <div className="actions">
          <a className="btn" href={sheet} target="_blank">
            Buka Spreadsheet
          </a>
          <button className="btn primary" onClick={() => setShow(!show)}>
            + Produk
          </button>
        </div>
      </div>
      <div className="notice section">AI membaca deskripsi, penjelasan lengkap, manfaat, dan link resmi. Harga 0 dianggap belum diisi, bukan gratis. Isi hanya informasi yang sudah dipastikan. Perubahan di spreadsheet tidak otomatis masuk web.</div>
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
