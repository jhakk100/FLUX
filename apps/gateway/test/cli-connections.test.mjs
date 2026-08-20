import assert from "node:assert/strict";
import test from "node:test";
import { connectionReport } from "../../cli/src/index.mjs";

const config = { discord: { token: "", allowedUserIds: [], allowedChannelIds: [] }, notion: { apiKey: "", contextPageIds: [] } };
const providers = { provider: "ollama", ollama: { baseUrl: "http://127.0.0.1:11434", model: "local" }, lmstudio: { baseUrl: "", model: "", apiKey: "" }, openai: { baseUrl: "", model: "", apiKey: "" }, factchat: { baseUrl: "", model: "", apiKey: "" }, googleAi: { baseUrl: "", model: "", apiKey: "" } };

test("connection command separates LLM APIs from auxiliary service APIs", () => {
  assert.match(connectionReport(config, providers, "1"), /LLM·모델 API/);
  assert.match(connectionReport(config, providers, "1"), /ollama/);
  assert.match(connectionReport(config, providers, "2"), /부가 서비스 API/);
  assert.match(connectionReport(config, providers, "2"), /Discord/);
  assert.match(connectionReport(config, providers, ""), /1\) LLM·모델 API/);
});
