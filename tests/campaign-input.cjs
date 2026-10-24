const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  ts = require("typescript"),
  vm = require("node:vm");
function load() {
  const m = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("lib/campaigns.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { module: m, exports: m.exports, URL },
  );
  return m.exports;
}
test("normalize local numbers without accepting LID as phone", () => {
  const c = load();
  assert.equal(c.normalizePhone("0812-3456-7890"), "6281234567890");
  assert.throws(() => c.normalizePhone("12345@lid"));
});
test("CSV handles quoted commas, duplicate phones and invalid rows", () => {
  const c = load();
  const r = c.parseContacts(
    'nama,nomor,label\n"Bu, Ani",081234567890,sekolah\nAni,6281234567890,test\nBad,abc,test',
  );
  assert.equal(r.contacts.length, 1);
  assert.equal(r.contacts[0].name, "Bu, Ani");
  assert.equal(r.duplicates, 1);
  assert.equal(r.errors.length, 1);
});
test("only known variables and public HTTPS media accepted", () => {
  const c = load();
  assert.throws(() =>
    c.validateSteps([{ type: "TEXT", body: "Hi {{unknown}}" }]),
  );
  assert.throws(() =>
    c.validateSteps([
      { type: "VIDEO", body: "Hi", media_url: "https://127.0.0.1/x" },
    ]),
  );
  assert.equal(
    c.validateSteps([{ type: "TEXT", body: "Hi {{nama}}" }]).length,
    1,
  );
});


test("poster accepts private JPG and empty caption but rejects Drive share URL",()=>{
 const c=load();
 assert.equal(c.validateSteps([{type:"IMAGE",body:"",media_url:"storage://mycontrol-campaigns/11111111-1111-4111-8111-111111111111.jpg"}]).length,1);
 assert.equal(c.validateSteps([{type:"IMAGE",body:"Promo {{nama}}",media_url:"https://images.example.com/promo.png"}]).length,1);
 assert.throws(()=>c.validateSteps([{type:"IMAGE",body:"Poster",media_url:"https://drive.google.com/file/d/abc/view"}]),/langsung|URL/);
 assert.throws(()=>c.validateSteps([{type:"IMAGE",body:"Poster",media_url:"http://127.0.0.1/internal.jpg"}]),/HTTPS/);
 assert.throws(()=>c.validateSteps([{type:"IMAGE",body:"Poster",media_url:"storage://mycontrol-campaigns/promo.mp4"}]));
});

test("phone normalization accepts Excel name/phone values and local 8 prefix", () => {
  const c = load();
  assert.equal(c.normalizePhone("6282172256434"), "6282172256434");
  assert.equal(c.normalizePhone("82172256434"), "6282172256434");
  assert.equal(c.normalizePhone(" 0812 3456 7890 "), "6281234567890");
  const imported = c.parseContacts("name,phone\nSri,6282172256434\nSri Duplicate,082172256434\nBlank,");
  assert.equal(imported.contacts.length, 1);
  assert.equal(imported.duplicates, 1);
  assert.equal(imported.errors.length, 1);
});

test("Blash removes consent settings and derives recipient eligibility from recorded permission",()=>{
 const editor=fs.readFileSync("components/CampaignEditor.tsx","utf8");
 const sql=fs.readFileSync("database/042_blash_bulk_consent_reply_context.sql","utf8");
 assert.doesNotMatch(editor,/bulkConsent|bulkEvidence|campaignManualConsent|Izin promosi massal/);
 assert.match(editor,/locallyApproved.has\(phone\)/);
 assert.match(editor,/Siap promosi/);
 assert.match(sql,/cc.opted_out_at is null/);
 assert.match(sql,/mc_contact_exclusions/);
});
test("Blash reply context and campaign AI gate handle both phone and LID identity",()=>{
 const migration=fs.readFileSync("database/042_blash_bulk_consent_reply_context.sql","utf8");
 assert.match(migration,/mc_campaign_phone_for_chat\(v_chat\)/);
 assert.match(migration,/mc_get_ai_context_before_cs_quality/);
 assert.match(migration,/o\.sent_at > now\(\)-interval '14 days'/);
 assert.doesNotMatch(migration,/where p_chat_id ~ '\^\[0-9\]\{6,20\}@lid\$'/);
 assert.match(migration,/if v_bot=false then return null/);
});

