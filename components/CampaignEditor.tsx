"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {BlastSender} from "./WhatsAppSessions";
import {CampaignStep,campaignRequest,normalizePhone,validateSteps,renderPersonalizedMessage} from "@/lib/campaigns";
import {useCampaignData} from "./useCampaignData";
import {readBlashFileLocally} from "@/lib/blash-local-import";
type ImportContact={phone:string;name:string;tags:string;consent:boolean;consent_evidence:string};
type KnownContact={phone:string|null;chat_id?:string;name:string;tags?:string;consent?:boolean;opted_out_at?:string|null;exclusion?:string|null};
type RecipientSource="paste"|"existing"|"excel"|"manual";
type ManualRow={id:number;name:string;phone:string;tags:string;consent:boolean;consent_evidence:string};
const newManualRow=(id:number):ManualRow=>({id,name:"",phone:"",tags:"",consent:false,consent_evidence:""});
function parsePastedNumbers(raw:string){
 const contacts:ImportContact[]=[];const errors:string[]=[];const seen=new Set<string>();let duplicates=0;
 const rows=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).flatMap(line=>{
  if(/^(?:nama|name)[,;\t ]+(?:nomor|phone|whatsapp|no_wa)$/i.test(line))return [];
  const parts=line.split(/[,;\t]+/).map(x=>x.trim()).filter(Boolean);
  if(parts.length>1&&parts.every(x=>{try{normalizePhone(x);return true}catch{return false}}))return parts;
  const words=line.split(/\s+/).filter(Boolean);
  if(words.length>1&&words.every(x=>{try{normalizePhone(x);return true}catch{return false}}))return words;
  return [line];
 });
 for(const [index,row] of rows.entries()){
  const match=row.match(/(?:\+?62|0|8)[0-9 ().-]{7,22}/g)?.at(-1);
  if(!match){errors.push("Baris "+(index+1)+": nomor tidak ditemukan");continue}
  try{
   const phone=normalizePhone(match.trim());
   if(seen.has(phone)){duplicates++;continue}
   seen.add(phone);
   const name=row.replace(match,"").replace(/^[\s,;|:\t-]+|[\s,;|:\t-]+$/g,"").trim().slice(0,100)||("Pelanggan "+phone.slice(-4));
   contacts.push({phone,name,tags:"",consent:false,consent_evidence:""});
   if(contacts.length===1001)errors.push("Daftar melewati batas 1.000. Tidak ada nomor yang dihapus diam-diam; pecah daftar menjadi beberapa Blash.");
  }catch(e){
   if((e as Error).message.includes("Maksimal"))throw e;
   errors.push("Baris "+(index+1)+": "+(e as Error).message);
  }
 }
 return {contacts,errors,duplicates};
}
export default function CampaignEditor({products,onDone,onClose,videoSupported,imageSupported}:{products:any[];onDone:(id:string)=>void;onClose:()=>void;videoSupported?:boolean;imageSupported?:boolean}){
 const [senderSession,setSenderSession]=useState("");
 const [search,setSearch]=useState(""),[offset,setOffset]=useState(0),[recipientSource,setRecipientSource]=useState<RecipientSource>("paste");
 const {data,error:loadError,loading}=useCampaignData("?view=contacts&q="+encodeURIComponent(search)+"&offset="+offset);
 const [name,setName]=useState(""),[product,setProduct]=useState(()=>products.find(p=>p.source_key==="SP001")?.source_key||products[0]?.source_key||""),[selected,setSelected]=useState<string[]>([]);
 const [excluded,setExcluded]=useState<string[]>([]),[imported,setImported]=useState<ImportContact[]>([]),[importNotice,setImportNotice]=useState(""),[importSkipped,setImportSkipped]=useState(0);
 const [manualRows,setManualRows]=useState<ManualRow[]>(()=>Array.from({length:5},(_,i)=>newManualRow(i)));
 const nextManualId=useRef(5);
 const [manualContacts,setManualContacts]=useState<ImportContact[]>([]);
 const [manualNotice,setManualNotice]=useState("");
 const [pasted,setPasted]=useState("");const pastedResult=useMemo(()=>parsePastedNumbers(pasted),[pasted]);
 const [savedDraft,setSavedDraft]=useState("");
 const [listConsentConfirmed,setListConsentConfirmed]=useState(false);
 const [consentSource,setConsentSource]=useState("");

 const [steps,setSteps]=useState<CampaignStep[]>([{type:"TEXT",body:""}]);
 useEffect(()=>{setSavedDraft("");},[pasted,imported,selected,excluded,steps,product,name,manualRows,listConsentConfirmed,consentSource]);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const [mediaNames,setMediaNames]=useState<Record<number,string>>({}),[mediaPreviews,setMediaPreviews]=useState<Record<number,string>>({});
 const objectUrls=useRef<string[]>([]);
 const feedback=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(error){feedback.current?.scrollIntoView({block:"center",behavior:"smooth"});feedback.current?.focus({preventScroll:true})}},[error]);
 useEffect(()=>()=>{for(const url of objectUrls.current)URL.revokeObjectURL(url)},[]);
 const known:KnownContact[]=data?.contacts||[];
 const knownPhones=new Set(known.filter(x=>x.phone).map(x=>x.phone));
 const allImported=useMemo(()=>{
  const unique=new Map<string,ImportContact>();
  for(const contact of pastedResult.contacts)unique.set(contact.phone,contact);
  for(const contact of imported)unique.set(contact.phone,contact);
  for(const contact of manualContacts)unique.set(contact.phone,contact);
  return Array.from(unique.values());
 },[imported,manualContacts,pastedResult]);
 const excelRows=useMemo(()=>imported.filter(c=>(c.name+" "+c.phone+" "+c.tags).toLowerCase().includes(search.toLowerCase())),[imported,search]);
 const manualVisible=useMemo(()=>manualContacts.filter(c=>(c.name+" "+c.phone+" "+c.tags).toLowerCase().includes(search.toLowerCase())),[manualContacts,search]);
 const visible=recipientSource==="existing"?known:recipientSource==="excel"?excelRows:manualVisible;
 const previewName=allImported.find(c=>selected.includes(c.phone))?.name||known.find(c=>selected.includes(c.phone||""))?.name||"Bapak/Ibu";
 const importedSelected=allImported.filter(c=>selected.includes(c.phone));
 const blockedKnown=new Set(known.filter(c=>c.opted_out_at||c.exclusion).map(c=>c.phone));
 const pendingManual=manualRows.flatMap(row=>{try{if(!row.name.trim()||!row.phone.trim())return [];return [{phone:normalizePhone(row.phone),consent:false}]}catch{return []}});
 const preparedPhones=Array.from(new Set([...selected,...pendingManual.map(row=>row.phone),...pastedResult.contacts.map(c=>c.phone)]));
 const locallyApproved=new Set([...known.map(c=>c.phone),...allImported.map(c=>c.phone)].filter((phone):phone is string=>!!phone&&!blockedKnown.has(phone)));
 const eligibleVisible=selected.filter(phone=>!blockedKnown.has(phone)&&!excluded.includes(phone)&&locallyApproved.has(phone)).length;
 const documentedPhones=new Set([
   ...known.filter(c=>c.consent===true&&!!c.phone).map(c=>c.phone as string),
   ...allImported.filter(c=>c.consent&&c.consent_evidence.trim().length>=12).map(c=>c.phone),
 ]);
 const listConfirmed=listConsentConfirmed&&consentSource.trim().length>=12;
 const readyPreview=preparedPhones.filter(phone=>!blockedKnown.has(phone)&&!excluded.includes(phone)&&
   (documentedPhones.has(phone)||listConfirmed)).length;
 const preparedEligible=preparedPhones.filter(phone=>!blockedKnown.has(phone)&&!excluded.includes(phone)&&(locallyApproved.has(phone)||pendingManual.some(row=>row.phone===phone))).length;
 const displayContact=(phone:string)=>allImported.find(c=>c.phone===phone)?.name||known.find(c=>c.phone===phone)?.name||("+"+phone);
 const edit=(i:number,patch:Partial<CampaignStep>)=>setSteps(xs=>xs.map((s,j)=>i===j?{...s,...patch}:s));
 function toggle(phone:string){
  if(!selected.includes(phone)&&selected.length>=1000){setError("Maksimal 1.000 penerima per kampanye. Buat kampanye berikutnya untuk nomor tambahan.");return}
  setSelected(prev=>prev.includes(phone)?prev.filter(x=>x!==phone):[...prev,phone]);
 }
 function toggleExclude(phone:string){setExcluded(prev=>prev.includes(phone)?prev.filter(x=>x!==phone):[...prev,phone])}
 async function selectAll(){
  try{
   const phones=recipientSource!=="existing"?
    (recipientSource==="excel"?excelRows:manualVisible).map(x=>x.phone):
    (await campaignRequest(undefined,"?view=selection_all&q="+encodeURIComponent(search))).phones||[];
   const combined=Array.from(new Set<string>([...selected,...phones]));
   if(combined.length>1000)throw new Error("Ada "+combined.length+" penerima. Maksimal 1.000 per kampanye; pilihan tidak dipotong.");
   setSelected(combined);
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
   // Pengirim tidak meminta bukti izin individual; status opt-out tetap dijaga server.
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
   setBusy(true);setError("");setImportNotice("");setImportSkipped(0);
   try{
    if(file.size>4*1024*1024)throw new Error("File Excel/CSV maksimal 4 MB");
    if(!/\.(xlsx|csv)$/i.test(file.name))throw new Error("Pilih file .xlsx atau .csv, bukan ZIP. Ekstrak ZIP dahulu jika diperlukan.");
    const body=new FormData();
    body.append("file",file,file.name);
    let parsed:any;
    let browserFallback=false;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
     const response=await fetch("/api/campaigns/import",{
      method:"POST",body,credentials:"same-origin",cache:"no-store",signal:controller.signal,
     });
     if(response.status>=500)throw new TypeError("Layanan impor sementara tidak terhubung");
     const result=await response.json().catch(()=>{throw new TypeError("Respons API impor tidak dapat dibaca")});
     if(!response.ok||result.ok===false)
      throw new Error(result.error||"File tidak dapat diimpor (HTTP "+response.status+").");
     parsed=result;
    }catch(networkError){
     const recoverable=networkError instanceof TypeError ||
       (networkError instanceof Error&&networkError.name==="AbortError");
     if(!recoverable)throw networkError;
     // Parse locally when Android/browser POST fails, without uploading any
     // contacts or bypassing the existing campaign authorization on save.
     try{parsed=await readBlashFileLocally(file);browserFallback=true;}
     catch(localError){throw new Error("Gagal membaca file: "+(localError as Error).message)}
    }finally{clearTimeout(timer)}
    const incoming=parsed.contacts as ImportContact[];
    if(!Array.isArray(incoming)||incoming.length===0)
     throw new Error("Tidak ditemukan nomor WhatsApp valid dalam Excel.");
    const combined=Array.from(new Set([
     ...selected.filter(phone=>!imported.some(contact=>contact.phone===phone)),
     ...incoming.map(contact=>contact.phone),
    ]));
    if(combined.length>1000)throw new Error(
      "Total "+combined.length+" nomor dari impor dan pilihan lama melebihi 1.000. Tidak ada nomor dipotong; bagi daftar.");
    setSelected(combined);
    setImported(incoming);
    setRecipientSource("excel");
    const inputRows=Number(parsed.inputRows??incoming.length+parsed.duplicates+parsed.emptyRows+parsed.errors.length);
    setImportSkipped(Math.max(0,inputRows-incoming.length));
    setImportNotice(file.name+": "+inputRows+" baris diperiksa → "+incoming.length+
      " nomor unik dipilih · "+parsed.duplicates+" duplikat · "+parsed.emptyRows+
      " kosong · "+parsed.errors.length+" tidak valid/menolak promosi. "+
      (parsed.nameColumnDetected?parsed.namedCount+" nama pelanggan terbaca. ":"Nama tidak ada; sapaan cadangan dipakai. ")+
      (browserFallback?"File dibaca di HP karena API impor terganggu. ":"")+
      (parsed.errors.length?"Contoh: "+parsed.errors.slice(0,3).join("; "):""));
   }catch(e){setError((e as Error).message||"Impor gagal. Coba unggah ulang file.");}
   finally{setBusy(false)}
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
 async function save(mode:"NOW"|"DRAFT"){
  if(busy)return;
  setBusy(true);setError("");
  try{
   if(!product)throw new Error("Pilih produk di bagian 1 terlebih dahulu.");
   // Blash-only targets: no need to register numbers through Contacts.
   const pending=recipientSource==="manual"?readManualRows():[];
   const selectedPhones=Array.from(new Set([...selected,...pending.map(c=>c.phone),...pastedResult.contacts.map(c=>c.phone)]));
   if(!selectedPhones.length)throw new Error("Tambahkan kontak manual atau pilih minimal satu penerima");
   if(selectedPhones.length>1000)throw new Error("Maksimal 1.000 penerima per Blash");
   if(listConsentConfirmed&&consentSource.trim().length<12)
     throw new Error("Tuliskan sumber persetujuan pelanggan minimal 12 karakter, misalnya nama formulir atau daftar yang memang berizin.");
   const imports=new Map(allImported.map(c=>[c.phone,c]));
   for(const c of pending)imports.set(c.phone,c);
   if(listConfirmed){
     for(const contact of known.filter(c=>c.phone&&selectedPhones.includes(c.phone))){
       if(!imports.has(contact.phone!))imports.set(contact.phone!,{
         phone:contact.phone!,name:contact.name||("Pelanggan "+contact.phone!.slice(-4)),
         tags:contact.tags||"",consent:true,consent_evidence:consentSource.trim()
       });
     }
   }
   const included=Array.from(imports.values()).filter(c=>selectedPhones.includes(c.phone))
      .map(c=>listConfirmed?{...c,consent:true,consent_evidence:consentSource.trim()}:c);
   if(included.some(c=>c.consent&&c.consent_evidence.trim().length<12))
     throw new Error("Kontak berstatus setuju harus memiliki sumber persetujuan. Lengkapi bukti_izin di Excel atau konfirmasi satu sumber untuk daftar.");
   if(mode==="NOW"&&readyPreview===0)
     throw new Error("Belum ada penerima dengan izin promosi tercatat. Konfirmasikan sumber izin daftar yang memang sudah menyetujui.");
   if(included.length>1000)throw new Error("Maksimal 1.000 kontak baru per Blash");
   validateSteps(steps);
   const campaignName=name.trim()||("Promosi "+(products.find(p=>p.source_key===product)?.payload?.product_name||product)).slice(0,120);
   const result=savedDraft?null:await campaignRequest({action:"create",campaign:{session_name:senderSession,name:campaignName,product_id:product,phones:selectedPhones,
    import_contacts:included,excluded_phones:excluded.filter(x=>selectedPhones.includes(x)),steps,bot_enabled:false}});
   const draftId=savedDraft||String(result?.id||"");
   if(!draftId)throw new Error("Draft tidak memiliki ID penyimpanan; pengiriman ditahan.");
   if(result&&Number(result.saved_recipients)!==selectedPhones.length)
    throw new Error("Jumlah penerima tersimpan tidak cocok dengan pilihan. Pengiriman ditahan; periksa draft.");
   setSavedDraft(draftId);
   if(mode==="NOW"){
    try{await campaignRequest({action:"START",id:draftId})}
    catch(e){throw new Error("Draft tersimpan, tetapi pengiriman belum dimulai: "+(e as Error).message)}
   }
   onDone(draftId);
  }catch(e){setError((e as Error).message);if((e as Error).message.includes("Kontak manual"))setRecipientSource("manual")}
  finally{setBusy(false)}
 }
 return <section className="card campaignEditor onePageCampaign">
  <div className="sectionTitle"><div><h2>Buat Blash</h2>
   <p className="muted">Tempel nomor / impor Excel → isi pesan → kirim. Tidak perlu menu Kontak.</p>
  </div><button className="btn" type="button" onClick={onClose}>Tutup</button></div>
  <BlastSender onChange={setSenderSession}/>
  <nav className="blashJumpLinks" aria-label="Bagian pengisian Blash">
   <a href="#blash-product">1. Produk</a><a href="#blash-recipients">2. Penerima</a>
   <a href="#blash-message">3. Isi pesan</a><a href="#blash-review">4. Kirim</a>
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
   <section id="blash-recipients" className="oneCampaignBlock"><h3>2. Nomor tujuan</h3>
    <div className="campaignImportPanel">
     <label className="fieldLabel"><b>Tempel nomor WhatsApp</b>
      <textarea className="input" rows={6} value={pasted}
       onChange={e=>{setPasted(e.target.value);setRecipientSource("paste");}}
       placeholder={"081234567890\n082345678901\n6281234567890\nNama Sekolah, 081234567890"}
       aria-label="Tempel daftar nomor WhatsApp untuk Blash" />
     </label>
     <p className="muted">Bisa hingga 1.000 nomor unik per kampanye (termasuk lebih dari 500), satu per baris atau dipisahkan koma. Nomor ganda dihitung satu penerima. 08 otomatis diubah menjadi 62.</p>
     <label className="fieldLabel"><b>Atau unggah Excel / CSV</b>
       <small className="muted">Mendeteksi kolom name dan phone dari file per 100/per 200, termasuk nama pelanggan. Pilih file .xlsx langsung (jangan ZIP). Jika API impor terganggu di HP, file tetap dibaca otomatis di browser. Nomor 08/8/62 diseragamkan.</small>
      <input className="input" type="file" accept=".xlsx,.csv" disabled={busy}
       onChange={e=>{const chosen=e.currentTarget.files?.[0];e.currentTarget.value="";void loadExcel(chosen);}}/></label>
     <div className="actions">
      <span className="muted">{pastedResult.contacts.length} nomor tempel · {imported.length} nomor Excel · {pastedResult.duplicates} duplikat</span></div>
     {pastedResult.errors.length>0&&<p className="notice" role="alert">{pastedResult.errors.length} baris dilewati: {pastedResult.errors.slice(0,3).join("; ")}</p>}
     {importNotice&&<p className="notice" role="status">{importNotice}</p>}
     {importSkipped>0&&<p className="notice" role="alert"><b>Periksa sumber Excel:</b> {importSkipped} baris tidak menjadi penerima (duplikat, kosong, tidak valid, atau menolak promosi). Jika 100 baris berisi hanya 90 nomor unik, sistem tidak akan mengklaim mengirim ke 100 orang. Perbaiki daftar jika perlu 100 nomor berbeda.</p>}
    </div>
    <details className="blashExtra">
    <summary>Cara lain: pilih Kontak lama atau ketik satu-satu</summary>
    <div className="campaignSourceHeader">
     <div className="campaignSourceTabs" role="group" aria-label="Sumber penerima">
      <button type="button" aria-pressed={recipientSource==="paste"} className={"btn "+(recipientSource==="paste"?"primary":"")}
       onClick={()=>setRecipientSource("paste")}>Tempel nomor</button>
      <button type="button" aria-pressed={recipientSource==="existing"} className={"btn "+(recipientSource==="existing"?"primary":"")}
       onClick={()=>setRecipientSource("existing")}>Kontak tersimpan ({data?.total??0})</button>
      <button type="button" aria-pressed={recipientSource==="excel"} className={"btn "+(recipientSource==="excel"?"primary":"")}
       onClick={()=>setRecipientSource("excel")}>Dari Excel ({imported.length})</button>
      <button type="button" aria-pressed={recipientSource==="manual"} className={"btn "+(recipientSource==="manual"?"primary":"")}
       onClick={()=>setRecipientSource("manual")}>Ketik nomor ({manualContacts.length})</button>
     </div>
     <Link className="btn campaignManageContact" href="/contacts">Menu kontak →</Link>
    </div>
    </details>
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

      <p className="muted">Kontak baru siap dipilih tanpa proses izin satu per satu. Nomor invalid dan opt-out tetap diblokir.</p>
    </div>}
    {recipientSource!=="paste"&&<>
    <div className="campaignToolbar campaignRecipientToolbar section">
     <input className="input" aria-label="Cari penerima" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0)}}
      placeholder="Cari nama, nomor, label..."/>
     <button className="btn" type="button" onClick={()=>void selectAll()} disabled={busy}>Pilih semua yang cocok</button>
     <button className="btn" type="button" onClick={()=>{setSelected([]);setExcluded([])}}>Hapus pilihan</button>
    </div>
    <div className="campaignRecipientSummary">
     <span><b>{selected.length}</b> dipilih</span><span><b>{excluded.filter(x=>selected.includes(x)).length}</b> dikecualikan</span>
     <span><b>{eligibleVisible}</b> nomor siap dipilih</span>
    </div>
    <div className="recipientPicker campaignRecipientPicker">
     {visible.map((c:any)=>{
      const phone=c.phone as string|null;
      const valid=!!phone&&/^[1-9][0-9]{7,14}$/.test(phone);
      const opted=!!c.opted_out_at,blocked=!!c.exclusion;
      const permitted=valid&&!opted&&!blocked;
      const chosen=!!phone&&selected.includes(phone);
      const omit=!!phone&&excluded.includes(phone);
      return <div key={phone||c.chat_id} className={"campaignRecipient "+(omit?"excluded":"")}>
       <label className="campaignRecipientMain">
        <input type="checkbox" disabled={!valid} checked={chosen} onChange={()=>{if(phone)toggle(phone)}}/>
        <span className="campaignRecipientName"><b>{c.name||phone||"Kontak WhatsApp"}</b>
         <small>{phone?"+"+phone:"Kontak WhatsApp belum memiliki nomor yang dapat digunakan untuk Blash."}{c.tags?" · "+c.tags:""}</small></span>
       </label>
       <span className={"badge "+(permitted?"ok":"warn")}>
        {!valid?(c.chat_id?.endsWith("@lid")?"LID belum terpetakan":"INVALID_PHONE"):blocked?"Blokir owner":opted?"Berhenti promosi":permitted?"Siap promosi":"Tidak dapat dikirimi"}
       </span>
       <label className="campaignRecipientExclude" title="Lewati nomor ini untuk Blash ini">
        <input type="checkbox" disabled={!valid} checked={omit} onChange={()=>{if(phone)toggleExclude(phone)}}/>
        <span>Lewati</span>
       </label>
      </div>;
     })}
     {!visible.length&&<div className="empty">{recipientSource==="existing"&&loading?"Memuat kontak…":recipientSource==="excel"?
      "Impor Excel untuk menyiapkan nomor baru.":recipientSource==="manual"?
      "Isi kontak manual lalu simpan draft. Baris manual ikut otomatis.":"Tidak ada kontak yang cocok."}</div>}
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
    </>}
    <p className="muted">Nomor invalid, LID, opt-out, pengecualian, dan nomor yang sudah pernah di-Blash tetap dilewati otomatis.</p>
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
        onChange={e=>edit(i,{body:e.target.value})} placeholder="Halo {nama}, ini penawaran kami.\nLink YouTube juga boleh ditambahkan di sini."/></label>
      <small className="muted">{step.body.length}/4.000 · Deteksi nama Excel: gunakan {"{nama}"} atau {"{{nama}}"} (keduanya sama).</small>
      <button type="button" className="btn" disabled={step.body.length>3990} onClick={()=>edit(i,{body:step.body+(step.body&&!/\s$/.test(step.body)?" ":"")+"{nama}"})}>+ Sisipkan nama pelanggan</button>
     </div>)}
     {steps.length<2&&<button className="btn" onClick={()=>setSteps(v=>[...v,{type:"TEXT",body:""}])}>+ Tambah pesan kedua</button>}
     </div>
     <aside className="messagePreview"><small>PRATINJAU UNTUK PELANGGAN</small><h3>{previewName}</h3>
      {steps.map((step,i)=><div className="previewBubble" key={i}>
       {step.type==="VIDEO"&&(mediaPreviews[i]?<video src={mediaPreviews[i]} className="campaignPreviewMiniVideo" controls playsInline preload="metadata"/>:
        <div className="videoPlaceholder">▶ Video MP4</div>)}
       {step.type==="IMAGE"&&(mediaPreviews[i]?<img src={mediaPreviews[i]} className="campaignPosterPreview" alt="Pratinjau gambar penerima"/>:
        <div className="videoPlaceholder">▧ Poster JPG / PNG</div>)}
       <p>{renderPersonalizedMessage(step.body,previewName)||"Isi pesan akan muncul di sini."}</p>
      </div>)}
     </aside>
    </div>
   </section>
   <section id="blash-review" className="oneCampaignBlock"><h3>4. Kirim atau jadwalkan</h3>
    <label className="checkLine">
     <input type="checkbox" checked={listConsentConfirmed}
      onChange={e=>setListConsentConfirmed(e.target.checked)}/>
     <span><b>Semua penerima pada daftar ini sudah menyetujui promosi WhatsApp</b>
      <small>Cukup konfirmasi sekali untuk seluruh daftar yang benar-benar telah memberi izin. Nomor opt-out dan nomor yang diblokir tetap dilewati.</small></span>
    </label>
    {listConsentConfirmed&&<label className="fieldLabel">Sumber persetujuan daftar
     <input className="input" value={consentSource} maxLength={500}
      onChange={e=>setConsentSource(e.target.value)}
      placeholder="Contoh: Form pendaftaran pelanggan 15 Oktober 2026"/>
     <small className="muted">Cantumkan sumber izin yang benar-benar tersedia, bukan keterangan buatan.</small>
    </label>}
    <p className="muted">AI Auto Reply nonaktif untuk Blash ini; balasan pelanggan tetap masuk Inbox.</p>
    <div className="campaignReview">
     <div><small>Produk</small><b>{products.find(p=>p.source_key===product)?.payload?.product_name||"Belum dipilih"}</b></div>
     <div><small>Penerima disiapkan</small><b>{preparedPhones.length}</b></div>
     <div><small>Siap berdasarkan izin tercatat</small><b>{readyPreview}</b></div>
     <div><small>Format</small><b>{steps.some(x=>x.type==="IMAGE")?"Poster/gambar":steps.some(x=>x.type==="VIDEO")?"Video + teks":"Teks"}</b></div>
    </div>
    <p className="muted">Tes ke nomor sendiri bersifat opsional. Pelanggan belum menerima pesan sampai kamu memilih Kirim atau Jadwalkan.</p>
   </section>
  </div>
  <div ref={feedback} tabIndex={-1}>{(error||(recipientSource==="existing"?loadError:""))&&<div className="notice errorNotice section" role="alert">{error||(recipientSource==="existing"?loadError:"")}</div>}</div>
  <div className="actions section"><button className="btn primary" disabled={busy||readyPreview===0}
   onClick={()=>void save("NOW")}>{busy?"Memproses…":"Kirim sekarang ("+readyPreview+" nomor)"}</button>
   <button className="btn" disabled={busy} onClick={()=>void save("DRAFT")}>Simpan draft / jadwalkan</button>
   {savedDraft&&<button className="btn" type="button" onClick={()=>onDone(savedDraft)}>Buka draft tersimpan</button>}
   <button className="btn" onClick={onClose}>Batal</button></div>
 </section>;
}
