import assert from "node:assert/strict";
import test from "node:test";
import { connectionReport, modelListReport } from "../../cli/src/index.mjs";

const config = { discord: { token: "", allowedUserIds: [], allowedChannelIds: [] }, notion: { apiKey: "", contextPageIds: [] } };
const providers = { provider: "ollama", ollama: { baseUrl: "http://127.0.0.1:11434", model: "local" }, lmstudio: { baseUrl: "", model: "", apiKey: "" }, openai: { baseUrl: "", model: "", apiKey: "" }, factchat: { baseUrl: "", model: "", apiKey: "" }, googleAi: { baseUrl: "", model: "", apiKey: "" } };

test("API command separates model lookup from auxiliary services", () => {
  assert.match(connectionReport(config, providers, ""), /models/);
  assert.match(connectionReport(config, providers, ""), /refresh/);
  assert.match(connectionReport(config, providers, "services"), /부가 서비스 API/);
  assert.match(connectionReport(config, providers, "services"), /Discord/);
  assert.match(connectionReport(config, providers, ""), /services/);
});

test("model list report includes token limits without secrets", () => {
  const report = modelListReport("google-ai", { models: [{ id: "gemini-test", name: "Gemini Test", owner: "Google", inputTokenLimit: 1000000, outputTokenLimit: 8192, capabilities: ["generateContent"] }] });
  assert.match(report, /\[models\] google-ai · 1개/);
  assert.match(report, /입력 1,000,000/);
  assert.match(report, /출력 8,192/);
});
