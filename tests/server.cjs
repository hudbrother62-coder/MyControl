const test = require("node:test"),
  assert = require("node:assert/strict"),
  ts = require("typescript"),
  fs = require("fs"),
  vm = require("vm");
function load(path) {
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(code, {
    exports: m.exports,
    require,
    module: m,
    process,
    Buffer,
    Response,
    Request,
    fetch,
    AbortSignal,
    URL,
  });
  return m.exports;
}
const session = load("lib/server/session.ts");
process.env.SESSION_SECRET = "test-secret-only";
test("signed session passes and tampered session fails", () => {
  const token = session.issueSession("OWNER");
  assert.equal(
    session.authenticated(
      new Request("https://test.invalid", {
        headers: { cookie: "mc_session=" + token },
      }),
    ),
    true,
  );
  assert.equal(
    session.authenticated(
      new Request("https://test.invalid", {
        headers: { cookie: "mc_session=" + token + "x" },
      }),
    ),
    false,
  );
});
test("mutations reject absent and cross-origin credentials", () => {
  assert.throws(
    () => session.authorize(new Request("https://test.invalid"), true),
    /UNAUTHORIZED/,
  );
  const token = session.issueSession("OWNER");
  assert.throws(
    () =>
      session.authorize(
        new Request("https://test.invalid", {
          headers: {
            cookie: "mc_session=" + token,
            origin: "https://evil.invalid",
          },
        }),
        true,
      ),
    /FORBIDDEN/,
  );
});
test("Telegram owner unset fails closed", () => {
  const tg = load("lib/telegram.ts");
  delete process.env.TELEGRAM_OWNER_CHAT_ID;
  assert.equal(tg.ownerAllowed(999), false);
  process.env.TELEGRAM_OWNER_CHAT_ID = "123";
  assert.equal(tg.ownerAllowed(123), true);
  assert.equal(tg.ownerAllowed(999), false);
});
