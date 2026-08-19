import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openStore } from "../src/db.mjs";

test("agent instructions are saved locally as a bounded global setting", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-agent-instructions-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  assert.equal(store.getSetting("agent-instructions"), null);
  store.setSetting("agent-instructions", "한국어로 간결하게 답해.");
  assert.equal(store.getSetting("agent-instructions"), "한국어로 간결하게 답해.");
  assert.equal(store.listAuditEvents().some((event) => event.eventType === "setting.updated"), true);
  store.close();
});
