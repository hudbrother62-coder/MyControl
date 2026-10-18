"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {CampaignStep,campaignRequest,normalizePhone,validateSteps} from "@/lib/campaigns";
import {useCampaignData} from "./useCampaignData";
type ImportContact={phone:string;name:string;tags:string;consent:boolean;consent_evidence:string};
type KnownContact={phone:string|null;chat_id?:string;name:string;tags?:string;consent?:boolean;opted_out_at?:string|null;exclusion?:string|null};
type RecipientSource="existing"|"excel"|"manual";
type ManualRow={id:number;name:string;phone:string;tags:string;consent:boolean;consent_evidence:string};
const newManualRow=(id:number):ManualRow=>({id,name:"",phone:"",tags:"",consent:false,consent_evidence:""});
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
 if(contacts.length>1000)throw new Error("Maksimal 1.000 nomor per Blash");
 return {contacts,errors,duplicates};
}
export default function CampaignEditor({products,onDone,onClose,videoSupported,imageSupported}:{products:any[];onDone:(id:string)=>void;onClose:()=>void;videoSupported?:boolean;imageSupported?:boolean}){
 const [search,setSearch]=useState(""),[offset,setOffset]=useState(0),[recipientSource,setRecipientSource]=useState<RecipientSource>("existing");
 const {data,error:loadError,loading}=useCampaignData("?view=contacts&q="+encodeURIComponent(search)+"&offset="+offset);
 const [name,setName]=useState(""),[product,setProduct]=useState(""),[selected,setSelected]=useState<string[]>([]);
 const [excluded,setExcluded]=useState<string[]>([]),[imported,setImported]=useState<ImportContact[]>([]),[importNotice,setImportNotice]=useState("");
 const [manualRows,setManualRows]=useState<ManualRow[]>(()=>Array.from({length:5},(_,i)=>newManualRow(i)));
 const nextManualId=useRef(5);
 const [manualContacts,setManualContacts]=useState<ImportContact[]>([]);
 const [manualNotice,setManualNotice]=useState("");
 const [steps,setSteps]=useState<CampaignStep[]>([{type:"IMAGE",body:""}]);
 const [bot,setBot]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [mediaNames,setMediaNames]=useState<Record<number,string>>({}),[mediaPreviews,setMediaPreviews]=useState<Record<number,string>>({});
 const objectUrls=useRef<string[]>([]);
 const feedback=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(error){feedback.current?.scrollIntoView({block:"center",behavior:"smooth"});feedback.current?.focus({preventScroll:true})}},[error]);
 useEffect(()=>()=>{for(const url of objectUrls.current)URL.revokeObjectURL(url)},[]);
 const known:KnownContact[]=data?.contacts||[];
 const knownPhones=new Set(known.filter(x=>x.phone).map(x=>x.phone));
 const allImported=useMemo(()=>{
  const unique=new Map<string,ImportContact>();
  for(const contact of imported)unique.set(contact.phone,contact);
  for(const contact of manualContacts)unique.set(contact.phone,contact);
  return Array.from(unique.values());
 },[imported,manualContacts]);
 const excelRows=useMemo(()=>imported.filter(c=>(c.name+" "+c.phone+" "+c.tags).toLowerCase().includes(search.toLowerCase())),[imported,search]);
 const manualVisible=useMemo(()=>manualContacts.filter(c=>(c.name+" "+c.phone+" "+c.tags).toLowerCase().includes(search.toLowerCase())),[manualContacts,search]);
 const visible=recipientSource==="existing"?known:recipientSource==="excel"?excelRows:manualVisible;
 const previewName=known.find(c=>selected.includes(c.phone||""))?.name||allImported.find(c=>selected.includes(c.phone))?.name||"Pelanggan";
 const importedSelected=allImported.filter(c=>selected.includes(c.phone));
 const blockedKnown=new Set(known.filter(c=>c.opted_out_at||c.exclusion).map(c=>c.phone));
 const pendingManual=manualRows.flatMap(row=>{try{if(!row.name.trim()||!row.phone.trim())return [];return [{phone:normalizePhone(row.phone),consent:row.consent&&row.consent_evidence.trim().length>=12}]}catch{return []}});
 const preparedPhones=Array.from(new Set([...selected,...pendingManual.map(row=>row.phone)]));
 const locallyApproved=new Set([...known.filter(c=>c.consent&&!c.opted_out_at&&!c.exclusion).map(c=>c.phone),...allImported.filter(c=>c.consent).map(c=>c.phone)].filter(phone=>!blockedKnown.has(phone)));
 const eligibleVisible=selected.filter(phone=>locallyApproved.has(phone)&&!excluded.includes(phone)).length;
 const preparedEligible=preparedPhones.filter(phone=>!blockedKnown.has(phone)&&!excluded.includes(phone)&&(locallyApproved.has(phone)||pendingManual.some(row=>row.phone===phone&&row.consent))).length;
 const displayContact=(phone:string)=>known.find(c=>c.phone===phone)?.name||allImported.find(c=>c.phone===phone)?.name||("+"+phone);
 const edit=(i:number,patch:Partial<CampaignStep>)=>setSteps(xs=>xs.map((s,j)=>i===j?{...s,...patch}:s));
 function toggle(phone:string){
  setSelected(prev=>prev.includes(phone)?prev.filter(x=>x!==phone):prev.length>=1000?prev:[...prev,phone]);
 }
 function toggleExclude(phone:string){setExcluded(prev=>prev.includes(phone)?prev.filter(x=>x!==phone):[...prev,phone])}
 async function selectAll(){
  try{
   if(recipientSource!=="existing"){
    const phones=(recipientSource==="excel"?excelRows:manualVisible).map(x=>x.phone);
    setSelected(prev=>Array.from(new Set([...prev,...phones])).slice(0,1000));
   }else{
    const d=await campaignRequest(undefined,"?view=selection_all&q="+encodeURIComponent(search));
    setSelected(prev=>Array.from(new Set([...prev,...(d.phones||[])])).slice(0,1000));
   }
   setError("");
  }catch(e){setError((e as Error).message)}
 }
 function editManual(id:number,field:keyof Omit<ManualRow,"id">,value:string|boolean){
  setManualRows(rows=>rows.map(row=>row.id===id?{...row,[field]:value}:row));
  setManualNotice("");
 }
 function addManualRows(){
  setManualRows(rows=>rows.length>=1000?rows:[...rows,...Array.from({length:Math.min(5,1000-rows.length)},()=>newManualRow(nextManualId.current++))]);
 }
 function readManualRows(){
  const contacts:ImportContact[]=[];
  const seen=new Set<string>();
  for(const [index,row] of manualRows.entries()){
   if(!row.name.trim()&&!row.phone.trim()&&!row.tags.trim()&&!row.consent&&!row.consent_evidence.trim())continue;
   const name=row.name.trim();
   if(!name||name.length>100)throw new Error("Kontak manual baris "+(index+1)+": nama wajib 1–100 karakter");
   let phone:string;
   try{phone=normalizePhone(row.phone)}catch{throw new Error("Kontak manual baris "+(index+1)+": nomor WhatsApp tidak valid")}
   if(seen.has(phone))throw new Error("Kontak manual baris "+(index+1)+": nomor ganda dalam tabel");
   seen.add(phone);
   const proof=row.consent_evidence.trim();
   if(row.consent&&proof.length<12)throw new Error("Kontak manual baris "+(index+1)+": isi bukti izin promosi minimal 12 karakter, atau matikan pilihan izin");
   contacts.push({phone,name,tags:row.tags.trim().slice(0,500),consent:row.consent,consent_evidence:row.consent?proof.slice(0,500):""});
  }
  return contacts;
 }
 function prepareManual(){
  setError("");setManualNotice("");
  try{
   const result=readManualRows();
   if(!result.length)throw new Error("Isi setidaknya satu kontak manual");
   const merged=new Map(manualContacts.map(c=>[c.phone,c]));
   for(const c of result)merged.set(c.phone,c);
   if(merged.size>1000)throw new Error("Maksimal 1.000 kontak manual per Blash");
   const nextSelection=Array.from(new Set([...selected,...result.map(c=>c.phone)]));
   if(nextSelection.length>1000)throw new Error("Maksimal 1.000 penerima per Blash. Hapus beberapa pilihan terlebih dahulu.");
   setManualContacts(Array.from(merged.values()));
   setSelected(nextSelection);
   setManualNotice(result.length+" kontak siap dan dipilih. Saat menyimpan draft, kontak ini juga ikut tersimpan.");
   setManualRows(Array.from({length:5},()=>newManualRow(nextManualId.current++)));
  }catch(e){setError((e as Error).message);setRecipientSource("manual")}
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
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="template-penerima-Blash.xlsx";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function upload(i:number,file?:File){
  if(!file)return;
  setError("");
  const type=steps[i]?.type;
  if(type!=="IMAGE"&&type!=="VIDEO"){setError("Pilih jenis media terlebih dahulu.");return}
  const ext=file.name.split(".").pop()?.toLowerCase()||"";
  const mimes:Record<string,string>={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",mp4:"video/mp4"};
  const mime=mimes[ext];
  const max=type==="VIDEO"?25*1024*1024:8*1024*1024;
  if(!mime||(type==="IMAGE"&&!mime.startsWith("image/"))||(type==="VIDEO"&&mime!=="video/mp4")||
    (file.type&&file.type!==mime)||file.size<=0||file.size>max){
   setError(type==="IMAGE"?"Gunakan poster JPG/PNG/WebP maksimal 8 MB.":"Gunakan video MP4 maksimal 25 MB.");return;
  }
  setBusy(true);
  try{
   const r=await fetch("/api/campaigns/media",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({type:mime,size:file.size})});
   const d=await r.json();if(!r.ok)throw new Error(d.error||"Gagal menyiapkan unggahan media");
   const response=await fetch(d.signedUrl,{method:"PUT",headers:{"content-type":mime,"x-upsert":"false"},body:file});
   if(!response.ok)throw new Error("Gagal menyimpan media privat (HTTP "+response.status+"). Coba file lebih kecil.");
   const url=URL.createObjectURL(file);objectUrls.current.push(url);
   setMediaPreviews(prev=>({...prev,[i]:url}));setMediaNames(prev=>({...prev,[i]:file.name}));
   edit(i,{type,media_url:d.path});setError("");
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function save(){
  if(busy)return;
  setBusy(true);setError("");
  try{
   if(!product)throw new Error("Pilih produk di bagian 1 terlebih dahulu.");
   // Read unsaved manual rows as part of Save: users need not click a separate Add button.
   const pending=readManualRows();
   const selectedPhones=Array.from(new Set([...selected,...pending.map(c=>c.phone)]));
   if(!selectedPhones.length)throw new Error("Tambahkan kontak manual atau pilih minimal satu penerima");
   if(selectedPhones.length>1000)throw new Error("Maksimal 1.000 penerima per Blash");
   const imports=new Map(allImported.map(c=>[c.phone,c]));
   for(const c of pending)imports.set(c.phone,c);
   const included=Array.from(imports.values()).filter(c=>selectedPhones.includes(c.phone));
   if(included.length>1000)throw new Error("Maksimal 1.000 kontak baru per Blash");
   validateSteps(steps);
   const campaignName=name.trim()||("Promosi "+(products.find(p=>p.source_key===product)?.payload?.product_name||product)).slice(0,120);
   const r=await campaignRequest({action:"create",campaign:{name:campaignName,product_id:product,phones:selectedPhones,
    import_contacts:included,excluded_phones:excluded.filter(x=>selectedPhones.includes(x)),steps,bot_enabled:bot}});
   onDone(r.id);
  }catch(e){setError((e as Error).message);if((e as Error).message.includes("Kontak manual"))setRecipientSource("manual")}
  finally{setBusy(false)}
 }
 return <section className="card campaignEditor onePageCampaign">
  <div className="sectionTitle"><div><h2>Buat Blash</h2>
   <p className="muted">Isi di sini → simpan → coba ke nomor sendiri → kirim atau jadwalkan.</p>
  </div><button className="btn" type="button" onClick={onClose}>Tutup</button></div>
  <nav className="blashJumpLinks" aria-label="Bagian pengisian Blash">
   <a href="#blash-product">1. Produk</a><a href="#blash-recipients">2. Penerima</a>
   <a href="#blash-message">3. Isi pesan</a><a href="#blash-review">4. Simpan</a>
  </nav>
  <div className="oneCampaignGrid">
   <section id="blash-product" className="oneCampaignBlock"><h3>1. Pilih produk</h3>
    <div className="formGrid">
     <label className="fieldLabel">Nama Blash (opsional)<input className="input" maxLength={120} value={name}
      onChange={e=>setName(e.target.value)} placeholder="Otomatis mengikuti produk"/></label>
     <label className="fieldLabel">Produk<select className="input" value={product} onChange={e=>setProduct(e.target.value)}>
      <option value="">Pilih produk</option>{products.map(p=><option key={p.source_key} value={p.source_key}>
       {p.payload?.product_name||p.source_key}</option>)}
     </select></label>
    </div>
    <details className="blashExtra"><summary>Atur pengetahuan produk untuk AI</summary><Link href="/campaigns/intelligence">Buka materi promosi →</Link></details>
   </section>
   <section id="blash-recipients" className="oneCampaignBlock"><h3>2. Pilih penerima</h3>
    <div className="campaignSourceHeader">
     <div className="campaignSourceTabs" role="group" aria-label="Sumber penerima">
      <button type="button" aria-pressed={recipientSource==="existing"} className={"btn "+(recipientSource==="existing"?"primary":"")}
       onClick={()=>setRecipientSource("existing")}>Kontak tersimpan ({data?.total??0})</button>
      <button type="button" aria-pressed={recipientSource==="excel"} className={"btn "+(recipientSource==="excel"?"primary":"")}
       onClick={()=>setRecipientSource("excel")}>Dari Excel ({imported.length})</button>
      <button type="button" aria-pressed={recipientSource==="manual"} className={"btn "+(recipientSource==="manual"?"primary":"")}
       onClick={()=>setRecipientSource("manual")}>Ketik nomor ({manualContacts.length})</button>
     </div>
     <Link className="btn campaignManageContact" href="/contacts">Menu kontak →</Link>
    </div>
    {recipientSource==="excel"&&<div className="campaignImportPanel">
      <div className="sectionTitle"><div><b>Excel/CSV khusus Blash</b>
       <p className="muted">Tidak langsung masuk Kontak Utama. Nomor baru akan muncul setelah pesan diterima gateway atau ada interaksi masuk.</p>
      </div><button className="btn" onClick={()=>void template()}>Template Excel</button></div>
      <label className="fieldLabel">Pilih file Excel atau CSV (.xlsx / .csv)
       <input className="input" type="file" accept=".xlsx,.csv" disabled={busy}
        onChange={e=>void loadExcel(e.target.files?.[0])}/></label>
      <p className="muted">Kolom: nama, nomor, label, izin_promosi, bukti_izin. Izin tanpa bukti tidak dianggap valid.</p>
      {importNotice&&<div className="notice">{importNotice}</div>}
    </div>}
    {recipientSource==="manual"&&<div className="campaignImportPanel campaignManualPanel">
     <div className="campaignManualHeading"><div><b>Tambah kontak manual</b>
      <p className="muted">Isi nama dan nomor. Baris terisi otomatis tersimpan bersama Blash.</p></div>
      <span className="badge">{manualRows.length} baris</span></div>
     <div className="campaignManualRows">
      {manualRows.map((row,index)=><div className="campaignManualRow" key={row.id}>
       <span className="campaignManualIndex">#{index+1}</span>
       <label className="fieldLabel campaignManualName">Nama
        <input className="input" value={row.name} maxLength={100} placeholder="Nama pelanggan" onChange={e=>editManual(row.id,"name",e.target.value)}/></label>
       <label className="fieldLabel campaignManualPhone">Nomor WhatsApp
        <input className="input" type="tel" inputMode="tel" value={row.phone} placeholder="08xxxxxxxxxx" onChange={e=>editManual(row.id,"phone",e.target.value)}/></label>
       <label className="fieldLabel campaignManualTags">Label
        <input className="input" value={row.tags} maxLength={500} placeholder="Prospek" onChange={e=>editManual(row.id,"tags",e.target.value)}/></label>
       <label className="campaignManualConsent"><input type="checkbox" checked={row.consent}
        onChange={e=>editManual(row.id,"consent",e.target.checked)}/> Izin promosi</label>
       {row.consent&&<label className="fieldLabel campaignManualProof">Bukti izin
        <input className="input" maxLength={500} value={row.consent_evidence}
         placeholder="Contoh: persetujuan formulir pelanggan, tanggal..."
         onChange={e=>editManual(row.id,"consent_evidence",e.target.value)}/></label>}
       <button className="btn campaignManualRemove" type="button" aria-label={"Hapus baris "+(index+1)}
        disabled={manualRows.length===1}
        onClick={()=>setManualRows(rows=>rows.filter(x=>x.id!==row.id))}>Hapus</button>
      </div>)}
     </div>
     <div className="campaignManualActions">
      <button className="btn" type="button" disabled={manualRows.length>=1000} onClick={addManualRows}>+ 5 baris</button>
      <button className="btn primary" type="button" onClick={prepareManual}>Tambahkan ke daftar</button>
     </div>
     {manualNotice&&<div className="notice" role="status">{manualNotice}</div>}
     {error&&<div className="notice errorNotice" role="alert">{error}</div>}
     <p className="muted">Centang izin promosi jika pelanggan sudah setuju, lalu tulis sumber izinnya.</p>
    </div>}
    <div className="campaignToolbar campaignRecipientToolbar section">
     <input className="input" aria-label="Cari penerima" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0)}}
      placeholder="Cari nama, nomor, label..."/>
     <button className="btn" type="button" onClick={()=>void selectAll()} disabled={busy}>Pilih semua yang cocok</button>
     <button className="btn" type="button" onClick={()=>{setSelected([]);setExcluded([])}}>Hapus pilihan</button>
    </div>
    <div className="campaignRecipientSummary">
     <span><b>{selected.length}</b> dipilih</span><span><b>{excluded.filter(x=>selected.includes(x)).length}</b> dikecualikan</span>
     <span><b>{eligibleVisible}</b> berizin</span>
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
       <label className="campaignRecipientExclude" title="Lewati nomor ini untuk Blash ini">
        <input type="checkbox" disabled={!valid} checked={omit} onChange={()=>{if(phone)toggleExclude(phone)}}/>
        <span>Lewati</span>
       </label>
      </div>;
     })}
     {!visible.length&&<div className="empty">{recipientSource==="existing"&&loading?"Memuat kontak…":recipientSource==="excel"?
      "Impor Excel untuk menyiapkan nomor baru.":recipientSource==="manual"?
      "Isi kontak manual lalu simpan draft. Baris manual ikut otomatis.":"Tidak ada kontak yang cocok. Kontak berizin maupun yang belum berizin tetap dapat ditampilkan."}</div>}
    </div>
    {recipientSource==="existing"&&<div className="actions section campaignRecipientPagination">
     <button className="btn" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Sebelumnya</button>
     <span>Halaman {Math.floor(offset/50)+1}</span>
     <button className="btn" disabled={(data?.contacts?.length||0)<50} onClick={()=>setOffset(offset+50)}>Berikutnya</button>
    </div>}
    {selected.length>0&&<details className="campaignSelectedDetails">
     <summary>Kontak terpilih ({selected.length}) · lihat dan kelola</summary>
     <div className="campaignSelectedList">
      {selected.slice(0,100).map(phone=><div className="campaignSelectedItem" key={phone}>
       <span><b>{displayContact(phone)}</b><small>+{phone}</small></span>
       <label className="campaignRecipientExclude"><input type="checkbox" checked={excluded.includes(phone)}
        onChange={()=>toggleExclude(phone)}/> Lewati</label>
       <button type="button" className="btn" onClick={()=>{setSelected(xs=>xs.filter(x=>x!==phone));setExcluded(xs=>xs.filter(x=>x!==phone))}}>Hapus</button>
      </div>)}
      {selected.length>100&&<p className="muted">Ditampilkan 100 dari {selected.length} kontak. Gunakan pencarian dan pilihan untuk mengelola seluruh daftar.</p>}
     </div>
    </details>}
    <details className="blashExtra"><summary>Tentang izin dan kontak yang dilewati</summary><p>Hanya kontak berizin yang akan dikirimi. Pilihan Lewati berlaku untuk Blash ini saja. <Link href="/contacts">Kelola izin kontak →</Link></p></details>
   </section>
   <section id="blash-message" className="oneCampaignBlock"><h3>3. Apa yang ingin dikirim?</h3><p className="muted">Pilih poster, teks, atau video. Link YouTube cukup ditempel di kolom pesan.</p>
    <div className="campaignCompose">
     <div>{steps.map((step,i)=><div key={i} className="messageEditor">
      <div className="sectionTitle"><h3>Pesan {i+1}</h3>{i>0&&<button className="btn" onClick={()=>setSteps(xs=>xs.filter((_,j)=>j!==i))}>Hapus</button>}</div>
      <div className="blashFormats" role="group" aria-label={"Jenis pesan "+(i+1)}>
       {([['IMAGE','Poster / gambar','JPG, PNG, WebP'],['TEXT','Teks / link YouTube','Tulis atau tempel link'],['VIDEO','Video MP4','Unggah berkas video']] as const).map(([type,label,hint])=>
        <button key={type} type="button" className={"btn blashFormat "+(step.type===type?"primary":"")} aria-pressed={step.type===type}
         onClick={()=>{if(type===step.type)return;edit(i,{type,media_url:""});setMediaNames(prev=>{const next={...prev};delete next[i];return next});setMediaPreviews(prev=>{const next={...prev};delete next[i];return next})}}>
         <b>{label}</b><small>{hint}</small></button>)}
      </div>
      {(step.type==="IMAGE"||step.type==="VIDEO")&&<div className="campaignVideoUploader">
       {step.type==="VIDEO"&&!videoSupported&&<div className="notice">Coba video ke nomor sendiri dahulu sebelum mengirim ke pelanggan.</div>}
       {step.type==="IMAGE"&&!imageSupported&&<div className="notice">Sambungan pengirim gambar belum siap. Kamu tetap bisa menyimpan draft. <Link href="/integrations">Periksa koneksi →</Link></div>}
       <label className="fieldLabel">{step.type==="IMAGE"?"Pilih poster (JPG/PNG/WebP · maks. 8 MB)":"Pilih video MP4 (maks. 25 MB)"}
        <input type="file" className="input" accept={step.type==="IMAGE"?"image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp":".mp4,video/mp4"} disabled={busy}
         onChange={e=>void upload(i,e.target.files?.[0])}/></label>
       {busy&&<small className="muted">Sedang mengunggah media…</small>}
       {mediaPreviews[i]&&(step.type==="IMAGE"?<img className="campaignPosterPreview" src={mediaPreviews[i]} alt="Pratinjau poster"/>:
        <video className="campaignVideoPreview" src={mediaPreviews[i]} controls playsInline preload="metadata"/>)}
       {step.media_url&&<div className="notice" role="status">✓ Siap dikirim: {mediaNames[i]||"Media dari tautan"}</div>}
       <details className="blashExtra"><summary>Gunakan tautan file sebagai gantinya</summary>
       <label className="fieldLabel">Atau URL {step.type==="IMAGE"?"gambar langsung (.jpg/.png/.webp)":"video HTTPS"}
        <input className="input" value={step.media_url||""}
         onChange={e=>{edit(i,{media_url:e.target.value});setMediaPreviews(prev=>{const next={...prev};delete next[i];return next})}}
         placeholder={step.type==="IMAGE"?"https://domain.com/poster.jpg":"https://domain.com/video.mp4"}/></label>
       {step.type==="IMAGE"&&<small className="muted">Dari Google Drive? Unduh gambarnya, lalu pilih file di atas.</small>}
       </details>
      </div>}
      <label className="fieldLabel">{step.type==="IMAGE"?"Pesan di bawah poster (opsional)":step.type==="VIDEO"?"Pesan di bawah video":"Pesan atau link YouTube"}
       <textarea className="input" rows={4} maxLength={4000} value={step.body}
        onChange={e=>edit(i,{body:e.target.value})} placeholder="Halo {{nama}}, ini penawaran kami.\nLink YouTube juga boleh ditambahkan di sini."/></label>
      <small className="muted">{step.body.length}/4.000 · Personalisasi dengan {"{{nama}}"}</small>
     </div>)}
     {steps.length<2&&<button className="btn" onClick={()=>setSteps(v=>[...v,{type:"TEXT",body:""}])}>+ Tambah pesan kedua</button>}
     </div>
     <aside className="messagePreview"><small>PRATINJAU UNTUK PELANGGAN</small><h3>{previewName}</h3>
      {steps.map((step,i)=><div className="previewBubble" key={i}>
       {step.type==="VIDEO"&&(mediaPreviews[i]?<video src={mediaPreviews[i]} className="campaignPreviewMiniVideo" controls playsInline preload="metadata"/>:
        <div className="videoPlaceholder">▶ Video MP4</div>)}
       {step.type==="IMAGE"&&(mediaPreviews[i]?<img src={mediaPreviews[i]} className="campaignPosterPreview" alt="Pratinjau gambar penerima"/>:
        <div className="videoPlaceholder">▧ Poster JPG / PNG</div>)}
       <p>{step.body.replaceAll("{{nama}}",previewName)||"Isi pesan akan muncul di sini."}</p>
      </div>)}
     </aside>
    </div>
   </section>
   <section id="blash-review" className="oneCampaignBlock"><h3>4. Periksa dan simpan</h3>
    <label className="checkLine"><input type="checkbox" checked={bot} onChange={e=>setBot(e.target.checked)}/>
     <span><b>AI membantu membalas pelanggan</b><small>Aktif setelah pelanggan membalas pesanmu.</small></span></label>
    <div className="campaignReview">
     <div><small>Produk</small><b>{products.find(p=>p.source_key===product)?.payload?.product_name||"Belum dipilih"}</b></div>
     <div><small>Penerima disiapkan</small><b>{preparedPhones.length}</b></div>
     <div><small>Kontak berizin saat ini</small><b>{preparedEligible}</b></div>
     <div><small>Format</small><b>{steps.some(x=>x.type==="IMAGE")?"Poster/gambar":steps.some(x=>x.type==="VIDEO")?"Video + teks":"Teks"}</b></div>
    </div>
    <p className="muted">Setelah disimpan, coba kirim ke nomor sendiri. Pelanggan belum menerima pesan sampai kamu memilih Kirim atau Jadwalkan.</p>
   </section>
  </div>
  <div ref={feedback} tabIndex={-1}>{(error||loadError)&&<div className="notice errorNotice section" role="alert">{error||loadError}</div>}</div>
  <div className="actions section"><button className="btn primary" disabled={busy}
   onClick={()=>void save()}>{busy?"Memproses…":"Simpan & lanjut uji"}</button>
   <button className="btn" onClick={onClose}>Batal</button></div>
 </section>;
}
