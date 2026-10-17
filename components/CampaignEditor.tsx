"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {CampaignStep,campaignRequest,normalizePhone,validateSteps} from "@/lib/campaigns";
import {useCampaignData} from "./useCampaignData";
type ImportContact={phone:string;name:string;tags:string;consent:boolean;consent_evidence:string};
type KnownContact={phone:string|null;chat_id?:string;name:string;tags?:string;consent?:boolean;opted_out_at?:string|null;exclusion?:string|null};
function csvRows(raw:string){
 const first=raw.split(/\r?\n/,1)[0]||"";
 const delimiter=first.includes(";")?";":",";
 const result:string[][]=[];let row:string[]=[];let value="";let quoted=false;
 for(let i=0;i<raw.length;i++){
  const c=raw[i];if(c==='"'){if(quoted&&raw[i+1]==='"'){value+='"';i++}else quoted=!quoted}
  else if(c===delimiter&&!quoted){row.push(value);value=""}
  else if(c==="\n"&&!quoted){row.push(value.replace(/\r$/,""));result.push(row);row=[];value=""}
  else value+=c;
 }
 if(quoted)throw new Error("Format CSV: tanda kutip belum ditutup");
 if(row.length||value){row.push(value.replace(/\r$/,""));result.push(row)}
 return result;
}
function parseImportedRows(rows:string[][]){
 const header=(rows.shift()||[]).map(x=>x.trim().toLowerCase().replace(/^\uFEFF/,"").replace(/\s+/g,"_"));
 const find=(names:string[])=>header.findIndex(x=>names.includes(x));
 const name=find(["nama","name"]),phone=find(["nomor","phone","whatsapp","no_wa","nomor_wa","no_whatsapp"]),
  tags=find(["label","tags","kategori"]),permission=find(["izin_promosi","consent","izin","persetujuan_promosi"]),
  evidence=find(["bukti_izin","consent_evidence","bukti_persetujuan","sumber_izin"]);
 if(name<0||phone<0)throw new Error("Kolom Excel wajib: nama dan nomor");
 const seen=new Set<string>();const contacts:ImportContact[]=[];const errors:string[]=[];
 let duplicates=0;
 for(const [index,r]of rows.entries()){
  if(!r.some(x=>x?.trim()))continue;
  try{
   const number=normalizePhone(r[phone]||"");
   const display=(r[name]||"").trim();
   if(!display||display.length>100)throw new Error("Nama harus 1–100 karakter");
   if(seen.has(number)){duplicates++;continue}
   seen.add(number);
   const optin=permission>=0&&["ya","yes","true","1","diizinkan","setuju"].includes((r[permission]||"").trim().toLowerCase());
   const proof=evidence>=0?(r[evidence]||"").trim():"";
   if(optin&&proof.length<12)throw new Error("Baris menyatakan izin promosi, tetapi bukti izin kurang dari 12 karakter");
   contacts.push({phone:number,name:display,tags:tags>=0?(r[tags]||"").trim().slice(0,500):"",
    consent:optin,consent_evidence:optin?proof.slice(0,500):""});
  }catch(e){errors.push("Baris "+(index+2)+": "+(e as Error).message)}
 }
 if(contacts.length>1000)throw new Error("Maksimal 1.000 nomor per kampanye");
 return {contacts,errors,duplicates};
}
export default function CampaignEditor({products,onDone,onClose}:{products:any[];onDone:(id:string)=>void;onClose:()=>void}){
 const [search,setSearch]=useState(""),[offset,setOffset]=useState(0),[recipientSource,setRecipientSource]=useState<"existing"|"excel">("existing");
 const {data,error:loadError,loading}=useCampaignData("?view=contacts&q="+encodeURIComponent(search)+"&offset="+offset);
 const [name,setName]=useState(""),[product,setProduct]=useState(""),[selected,setSelected]=useState<string[]>([]);
 const [excluded,setExcluded]=useState<string[]>([]),[imported,setImported]=useState<ImportContact[]>([]),[importNotice,setImportNotice]=useState("");
 const [steps,setSteps]=useState<CampaignStep[]>([{type:"TEXT",body:""}]);
 const [bot,setBot]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [videoNames,setVideoNames]=useState<Record<number,string>>({}),[videoPreviews,setVideoPreviews]=useState<Record<number,string>>({});
 const objectUrls=useRef<string[]>([]);
 useEffect(()=>()=>{for(const url of objectUrls.current)URL.revokeObjectURL(url)},[]);
 const known:KnownContact[]=data?.contacts||[];
 const knownPhones=new Set(known.filter(x=>x.phone).map(x=>x.phone));
 const excelRows=useMemo(()=>imported.filter(c=>(c.name+" "+c.phone+" "+c.tags).toLowerCase().includes(search.toLowerCase())),[imported,search]);
 const visible=recipientSource==="existing"?known:excelRows;
 const previewName=known.find(c=>selected.includes(c.phone||""))?.name||imported.find(c=>selected.includes(c.phone))?.name||"Pelanggan";
 const importedSelected=imported.filter(c=>selected.includes(c.phone));
 const locallyApproved=new Set([...known.filter(c=>c.consent&&!c.opted_out_at&&!c.exclusion).map(c=>c.phone),...imported.filter(c=>c.consent).map(c=>c.phone)]);
 const eligibleVisible=selected.filter(phone=>locallyApproved.has(phone)&&!excluded.includes(phone)).length;
 const edit=(i:number,patch:Partial<CampaignStep>)=>setSteps(xs=>xs.map((s,j)=>i===j?{...s,...patch}:s));
 function toggle(phone:string){
  setSelected(prev=>prev.includes(phone)?prev.filter(x=>x!==phone):prev.length>=1000?prev:[...prev,phone]);
 }
 function toggleExclude(phone:string){setExcluded(prev=>prev.includes(phone)?prev.filter(x=>x!==phone):[...prev,phone])}
 async function selectAll(){
  try{
   if(recipientSource==="excel"){
    const phones=excelRows.map(x=>x.phone);
    setSelected(prev=>Array.from(new Set([...prev,...phones])).slice(0,1000));
   }else{
    const d=await campaignRequest(undefined,"?view=selection_all&q="+encodeURIComponent(search));
    setSelected(prev=>Array.from(new Set([...prev,...(d.phones||[])])).slice(0,1000));
   }
   setError("");
  }catch(e){setError((e as Error).message)}
 }
 async function loadExcel(file?:File){
  if(!file)return;
  setBusy(true);setError("");setImportNotice("");
  try{
   if(file.size>5*1024*1024)throw new Error("Excel/CSV maksimal 5 MB");
   let rows:string[][];
   if(/\.xlsx$/i.test(file.name)){
    const {Workbook}=await import("exceljs");
    const wb=new Workbook();await wb.xlsx.load(await file.arrayBuffer());
    const ws=wb.worksheets[0];if(!ws)throw new Error("Tidak ada sheet dalam file");
    rows=[];ws.eachRow(row=>{
     const line:string[]=[];for(let i=1;i<=Math.min(row.cellCount,12);i++)line.push(String(row.getCell(i).text||""));
     rows.push(line);
    });
   }else if(/\.csv$/i.test(file.name))rows=csvRows(await file.text());
   else throw new Error("Pilih file .xlsx atau .csv");
   const parsed=parseImportedRows(rows);
   setImported(parsed.contacts);
   setRecipientSource("excel");
   setImportNotice(parsed.contacts.length+" kontak siap dipilih · "+parsed.duplicates+" nomor ganda · "+parsed.errors.length+" baris bermasalah.");
   if(parsed.errors.length)setError(parsed.errors.slice(0,5).join("; "));
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function template(){
  const {Workbook}=await import("exceljs");const wb=new Workbook();const sheet=wb.addWorksheet("Calon Penerima");
  sheet.addRow(["nama","nomor","label","izin_promosi","bukti_izin"]);
  sheet.addRow(["Contoh Pelanggan","081234567890","prospek","tidak",""]);
  sheet.columns=[{width:24},{width:22},{width:22},{width:19},{width:56}];
  sheet.getRow(1).font={bold:true};
  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([new Uint8Array(buf)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="template-penerima-kampanye.xlsx";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function upload(i:number,file?:File){
  if(!file)return;
  setError("");
  if(file.size<=0||file.size>25*1024*1024||(!/\.mp4$/i.test(file.name)&&file.type!=="video/mp4")){
   setError("Pilih video MP4 maksimal 25 MB");return;
  }
  setBusy(true);
  try{
   const r=await fetch("/api/campaigns/media",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({type:"video/mp4",size:file.size})});
   const d=await r.json();if(!r.ok)throw new Error(d.error||"Upload video gagal");
   const response=await fetch(d.signedUrl,{method:"PUT",
    headers:{"content-type":"video/mp4","x-upsert":"false"},body:file});
   if(!response.ok)throw new Error("Video gagal diunggah ke penyimpanan (HTTP "+response.status+")");
   const url=URL.createObjectURL(file);objectUrls.current.push(url);
   setVideoPreviews(prev=>({...prev,[i]:url}));setVideoNames(prev=>({...prev,[i]:file.name}));
   edit(i,{type:"VIDEO",media_url:d.path});setError("");
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function save(){
  setBusy(true);setError("");
  try{
   if(!name.trim()||!product)throw new Error("Isi nama kampanye dan produk");
   if(!selected.length)throw new Error("Pilih minimal satu nomor penerima");
   validateSteps(steps);
   const r=await campaignRequest({action:"create",campaign:{name:name.trim(),product_id:product,phones:selected,
    import_contacts:importedSelected,excluded_phones:excluded.filter(x=>selected.includes(x)),steps,bot_enabled:bot}});
   onDone(r.id);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <section className="card campaignEditor onePageCampaign">
  <div className="sectionTitle"><div><h2>Buat kampanye</h2>
   <p className="muted">Semua data dalam satu halaman · simpan draft dahulu, uji pengiriman sebelum memulai.</p>
  </div><button className="btn" type="button" onClick={onClose}>Tutup</button></div>
  <div className="oneCampaignGrid">
   <section className="oneCampaignBlock"><h3>1. Produk dan nama kampanye</h3>
    <div className="formGrid">
     <label className="fieldLabel">Nama kampanye<input className="input" maxLength={120} value={name}
      onChange={e=>setName(e.target.value)} placeholder="Contoh: Promosi Gajian Pro"/></label>
     <label className="fieldLabel">Produk<select className="input" value={product} onChange={e=>setProduct(e.target.value)}>
      <option value="">Pilih produk</option>{products.map(p=><option key={p.source_key} value={p.source_key}>
       {p.payload?.product_name||p.source_key}</option>)}
     </select></label>
    </div>
    <p className="muted">AI memakai katalog produk resmi. <Link href="/campaigns/intelligence">Kelola materi promosi →</Link></p>
   </section>
   <section className="oneCampaignBlock"><h3>2. Sumber penerima</h3>
    <div className="campaignSourceTabs">
     <button type="button" className={"btn "+(recipientSource==="existing"?"primary":"")}
      onClick={()=>setRecipientSource("existing")}>Kontak WhatsApp ({data?.total??0})</button>
     <button type="button" className={"btn "+(recipientSource==="excel"?"primary":"")}
      onClick={()=>setRecipientSource("excel")}>Impor Excel ({imported.length})</button>
    </div>
    {recipientSource==="excel"&&<div className="campaignImportPanel">
      <div className="sectionTitle"><div><b>Excel/CSV khusus kampanye</b>
       <p className="muted">Tidak langsung masuk Kontak Utama. Nomor baru akan muncul setelah pesan diterima gateway atau ada interaksi masuk.</p>
      </div><button className="btn" onClick={()=>void template()}>Template Excel</button></div>
      <label className="fieldLabel">Pilih file Excel atau CSV (.xlsx / .csv)
       <input className="input" type="file" accept=".xlsx,.csv" disabled={busy}
        onChange={e=>void loadExcel(e.target.files?.[0])}/></label>
      <p className="muted">Kolom: nama, nomor, label, izin_promosi, bukti_izin. Izin tanpa bukti tidak dianggap valid.</p>
      {importNotice&&<div className="notice">{importNotice}</div>}
    </div>}
    <div className="campaignToolbar section">
     <input className="input" aria-label="Cari penerima" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0)}}
      placeholder="Cari nama, nomor, label..."/>
     <button className="btn" type="button" onClick={()=>void selectAll()} disabled={busy}>Pilih semua yang tampil</button>
     <button className="btn" type="button" onClick={()=>{setSelected([]);setExcluded([])}}>Hapus pilihan</button>
    </div>
    <div className="campaignRecipientSummary">
     <span><b>{selected.length}</b> dipilih</span><span><b>{excluded.filter(x=>selected.includes(x)).length}</b> dikecualikan</span>
     <span><b>{eligibleVisible}</b> teridentifikasi berizin dalam data yang sedang dimuat</span>
    </div>
    <div className="recipientPicker campaignRecipientPicker">
     {visible.map((c:any)=>{
      const phone=c.phone as string|null;
      const valid=!!phone&&/^[1-9][0-9]{7,14}$/.test(phone);
      const opted=!!c.opted_out_at,blocked=!!c.exclusion;
      const permitted=!!c.consent&&!opted&&!blocked;
      const chosen=!!phone&&selected.includes(phone);
      const omit=!!phone&&excluded.includes(phone);
      return <div key={phone||c.chat_id} className={"campaignRecipient "+(omit?"excluded":"")}>
       <label className="campaignRecipientMain">
        <input type="checkbox" disabled={!valid} checked={chosen} onChange={()=>{if(phone)toggle(phone)}}/>
        <span className="campaignRecipientName"><b>{c.name||phone||"Kontak WhatsApp"}</b>
         <small>{phone?"+"+phone:"ID WhatsApp belum berisi nomor"}{c.tags?" · "+c.tags:""}</small></span>
       </label>
       <span className={"badge "+(permitted?"ok":"warn")}>
        {!valid?"ID belum valid":blocked?"Blokir owner":opted?"Berhenti promosi":permitted?"Izin tercatat":"Belum ada izin"}
       </span>
       <label className="campaignRecipientExclude" title="Lewati nomor ini untuk kampanye ini">
        <input type="checkbox" disabled={!valid} checked={omit} onChange={()=>{if(phone)toggleExclude(phone)}}/>
        <span>Lewati</span>
       </label>
      </div>;
     })}
     {!visible.length&&<div className="empty">{loading?"Memuat kontak…":recipientSource==="excel"?
      "Impor Excel untuk menyiapkan nomor baru.":"Tidak ada kontak yang cocok. Kontak berizin maupun yang belum berizin tetap dapat ditampilkan."}</div>}
    </div>
    {recipientSource==="existing"&&<div className="actions section">
     <button className="btn" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Sebelumnya</button>
     <span>Halaman {Math.floor(offset/50)+1}</span>
     <button className="btn" disabled={(data?.contacts?.length||0)<50} onClick={()=>setOffset(offset+50)}>Berikutnya</button>
    </div>}
    <div className="notice section">Kontak boleh dipilih sebagai draft, tetapi hanya yang memiliki izin promosi dan tidak diblokir yang dapat dikirimi kampanye. Pengecualian di sini hanya berlaku untuk kampanye ini. <Link href="/contacts">Kelola izin kontak</Link>.</div>
   </section>
   <section className="oneCampaignBlock"><h3>3. Pesan dan unggah video MP4</h3>
    <div className="campaignCompose">
     <div>{steps.map((step,i)=><div key={i} className="messageEditor">
      <div className="sectionTitle"><h3>Pesan {i+1}</h3>{i>0&&<button className="btn" onClick={()=>setSteps(xs=>xs.filter((_,j)=>j!==i))}>Hapus</button>}</div>
      <label className="fieldLabel">Jenis pesan<select className="input" value={step.type}
        onChange={e=>edit(i,{type:e.target.value as "TEXT"|"VIDEO"})}>
       <option value="TEXT">Teks WhatsApp</option><option value="VIDEO">Video MP4 dengan caption</option></select>
      </label>
      {step.type==="VIDEO"&&<div className="campaignVideoUploader">
       <label className="fieldLabel">Unggah MP4 dari laptop atau HP (maks. 25 MB)
        <input type="file" className="input" accept=".mp4,video/mp4" disabled={busy}
         onChange={e=>void upload(i,e.target.files?.[0])}/></label>
       {busy&&<small className="muted">Sedang memproses unggahan. Jangan tutup halaman.</small>}
       {videoPreviews[i]&&<video className="campaignVideoPreview" src={videoPreviews[i]} controls playsInline preload="metadata"/>}
       {step.media_url&&<div className="notice">Video siap: {videoNames[i]||"MP4 tersimpan"} · Disimpan privat di Supabase.</div>}
       <label className="fieldLabel">Atau URL video HTTPS
        <input className="input" value={step.media_url||""}
         onChange={e=>edit(i,{media_url:e.target.value})} placeholder="https://.../video.mp4"/></label>
      </div>}
      <label className="fieldLabel">{step.type==="VIDEO"?"Caption video":"Pesan teks"}
       <textarea className="input" rows={4} maxLength={4000} value={step.body}
        onChange={e=>edit(i,{body:e.target.value})} placeholder="Halo {{nama}}, ada solusi untuk..."/></label>
      <small className="muted">{step.body.length}/4.000 · Personalisasi dengan {"{{nama}}"}</small>
     </div>)}
     {steps.length<2&&<button className="btn" onClick={()=>setSteps(v=>[...v,{type:"TEXT",body:""}])}>+ Tambah pesan kedua</button>}
     </div>
     <aside className="messagePreview"><small>PRATINJAU UNTUK PELANGGAN</small><h3>{previewName}</h3>
      {steps.map((step,i)=><div className="previewBubble" key={i}>
       {step.type==="VIDEO"&&(videoPreviews[i]?<video src={videoPreviews[i]} className="campaignPreviewMiniVideo" controls playsInline preload="metadata"/>:
        <div className="videoPlaceholder">▶ Video MP4</div>)}
       <p>{step.body.replaceAll("{{nama}}",previewName)||"Isi pesan akan muncul di sini."}</p>
      </div>)}
     </aside>
    </div>
   </section>
   <section className="oneCampaignBlock"><h3>4. Bot dan pemeriksaan draft</h3>
    <label className="checkLine"><input type="checkbox" checked={bot} onChange={e=>setBot(e.target.checked)}/>
     <span><b>AI menangani balasan pelanggan</b><small>Kontrol AI per kontak dan aturan owner tetap berlaku.</small></span></label>
    <div className="campaignReview">
     <div><small>Produk</small><b>{products.find(p=>p.source_key===product)?.payload?.product_name||"Belum dipilih"}</b></div>
     <div><small>Penerima</small><b>{selected.length}</b></div>
     <div><small>Dilewati</small><b>{excluded.filter(x=>selected.includes(x)).length}</b></div>
     <div><small>Format</small><b>{steps.some(x=>x.type==="VIDEO")?"Video + teks":"Teks"}</b></div>
    </div>
    <div className="notice">Kampanye disimpan sebagai draft. Uji terlebih dahulu dan pastikan worker WAHA mendukung video. Pemeriksaan izin serta pengecualian dilakukan ulang sebelum pengiriman.</div>
   </section>
  </div>
  {(error||loadError)&&<div className="notice errorNotice section" role="alert">{error||loadError}</div>}
  <div className="actions section"><button className="btn primary" disabled={busy}
   onClick={()=>void save()}>{busy?"Memproses…":"Simpan draft kampanye"}</button>
   <button className="btn" onClick={onClose}>Batal</button></div>
 </section>;
}
