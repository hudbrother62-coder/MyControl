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
