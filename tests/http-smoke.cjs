// Run separately after npm run build; starts its own local server, no production access.
const { spawn } = require("node:child_process"),
  assert = require("node:assert/strict");
(async () => {
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3111",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  server.stdout.on("data", (b) => (logs += b));
  server.stderr.on("data", (b) => (logs += b));
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (logs.includes("Ready")) {
        ready = true;
        break;
      }
      if (server.exitCode !== null) throw Error(logs);
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(ready, "Server not ready: " + logs);
    for (const [path, status] of [
      ["/", 200],
      ["/api/health", 200],
      ["/api/auth/session", 200],
      ["/api/database/products", 401],
      ["/api/control/inbox", 401],
      ["/api/control/health", 401],
    ]) {
      const r = await fetch("http://127.0.0.1:3111" + path);
      assert.equal(r.status, status, path);
      console.log("PASS", path, status);
    }
    const r = await fetch("http://127.0.0.1:3111/api/control/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(r.status, 401);
    console.log("PASS unauthenticated mutation 401");
  } finally {
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