test("contacts use reversible admin promotion defaults without fabricating customer consent; LID stays unmapped",()=>{
 const contacts=fs.readFileSync("app/contacts/page.tsx","utf8");
 const api=fs.readFileSync("app/api/campaigns/route.ts","utf8");
 const migration=fs.readFileSync("database/053_owner_promo_default_on.sql","utf8");
 assert.doesNotMatch(contacts,/Bukti persetujuan promo untuk seluruh daftar/);
 assert.match(contacts,/consent:false/);
 assert.match(contacts,/action:"promo_toggle"/);
 assert.match(contacts,/Nomor WA belum terpetakan/);
 assert.match(contacts,/c.phone && c.consent/);
 assert.match(contacts,/c.opted_out_at/);
 assert.match(api,/mc_owner_promo_bulk/);
 assert.match(migration,/owner_promo_disabled/);
 assert.match(migration,/NEW.opted_out_at IS NOT NULL/);
});
test("explicit opt-in is strict, contact-initiated and preserves identity checks",()=>{
 const migration=fs.readFileSync("database/045_capture_explicit_prime_store_promo_optin.sql","utf8");
 assert.match(migration,/saya setuju menerima promosi dari prime store/);
 assert.match(migration,/if new.from_me or new.is_group/);
 assert.match(migration,/mc_campaign_phone_for_chat\(new.chat_id\)/);
 assert.match(migration,/CUSTOMER_WHATSAPP_EXPLICIT_OPTIN/);
 assert.match(migration,/v_msg not in\(/);
});


test("Blash imports headerless single-column Excel layout with 90 unique recipients", () => {
  const { parseBlashImportRows } = load();
  const unique = Array.from({ length: 89 }, (_, i) => "6281234" + String(i).padStart(6, "0"));
  const rows = [
    ...unique.map(phone => [phone]),
    ["85384931311"],
    ...unique.slice(0, 9).map(phone => [phone]),
    [""],
  ];
  const result = parseBlashImportRows(rows);
  assert.equal(rows.length, 100);
  assert.equal(result.contacts.length, 90);
  assert.equal(result.duplicates, 9);
  assert.equal(result.emptyRows, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.contacts[89].phone, "6285384931311");
  assert.equal(result.contacts[0].name, "Pelanggan " + unique[0].slice(-4));
  assert.ok(result.contacts.every(contact => !contact.consent));
});

test("Blash headered imports preserve names and skip explicit promotional opt-outs", () => {
  const { parseBlashImportRows } = load();
  const result = parseBlashImportRows([
    ["nama", "nomor", "izin_promosi", "bukti_izin"],
    ["Guru A", "081234567890", "tidak", ""],
    ["Guru B", "82123456789", "ya", "Persetujuan langsung via chat"],
    ["Guru B duplicate", "6282123456789", "", ""],
    ["Guru C", "abc", "", ""],
  ]);
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].name, "Guru B");
  assert.equal(result.contacts[0].phone, "6282123456789");
  assert.equal(result.contacts[0].consent, true);
  assert.equal(result.duplicates, 1);
  assert.equal(result.errors.length, 2);
});

test("Blash autodetects numbers from a headerless second column", () => {
  const { parseBlashImportRows } = load();
  const result = parseBlashImportRows([["Sari", "081234567890"], ["Budi", "6289876543210"]]);
  assert.equal(result.contacts.length, 2);
  assert.equal(result.contacts[0].name, "Sari");
  assert.equal(result.contacts[1].phone, "6289876543210");
});


function readXlsxRowsModule() {
  const m={exports:{}};
  const code=ts.transpileModule(fs.readFileSync("lib/xlsx-rows.ts","utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
  }).outputText;
  vm.runInNewContext(code,{module:m,exports:m.exports,require:(id)=>{
    if(id==="jszip")return require("jszip");
    return require(id);
  },Buffer,TextDecoder,Uint8Array});
  return m.exports;
}

function readUploadModule() {
  const m={exports:{}};
  const code=ts.transpileModule(fs.readFileSync("lib/server/blash-import.ts","utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  vm.runInNewContext(code,{module:m,exports:m.exports,Buffer,TextDecoder,require:(id)=>{
    if(id==="../campaigns")return load();
    if(id==="../xlsx-rows")return readXlsxRowsModule();
    return require(id);
  }});
  return m.exports;
}

