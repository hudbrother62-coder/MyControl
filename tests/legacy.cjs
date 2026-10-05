const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  vm = require("vm");
test("personal Telegram isolates failure and records unknown updates", () => {
  const source = fs.readFileSync("legacy/AsistenHarianTelegram.gs", "utf8");
  const poll = source.slice(
    source.indexOf("function pollTelegramUpdates()"),
    source.indexOf("function hasProcessedUpdate_"),
  );
  const props = {};
  const handled = [];
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props[k],
        setProperty: (k, v) => (props[k] = v),
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
    },
    getConfig_: () => "fake",
    telegramRequest_: () => ({
      result: [
        { update_id: 1, message: { text: "a" } },
        { update_id: 2, message: { text: "b" } },
      ],
    }),
    hasProcessedUpdate_: () => false,
    markUpdateProcessed_: () => {},
    handleTelegramMessage_: (m) => {
      handled.push(m.text);
      if (m.text === "a") throw Error("simulated outage");
    },
    console: { error: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(poll, context);
  context.pollTelegramUpdates();
  assert.deepEqual(handled, ["a", "b"]);
  assert.equal(JSON.parse(props.TELEGRAM_UNKNOWN_UPDATES)[0].update_id, 1);
  assert.equal(props.TELEGRAM_OFFSET, "3");
});
