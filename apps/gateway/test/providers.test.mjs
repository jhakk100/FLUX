import assert from "node:assert/strict";
import test from "node:test";
import { createProviderRuntime, providerStatus, publicProviderSettings, streamCompletion } from "../src/providers.mjs";

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

test("a provider stream accepts a cancellation signal", async () => {
  const controller = new AbortController();
  const stream = streamCompletion(baseConfig, [{ role: "user", content: "long response" }], { signal: controller.signal });
  await stream.next();
  controller.abort();
  await assert.rejects(() => stream.next(), { name: "AbortError" });
});