test("server imports headerless numeric XLSX with an empty row in the middle",async()=>{
  const {Workbook}=require("exceljs");
  const wb=new Workbook();
  const sheet=wb.addWorksheet("Lembar1");
  const unique=Array.from({length:89},(_,i)=>String(6281200000000+i));
  const phones=[...unique,"85384931311",...unique.slice(0,9)];
  assert.equal(phones.length,99);
  phones.forEach((phone,i)=>{
    // Match the uploaded Excel shape: A1:A100, A89 blank, 99 numeric cells.
    const row=i<88?i+1:i+2;
    sheet.getCell("A"+row).value=Number(phone);
  });
  const data=new Uint8Array(await wb.xlsx.writeBuffer());
  const r=await readUploadModule().readBlashUpload("101 -200.xlsx",data);
  assert.equal(r.sheetName,"Lembar1");
  assert.equal(r.contacts.length,90);
  assert.equal(r.duplicates,9);
  assert.equal(r.emptyRows,1);
  assert.equal(r.errors.length,0);
  assert.equal(r.contacts[0].name,"Pelanggan "+unique[0].slice(-4));
  assert.equal(r.contacts[89].phone,"6285384931311");
  assert.ok(r.contacts.every(c=>c.consent===false));
});

test("server accepts headerless CSV, handles duplicates, and rejects .xls",async()=>{
  const parse=readUploadModule().readBlashUpload;
  const bytes=new TextEncoder().encode("6281234567890\n6281234567890\n081234567891\n");
  const r=await parse("data.csv",bytes);
  assert.equal(r.contacts.length,2);
  assert.equal(r.duplicates,1);
  await assert.rejects(parse("contacts.xls",new Uint8Array([1,2])),/xlsx|csv/);
});

test("server Excel import works with optional headers",async()=>{
  const {Workbook}=require("exceljs");
  const wb=new Workbook();
  const sheet=wb.addWorksheet("Kontak");
  sheet.addRow(["nomor","nama"]);
  sheet.addRow([81234567890,"Budi"]);
  const data=new Uint8Array(await wb.xlsx.writeBuffer());
  const r=await readUploadModule().readBlashUpload("data.xlsx",data);
  assert.equal(r.contacts.length,1);
  assert.equal(r.contacts[0].name,"Budi");
});

test("Excel import has no template buttons in Blash or Kontak",()=>{
  assert.doesNotMatch(fs.readFileSync("components/CampaignEditor.tsx","utf8"),/Template Excel|template-penerima/);
  assert.doesNotMatch(fs.readFileSync("app/contacts/page.tsx","utf8"),/Template CSV|template-kontak/);
});


test("Blash personalizes both {nama} and legacy {{nama}} using the same worker token",()=>{
  const c=load();
  const validated=c.validateSteps([{type:"TEXT",body:"Halo {nama}, selamat datang {{nama}}!"}]);
  assert.equal(validated[0].body,"Halo {{nama}}, selamat datang {{nama}}!");
  assert.equal(c.renderPersonalizedMessage(validated[0].body,"Bu Siti"),"Halo Bu Siti, selamat datang Bu Siti!");
  assert.equal(c.renderPersonalizedMessage("Halo {nama}",""),"Halo Bapak/Ibu");
  assert.throws(()=>c.validateSteps([{type:"TEXT",body:"Halo {{lainnya}}"}]),/Variabel/);
});

test("Excel files split per 100 and per 200 autodetect name and phone",async()=>{
  const {Workbook}=require("exceljs");
  for(const size of [100,200]){
    const wb=new Workbook();
    const sheet=wb.addWorksheet("Pelanggan");
    sheet.addRow(["name","phone"]);
    for(let i=1;i<=size;i++)sheet.addRow(["Nama Pelanggan "+i,"62812"+String(i).padStart(8,"0")]);
    const data=new Uint8Array(await wb.xlsx.writeBuffer());
    const result=await readUploadModule().readBlashUpload("1-"+size+".xlsx",data);
    assert.equal(result.contacts.length,size);
    assert.equal(result.namedCount,size);
    assert.equal(result.nameColumnDetected,true);
    assert.equal(result.contacts[0].name,"Nama Pelanggan 1");
    assert.equal(result.contacts.at(-1).name,"Nama Pelanggan "+size);
  }
});

test("Blash API persists normalized token and uses uploaded name per recipient",()=>{
  const api=fs.readFileSync("app/api/campaigns/route.ts","utf8");
  const editor=fs.readFileSync("components/CampaignEditor.tsx","utf8");
  const migration=fs.readFileSync("database/054_blash_excel_recipient_names.sql","utf8");
  assert.match(api,/steps:validatedSteps/);
  assert.match(editor,/parsed\.namedCount/);
  assert.match(editor,/renderPersonalizedMessage\(step\.body,previewName\)/);
  assert.match(migration,/UPDATE public\.mc_campaign_recipients AS r/);
  assert.match(migration,/r\.phone=src\.phone/);
  assert.match(migration,/mc_save_campaign_before_bulk_promo/);
  assert.doesNotMatch(migration,/UPDATE public\.mc_campaign_contacts/);
});


