const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function load(whenSummary) {
  const code = ts.transpileModule(
    fs.readFileSync("components/DashboardOverview.tsx", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }
  ).outputText;
  const m = { exports: {} };
  const mockRequire = (name) => {
    if (name === "next/link") return { default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) };
    if (name === "@/components/useSummary") return { useSummary: whenSummary };
    return require(name);
  };
  vm.runInNewContext(code, { module: m, exports: m.exports, require: mockRequire, console });
  return m.exports.default;
}

test("homepage is server-rendered and never imports the global data store", () => {
  const source = fs.readFileSync("app/page.tsx", "utf8");
  assert.doesNotMatch(source, /^["']use client["'];/);
  assert.doesNotMatch(source, /useSummary|components\/Store|rupiah/);
  assert.match(source, /DashboardOverview/);
  assert.match(source, /href="\/inbox"/);
});

test("dashboard safely renders empty server response and preserves Blash links", () => {
  const html = renderToStaticMarkup(React.createElement(load(() => ({ data: null, error: "" }))));
  assert.match(html, /Ringkasan hari ini/);
  assert.match(html, /href="\/campaigns"/);
  assert.match(html, /Perlu follow-up/);
});

test("malformed and non-finite metrics cannot break React render", () => {
  for (const data of [ {}, { revenue: "not-a-number", profit: "Infinity", closing: {}, pending: null }, { revenue: 99_000, closing: 42, verify: 3 } ]) {
    const html = renderToStaticMarkup(React.createElement(load(() => ({ data, error: "" }))));
    assert.match(html, /Total penjualan/);
    assert.match(html, /Kelola kampanye/);
    assert.doesNotMatch(html, /NaN|Infinity/);
  }
});

test("a failing summary fetch shows inline error instead of replacing the entire page", () => {
  const html = renderToStaticMarkup(React.createElement(load(() => ({ data: null, error: "Temporary failure" }))));
  assert.match(html, /Temporary failure/);
  assert.match(html, /href="\/integrations"/);
  assert.match(html, /href="\/campaigns"/);
});
