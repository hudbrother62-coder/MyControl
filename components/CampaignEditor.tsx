"use client";
import {useState} from "react";
import Link from "next/link";
import {CampaignStep,campaignRequest,validateSteps} from "@/lib/campaigns";
import {useCampaignData} from "./useCampaignData";
export default function CampaignEditor({products,onDone,onClose}:{products:any[];onDone:(id:string)=>void;onClose:()=>void}){
 const [search,setSearch]=useState(""),[offset,setOffset]=useState(0);
 const {data}=useCampaignData("?view=contacts&q="+encodeURIComponent(search)+"&offset="+offset);
 const [name,setName]=useState(""),[product,setProduct]=useState(""),[selected,setSelected]=useState<string[]>([]);
 const [steps,setSteps]=useState<CampaignStep[]>([{type:"TEXT",body:""}]);
 const [bot,setBot]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const contacts=(data?.contacts||[]).filter((c:any)=>c.consent&&!c.opted_out_at&&!c.exclusion&&/^[1-9][0-9]{7,14}$/.test(c.phone||""));
 const picked=contacts.filter((c:any)=>selected.includes(c.phone));
 const edit=(i:number,patch:Partial<CampaignStep>)=>setSteps(xs=>xs.map((s,j)=>i===j?{...s,...patch}:s));
 async function selectAll(){
  try{const d=await campaignRequest(undefined,"?view=selection&q="+encodeURIComponent(search));setSelected(d.phones||[]);setError("")}
  catch(e){setError((e as Error).message)}
 }
 async function upload(i:number,file?:File){
  if(!file)return;setBusy(true);
  try{
   const r=await fetch("/api/campaigns/media",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:file.type,size:file.size})});
   const d=await r.json();if(!r.ok)throw new Error(d.error||"Upload tidak tersedia");
   const put=await fetch(d.signedUrl,{method:"PUT",headers:{"content-type":file.type,"x-upsert":"false"},body:file});
   if(!put.ok)throw new Error("Upload video gagal");
   edit(i,{media_url:d.path});setError("");
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function save(){
  setBusy(true);setError("");
  try{
   if(!name.trim()||!product)throw new Error("Isi nama kampanye dan produk");
   if(!selected.length)throw new Error("Pilih penerima yang memiliki izin promosi");
   validateSteps(steps);
   const r=await campaignRequest({action:"create",campaign:{name:name.trim(),product_id:product,phones:selected,steps,bot_enabled:bot}});
   onDone(r.id);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <section className="card campaignEditor onePageCampaign">
  <div className="sectionTitle"><div><h2>Buat kampanye</h2><p className="muted">Semua pengaturan dalam satu halaman. Simpan draft sebelum uji dan pengiriman.</p></div><button className="btn" onClick={onClose}>Tutup</button></div>
  <div className="oneCampaignGrid">
   <section className="oneCampaignBlock">
    <h3>1. Produk dan nama kampanye</h3>
    <div className="formGrid">
     <label className="fieldLabel">Nama kampanye<input className="input" maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Contoh: Sekolapro bulan ini"/></label>
     <label className="fieldLabel">Produk<select className="input" value={product} onChange={e=>setProduct(e.target.value)}>
       <option value="">Pilih produk</option>{products.map(p=><option key={p.source_key} value={p.source_key}>{p.payload?.product_name||p.source_key}</option>)}
      </select></label>
    </div>
    <div className="muted">Fakta produk dan materi promosi dibaca dari katalog. <Link href="/campaigns/intelligence">Atur pengetahuan AI →</Link></div>
   </section>
   <section className="oneCampaignBlock">
    <h3>2. Penerima yang mengizinkan promosi</h3>
    <div className="campaignToolbar">
     <input className="input" aria-label="Cari penerima" placeholder="Cari nama atau nomor" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0)}}/>
     <button className="btn" onClick={()=>void selectAll()}>Pilih hingga 1.000</button>
     <button className="btn" onClick={()=>setSelected([])}>Kosongkan</button>
    </div>
    <p className="muted">{selected.length} dipilih · {contacts.length} tersedia di halaman ini. <Link href="/contacts">Kelola izin kontak</Link></p>
    <div className="recipientPicker">
     {contacts.map((c:any)=><label key={c.phone} className="checkLine">
      <input type="checkbox" checked={selected.includes(c.phone)} onChange={e=>setSelected(old=>e.target.checked?Array.from(new Set([...old,c.phone])).slice(0,1000):old.filter(x=>x!==c.phone))}/>
      <span><b>{c.name}</b><small>+{c.phone} · {c.tags||"Tanpa label"}</small></span>
     </label>)}
     {!contacts.length&&<div className="empty">Belum ada penerima dengan izin promosi. Kontak tanpa izin tidak dimasukkan otomatis.</div>}
    </div>
    <div className="actions section">
     <button className="btn" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Sebelumnya</button>
     <span>Halaman {offset/50+1}</span>
     <button className="btn" disabled={(data?.contacts?.length||0)<50} onClick={()=>setOffset(offset+50)}>Berikutnya</button>
    </div>
   </section>
   <section className="oneCampaignBlock">
    <h3>3. Pesan kampanye</h3>
    <div className="campaignCompose">
     <div>{steps.map((s,i)=><div key={i} className="messageEditor">
      <div className="sectionTitle"><h3>Pesan {i+1}</h3>{i>0&&<button className="btn" onClick={()=>setSteps(xs=>xs.filter((_,j)=>j!==i))}>Hapus</button>}</div>
      <label className="fieldLabel">Jenis pesan<select className="input" value={s.type} onChange={e=>edit(i,{type:e.target.value as CampaignStep["type"]})}>
       <option value="TEXT">Teks</option><option value="VIDEO">Video dan caption</option>
      </select></label>
      {s.type==="VIDEO"&&<>
       <label className="fieldLabel">MP4 (maksimal 25 MB)<input className="input" type="file" accept="video/mp4" disabled={busy} onChange={e=>void upload(i,e.target.files?.[0])}/></label>
       <label className="fieldLabel">URL video HTTPS<input className="input" value={s.media_url||""} onChange={e=>edit(i,{media_url:e.target.value})}/></label>
      </>}
      <label className="fieldLabel">{s.type==="VIDEO"?"Caption":"Isi pesan"}
       <textarea className="input" rows={4} maxLength={4000} value={s.body} onChange={e=>edit(i,{body:e.target.value})} placeholder="Halo {{nama}}, …"/></label>
      <small className="muted">{s.body.length}/4.000 · Gunakan {"{{nama}}"} untuk nama penerima</small>
     </div>)}
     {steps.length<2&&<button className="btn" onClick={()=>setSteps([...steps,{type:"TEXT",body:""}])}>+ Tambah pesan kedua</button>}
     </div>
     <aside className="messagePreview"><small>PRATINJAU PESAN</small><h3>{picked[0]?.name||"Nama pelanggan"}</h3>
      {steps.map((s,i)=><div className="previewBubble" key={i}>{s.type==="VIDEO"&&<div className="videoPlaceholder">▷ Video</div>}
       <p>{s.body.replaceAll("{{nama}}",picked[0]?.name||"Pelanggan")||"Pesan akan tampil di sini."}</p></div>)}
     </aside>
    </div>
   </section>
   <section className="oneCampaignBlock">
    <h3>4. Bot dan pemeriksaan</h3>
    <label className="checkLine"><input type="checkbox" checked={bot} onChange={e=>setBot(e.target.checked)}/>
     <span><b>AI menangani balasan penerima</b><small>Mode per kontak dan kendali owner tetap berlaku.</small></span>
    </label>
    <div className="campaignReview">
     <div><small>Produk</small><b>{products.find(x=>x.source_key===product)?.payload?.product_name||"Belum dipilih"}</b></div>
     <div><small>Penerima</small><b>{selected.length}</b></div>
     <div><small>Pesan</small><b>{steps.length}</b></div>
     <div><small>Balasan</small><b>{bot?"AI sesuai aturan":"Admin"}</b></div>
    </div>
    <div className="notice">Simpan sebagai draft. Pengiriman hanya bisa dimulai setelah pengujian dan konfirmasi owner.</div>
   </section>
  </div>
  {error&&<div className="notice errorNotice section" role="alert">{error}</div>}
  <div className="actions section"><button className="btn primary" disabled={busy} onClick={()=>void save()}>{busy?"Menyimpan…":"Simpan draft kampanye"}</button>
   <button className="btn" onClick={onClose}>Batal</button></div>
 </section>;
}
