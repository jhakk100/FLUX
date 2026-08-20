import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openStore } from "../src/db.mjs";
import { executeSlashCommand, parseSlashCommand } from "../src/slash-commands.mjs";

const config = { contextTokenBudget: 24000, contextCompactThreshold: 0.75 };
const providerConfig = { provider: "ollama", ollama: { baseUrl: "http://127.0.0.1:11434", model: "test-model" }, lmstudio: { baseUrl: "", model: "", apiKey: "" }, openai: { baseUrl: "", model: "", apiKey: "" }, factchat: { baseUrl: "", model: "", apiKey: "" }, googleAi: { baseUrl: "", model: "", apiKey: "" } };

test("slash command parser ignores ordinary messages", () => {
  assert.equal(parseSlashCommand("일반 대화"), null);
  assert.deepEqual(parseSlashCommand("/remember 한국어 선호"), { name: "remember", args: "한국어 선호" });
});

test("slash commands return local status and save an explicitly requested memory once", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-slash-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const session = store.createSession({ title: "명령" });
  const status = executeSlashCommand({ store, config, providerConfig, session, content: "/status" });
  assert.match(status, /ollama/);
  assert.match(executeSlashCommand({ store, config, providerConfig, session, content: "/remember 한국어로 답변" }), /저장했습니다/);
  assert.equal(store.listMemories().length, 1);
  assert.match(executeSlashCommand({ store, config, providerConfig, session, content: "/remember 한국어로 답변", mutate: false }), /다시 저장하지/);
  assert.equal(store.listMemories().length, 1);
  store.close();
});
