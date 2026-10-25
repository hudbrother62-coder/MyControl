const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const ts=require("typescript");

function parser(){
  const module={exports:{}};
  const source=ts.transpileModule(fs.readFileSync("lib/campaigns.ts","utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  vm.runInNewContext(source,{module,exports:module.exports,URL});
  return module.exports.parseBlashImportRows;
}

test("Excel reconciliation shows 100 rows with 90 unique contacts (not 100 sent)",()=>{
  const parse=parser();
  const unique=Array.from({length:90},(_,i)=>"62812"+String(i).padStart(8,"0"));
  const result=parse([...unique.map(phone=>[phone]),...unique.slice(0,10).map(phone=>[phone])]);
  assert.equal(result.inputRows,100);
  assert.equal(result.contacts.length,90);
  assert.equal(result.duplicates,10);
  assert.equal(result.errors.length,0);
  assert.equal(result.inputRows,result.contacts.length+result.duplicates+result.emptyRows+result.errors.length);
});

test("large Excel imports retain every unique contact for 600 and 1000 recipients",()=>{
  const parse=parser();
  for(const total of [600,1000]){
    const rows=[["name","phone"]];
    for(let i=0;i<total;i++)rows.push(["Pelanggan "+(i+1),"62813"+String(i).padStart(8,"0")]);
    const result=parse(rows);
    assert.equal(result.inputRows,total);
    assert.equal(result.contacts.length,total);
    assert.equal(new Set(result.contacts.map(r=>r.phone)).size,total);
    assert.equal(result.errors.length,0);
  }
});

test("Blash never silently truncates imports; database counts are checked before sending",()=>{
  const editor=fs.readFileSync("components/CampaignEditor.tsx","utf8");
  const route=fs.readFileSync("app/api/campaigns/route.ts","utf8");
  const details=fs.readFileSync("app/campaigns/page.tsx","utf8");
  const migration=fs.readFileSync("database/072_blash_delivery_summary.sql","utf8");
  assert.doesNotMatch(editor,/\.slice\(0,1000\)/);
  assert.match(editor,/inputRows.*baris diperiksa/);
  assert.match(editor,/setImportSkipped/);
  assert.match(route,/savedCount !== phones\.length/);
  assert.match(route,/mc_campaign_delivery_summary/);
  assert.match(details,/delivery\.pending/);
  assert.match(details,/delivery\.failed/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.mc_campaign_delivery_summary\(uuid\) TO service_role/);
});
