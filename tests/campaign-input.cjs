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
