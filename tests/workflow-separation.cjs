const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "workflows");
const original = JSON.parse(
  fs.readFileSync(path.join(root, "mycontrol.json"), "utf8"),
);
const specs = [
  ["01-waha-inbound.json", "n8n-nodes-base.webhook", 8],
  ["02-ai-worker.json", "n8n-nodes-base.scheduleTrigger", 32],
  ["03-outbound.json", "n8n-nodes-base.scheduleTrigger", 18],
  ["04-followup.json", "n8n-nodes-base.scheduleTrigger", 5],
];
const exported = specs.map(([file]) =>
  JSON.parse(fs.readFileSync(path.join(root, "production", file), "utf8")),
);
const isNote = (n) => n.type === "n8n-nodes-base.stickyNote";
const functional = (w) => w.nodes.filter((n) => !isNote(n));

test("four independent, inactive, importable n8n workflows", () => {
  assert.equal(exported.length, 4);
  const ids = new Set();
  for (let index = 0; index < exported.length; index++) {
    const workflow = exported[index];
    const [file, triggerType, expectedCount] = specs[index];
    assert.equal(workflow.active, false, file);
    assert.equal(functional(workflow).length, expectedCount, file);
    assert.equal(
      functional(workflow).filter((n) => n.type === triggerType).length,
      1,
      file,
    );
    assert.equal(
      functional(workflow).filter((n) =>
        ["n8n-nodes-base.webhook", "n8n-nodes-base.scheduleTrigger"].includes(
          n.type,
        ),
      ).length,
      1,
      file,
    );
    assert.equal(typeof workflow.name, "string", file);
    assert.equal(workflow.settings?.timezone, "Asia/Jakarta", file);
    for (const node of functional(workflow)) {
      assert(!ids.has(node.id), "node included more than once: " + node.name);
      ids.add(node.id);
    }
  }
});

test("partition preserves every operational node from original MyControl", () => {
  const originalNames = functional(original)
    .map((n) => n.name)
    .sort();
  const newNames = exported
    .flatMap((w) => functional(w).map((n) => n.name))
    .sort();
  for (const name of originalNames)
    assert(
      newNames.includes(name.replace("Gemini", "Groq")),
      "missing operational node " + name,
    );
});

test("all connections and named node expressions resolve inside their workflow", () => {
  for (const workflow of exported) {
    const names = new Set(functional(workflow).map((n) => n.name));
    for (const [source, outputs] of Object.entries(workflow.connections)) {
      assert(names.has(source), "unknown source " + source);
      for (const branches of Object.values(outputs)) {
        for (const links of branches) {
          for (const edge of links)
            assert(names.has(edge.node), "external edge " + edge.node);
        }
      }
    }
    for (const node of functional(workflow)) {
      const text = JSON.stringify(node.parameters || {});
      const pattern =
        /\$\(\s*['"`]([^'"`]+)['"`]\s*\)|\$node\[['"]([^'"]+)['"]\]/g;
      for (const ref of text.matchAll(pattern))
        assert(
          names.has(ref[1] || ref[2]),
          "cross-workflow reference: " + node.name,
        );
    }
  }
});

test("only inbound has production WhatsApp webhook and fast ACK nodes", () => {
  const [inbound, ai, outbound, followup] = exported;
  const nodes = functional(inbound);
  const webhook = nodes.find((n) => n.type === "n8n-nodes-base.webhook");
  assert.equal(webhook.parameters.path, "mycontrol/waha/inbound");
  assert.equal(webhook.parameters.responseMode, "responseNode");
  assert.equal(webhook.parameters.authentication, "headerAuth");
  assert(nodes.some((n) => n.name === "Atomic Ingest + Dedupe"));
  assert(nodes.some((n) => n.name === "ACK 200 Accepted"));
  assert(nodes.some((n) => n.name === "ACK 200 Ignored"));
  for (const w of [ai, outbound, followup])
    assert(!functional(w).some((n) => n.type === "n8n-nodes-base.webhook"));
});

test("outbound ambiguity is isolated from AI inference and follow-up", () => {
  const [, ai, outbound, followup] = exported;
  assert(
    functional(ai).some(
      (n) => n.name === "Commit AI Decision + Schedule Follow-ups",
    ),
  );
  assert(!functional(ai).some((n) => n.name === "WAHA Send Text"));
  assert(functional(outbound).some((n) => n.name === "Mark Outbound UNKNOWN"));
  assert(functional(outbound).some((n) => n.name === "Validate WAHA Receipt"));
  assert(
    !functional(outbound).some((n) => n.name === "Sales AI Agent - Slot 1"),
  );
  assert(
    functional(followup).some((n) => n.name === "Dispatch Due Follow-ups"),
  );
  assert(!functional(followup).some((n) => n.name === "WAHA Send Text"));
});
