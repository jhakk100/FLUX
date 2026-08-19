import assert from "node:assert/strict";
import test from "node:test";
import { createProviderRuntime, listAvailableModels, providerStatus, publicProviderSettings, streamCompletion } from "../src/providers.mjs";

const baseConfig = {
  provider: "demo",
  ollama: { baseUrl: "http://127.0.0.1:11434", model: "" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "", apiKey: "" },
};

test("provider settings retain the key locally but never return it to the UI", () => {
  const runtime = createProviderRuntime(baseConfig);
  runtime.configure({
    provider: "openai-chat-compatible",
    openaiBaseUrl: "https://school.example/v1/",
    openaiModel: "school-model",
    apiKey: "secret-api-key",
  });

  const config = runtime.get();
  assert.equal(config.openai.apiKey, "secret-api-key");
  assert.equal(providerStatus(config).configured, true);
  assert.equal(JSON.stringify(publicProviderSettings(config)).includes("secret-api-key"), false);
  assert.equal(config.openai.baseUrl, "https://school.example/v1");
});

test("an empty API key leaves an existing saved key intact until explicitly cleared", () => {
  const runtime = createProviderRuntime(baseConfig);
  runtime.configure({ provider: "openai-compatible", apiKey: "keep-me", openaiModel: "model" });
  runtime.configure({ provider: "openai-compatible", apiKey: "" });
  assert.equal(runtime.get().openai.apiKey, "keep-me");
  runtime.configure({ provider: "openai-compatible", clearApiKey: true });
  assert.equal(runtime.get().openai.apiKey, "");
});

test("Ollama context length is retained separately from FLUX compaction settings", () => {
  const runtime = createProviderRuntime(baseConfig);
  runtime.configure({ provider: "ollama", ollamaModel: "llama", ollamaContextLength: "32768" });
  assert.equal(runtime.get().ollama.contextLength, 32768);
  assert.equal(publicProviderSettings(runtime.get()).ollamaContextLength, 32768);
  runtime.configure({ ollamaContextLength: "" });
  assert.equal(runtime.get().ollama.contextLength, null);
});

test("LM Studio can be configured without a local API key", () => {
  const runtime = createProviderRuntime({ ...baseConfig, lmstudio: { baseUrl: "http://127.0.0.1:1234/v1", model: "", apiKey: "" } });
  runtime.configure({ provider: "lm-studio", lmStudioModel: "local-model" });
  assert.equal(providerStatus(runtime.get()).configured, true);
  assert.equal(publicProviderSettings(runtime.get()).lmStudioApiKeyConfigured, false);
});

test("Google AI settings keep the Gemini key local and expose only its presence", () => {
  const runtime = createProviderRuntime(baseConfig);
  runtime.configure({ provider: "google-ai", googleAiModel: "gemini-2.5-flash", googleAiApiKey: "gemini-secret" });
  const config = runtime.get();
  assert.equal(providerStatus(config).configured, true);
  assert.equal(config.googleAi.apiKey, "gemini-secret");
  assert.equal(publicProviderSettings(config).googleAiApiKeyConfigured, true);
  assert.equal(JSON.stringify(publicProviderSettings(config)).includes("gemini-secret"), false);
});

test("Google AI model lookup returns supported token limits without exposing the API key", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => ({ ok: true, json: async () => ({ models: [{ name: "models/gemini-test", displayName: "Gemini Test", inputTokenLimit: 100000, outputTokenLimit: 8192, supportedGenerationMethods: ["generateContent"] }] }) });
  try {
    const runtime = createProviderRuntime(baseConfig);
    runtime.configure({ provider: "google-ai", googleAiModel: "gemini-test", googleAiApiKey: "secret" });
    const result = await listAvailableModels(runtime.get());
    assert.deepEqual(result.models[0], { id: "gemini-test", name: "Gemini Test", owner: null, inputTokenLimit: 100000, outputTokenLimit: 8192, capabilities: ["generateContent"] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a provider stream accepts a cancellation signal", async () => {
  const controller = new AbortController();
  const stream = streamCompletion(baseConfig, [{ role: "user", content: "long response" }], { signal: controller.signal });
  await stream.next();
  controller.abort();
  await assert.rejects(() => stream.next(), { name: "AbortError" });
});