function readBrowserUploadModule(){
 const m={exports:{}};
 const code=ts.transpileModule(fs.readFileSync("lib/blash-local-import.ts","utf8"),{
   compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText;
 vm.runInNewContext(code,{module:m,exports:m.exports,Buffer,TextDecoder,require:(id)=>{
   if(id==="./campaigns")return load();
   if(id==="./xlsx-rows")return readXlsxRowsModule();
   return require(id);
 }});
 return m.exports;
}

test("browser fallback imports real 100 and 200 row XLSX when API fetch fails",async()=>{
 const {Workbook}=require("exceljs");
 const browserParser=readBrowserUploadModule().readBlashFileLocally;
 for(const size of [100,200]){
  const workbook=new Workbook();
  const sheet=workbook.addWorksheet("Pelanggan");
  sheet.addRow(["name","phone"]);
  for(let i=0;i<size;i++)
   sheet.addRow(["Ibu "+(i+1),"62817"+String(i).padStart(8,"0")]);
  const buffer=Buffer.from(await workbook.xlsx.writeBuffer());
  const result=await browserParser({
   name:"1-"+size+".xlsx",
   size:buffer.length,
   arrayBuffer:async()=>Uint8Array.from(buffer).buffer,
  });
  assert.equal(result.contacts.length,size);
  assert.equal(result.namedCount,size);
  assert.equal(result.contacts[0].name,"Ibu 1");
  assert.equal(result.contacts.at(-1).name,"Ibu "+size);
  assert.equal(result.nameColumnDetected,true);
 }
});

test("browser fallback handles CSV and rejects ZIP, without silently losing names",async()=>{
 const parser=readBrowserUploadModule().readBlashFileLocally;
 const csv="name,phone\nSari,081234567890\nBudi,082345678901\n";
 const parsed=await parser({name:"101-200.csv",size:csv.length,text:async()=>csv});
 assert.equal(parsed.contacts.length,2);
 assert.equal(parsed.contacts[0].name,"Sari");
 assert.equal(parsed.contacts[1].name,"Budi");
 await assert.rejects(parser({name:"semua-file.zip",size:100}),/xlsx|CSV|ZIP/);
});

test("Blash hides unrelated CRM fetch errors during local Excel recipients",()=>{
 const editor=fs.readFileSync("components/CampaignEditor.tsx","utf8");
 assert.match(editor,/readBlashFileLocally\(file\)/);
 assert.match(editor,/recipientSource==="existing"\?loadError/);
 assert.match(editor,/browserFallback/);
});

test("generated artifact-style XLSX prefixed XML with string cells parses 100 and 200 customers",async()=>{
  const JSZip=require("jszip");
  const parse=readUploadModule().readBlashUpload;
  const local=readBrowserUploadModule().readBlashFileLocally;
  for(const count of [100,200]){
    const zip=new JSZip();
    zip.file("xl/workbook.xml", '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Pelanggan" sheetId="1"/></x:sheets></x:workbook>');
    zip.file("xl/sharedStrings.xml", '<x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>');
    let xml='<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>';
    xml+='<x:row r="1"><x:c r="A1" t="str"><x:v>name</x:v></x:c><x:c r="B1" t="str"><x:v>phone</x:v></x:c></x:row>';
    for(let i=1;i<=count;i++){
      const n="62812"+String(i).padStart(8,"0");
      xml+='<x:row r="'+(i+1)+'"><x:c r="A'+(i+1)+'" t="str"><x:v>Guru '+i+'</x:v></x:c><x:c r="B'+(i+1)+'" t="str"><x:v>'+n+'</x:v></x:c></x:row>';
    }
    zip.file("xl/worksheets/sheet1.xml",xml+"</x:sheetData></x:worksheet>");
    const buffer=Buffer.from(await zip.generateAsync({type:"nodebuffer"}));
    const server=await parse("1-"+count+".xlsx",new Uint8Array(buffer));
    const browser=await local({name:"1-"+count+".xlsx",size:buffer.length,
      arrayBuffer:async()=>Uint8Array.from(buffer).buffer});
    for(const result of [server,browser]){
      assert.equal(result.contacts.length,count);
      assert.equal(result.namedCount,count);
      assert.equal(result.contacts[0].name,"Guru 1");
      assert.equal(result.contacts[0].phone,"6281200000001");
      assert.equal(result.contacts.at(-1).name,"Guru "+count);
    }
  }
});
