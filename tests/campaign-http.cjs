// Local HTTP integration with real PostgreSQL functions and a minimal PostgREST test adapter.
const test = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  { spawn } = require("node:child_process"),
  { createHmac } = require("node:crypto"),
  { PGlite } = require("@electric-sql/pglite");
let pg, adapter, web;
const base = "http://127.0.0.1:3217";
const payload = Buffer.from(
  JSON.stringify({ role: "OWNER", exp: Date.now() + 600000 }),
).toString("base64url");
const cookie =
  "mc_session=" +
  payload +
  "." +
  createHmac("sha256", "integration-only").update(payload).digest("base64url");
const rpcNames = new Set([
  "mc_campaign_contact_import",
  "mc_save_campaign",
  "mc_campaign_action",
  "mc_campaign_overview",
  "mc_campaign_delivery_summary",
]);
test.before(async () => {
  pg = new PGlite();
  await pg.exec(
    "create role anon;create role authenticated;create role service_role;",
  );
  for (const f of [
    "001_queue",
    "002_reliability",
    "003_business_sync",
    "005_campaigns",
    "072_blash_delivery_summary",
  ])
    await pg.exec(
      fs
        .readFileSync("database/" + f + ".sql", "utf8")
        .replace("create extension if not exists pgcrypto;", ""),
    );
  adapter = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers.apikey, "integration-key");
      const url = new URL(req.url, "http://localhost");
      let result;
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.split("/").pop();
        if (!rpcNames.has(name)) throw Error("Unexpected RPC");
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const args = JSON.parse(raw || "{}"),
          keys = Object.keys(args);
        result = (
          await pg.query(
            "select " +
              name +
              "(" +
              keys.map((k, i) => k + "=> $" + (i + 1)).join(",") +
              ") as r",
            keys.map((k) =>
              typeof args[k] === "object" && args[k] !== null
                ? JSON.stringify(args[k])
                : args[k],
            ),
          )
        ).rows[0].r;
      } else if (url.pathname === "/rest/v1/mc_campaign_contacts") {
        result = (
          await pg.query(
            "select * from mc_campaign_contacts order by created_at desc limit 1000",
          )
        ).rows;
      } else throw Error("Unexpected endpoint");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: e.message }));
    }
  });
  await new Promise((r) => adapter.listen(3218, "127.0.0.1", r));
  web = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3217"],
    {
      env: {
        ...process.env,
        SESSION_SECRET: "integration-only",
        SUPABASE_URL: "http://127.0.0.1:3218",
        SUPABASE_SERVICE_ROLE_KEY: "integration-key",
      },
      stdio: "ignore",
    },
  );
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base + "/api/auth/session");
      ready = true;
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, "Next server started");
});
test.after(async () => {
  web?.kill();
  if (adapter) await new Promise((r) => adapter.close(r));
  await pg?.close();
});
const call = (body, extra = {}) =>
  fetch(base + "/api/campaigns", {
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:3217",
      "content-type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
  });
test("campaign routes enforce sessions and same-origin writes", async () => {
  assert.equal((await fetch(base + "/api/campaigns")).status, 401);
  assert.equal(
    (
      await call(
        { action: "import", contacts: [] },
        { origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
});
test("HTTP import persists to PostgreSQL and appears in contact API", async () => {
  const r = await call({
    action: "import",
    contacts: [
      {
        name: "HTTP Contact",
        phone: "081234567890",
        consent: true,
        source: "Test permission",
      },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).processed, 1);
  const list = await fetch(base + "/api/campaigns?view=contacts", {
    headers: { cookie },
  });
  assert.equal((await list.json()).contacts[0].phone, "6281234567890");
});
test("draft created via HTTP but launch fails closed without connected worker", async () => {
  const r = await call({
    action: "create",
    campaign: {
      name: "HTTP campaign",
      product_id: "KP001",
      phones: ["6281234567890"],
      steps: [{ type: "TEXT", body: "Hello {{nama}}" }],
    },
  });
  assert.equal(r.status, 200);
  const draft = await r.json();
  const start = await call({ action: "START", id: draft.id });
  assert.equal(start.status, 503);
  assert.match((await start.json()).error, /Worker/);
});
