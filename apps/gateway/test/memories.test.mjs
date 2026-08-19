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

test("goals retain status and can be updated or removed", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-goals-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const goal = store.createGoal({ title: "학기 프로젝트", details: "매주 목요일 점검", status: "active" });
  assert.equal(store.listGoals()[0].title, "학기 프로젝트");
  assert.equal(store.updateGoal(goal.id, { title: "학기 프로젝트", details: "완료", status: "completed" }).status, "completed");
  assert.equal(store.deleteGoal(goal.id), true);
  assert.equal(store.listGoals().length, 0);
  store.close();
});
