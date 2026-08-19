import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openStore } from "../src/db.mjs";

test("memories can be created, searched, updated, and deleted", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-memories-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const memory = store.createMemory({ kind: "preference", content: "Always answer in Korean." });

  assert.equal(store.listMemories("Korean").length, 1);
  assert.equal(store.updateMemory(memory.id, { kind: "goal", content: "Finish the FLUX project." }).kind, "goal");
  assert.equal(store.deleteMemory(memory.id), true);
  assert.equal(store.listMemories().length, 0);
  store.close();
});
