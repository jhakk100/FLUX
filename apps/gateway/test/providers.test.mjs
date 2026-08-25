import assert from "node:assert/strict";
import test from "node:test";
import { createProviderRuntime, getStoredProviderSecret, listAvailableModels, providerStatus, publicProviderSettings, resolveSessionProvider, streamCompletion } from "../src/providers.mjs";

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

test("a session model override reuses configured provider credentials without mutating global settings", () => {
  const runtime = createProviderRuntime(baseConfig);
  runtime.configure({ provider: "ollama", ollamaModel: "global-local", factchatApiKey: "school-key", factchatModel: "school-default" });
  const selected = resolveSessionProvider(runtime.get(), { providerOverride: "factchat", modelOverride: "gpt-5-nano" });
  assert.equal(providerStatus(selected).provider, "factchat");
  assert.equal(selected.factchat.model, "gpt-5-nano");
  assert.equal(selected.factchat.apiKey, "school-key");
  assert.equal(runtime.get().ollama.model, "global-local");
  assert.throws(() => resolveSessionProvider(runtime.get(), { providerOverride: "unknown" }), /Unsupported session provider/);
});

test("a saved key can be returned only by the explicit provider-secret accessor", () => {
  const runtime = createProviderRuntime(baseConfig);
  runtime.configure({ provider: "factchat", factchatApiKey: "university-secret", factchatModel: "gpt-5-nano" });
  assert.equal(publicProviderSettings(runtime.get()).factchatApiKeyConfigured, true);
  assert.equal(getStoredProviderSecret(runtime.get(), "factchat").apiKey, "university-secret");
  assert.throws(() => getStoredProviderSecret(runtime.get(), "ollama"), /Unsupported provider secret/);
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

test("Google AI stream keeps final consecutive SSE data records", async () => {
  const originalFetch = globalThis.fetch;
  const first = JSON.stringify({ candidates: [{ content: { parts: [{ text: "TEST_" }] } }] });
  const second = JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] });
  globalThis.fetch = async () => new Response(`data: ${first}\ndata: ${second}`);
  try {
    const runtime = createProviderRuntime(baseConfig);
    runtime.configure({ provider: "google-ai", googleAiModel: "gemini-test", googleAiApiKey: "secret" });
    let text = "";
    for await (const delta of streamCompletion(runtime.get(), [{ role: "user", content: "test" }])) text += delta;
    assert.equal(text, "TEST_OK");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("provider streams ignore an absent optional system message", async () => {
  let text = "";
  for await (const delta of streamCompletion(baseConfig, [null, { role: "user", content: "hello" }])) text += delta;
  assert.match(text, /hello/);
});
test("FactChat stream accepts optional absent messages and emits its response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"FACTCHAT_OK"}}]}\n\ndata: [DONE]\n\n');
  try {
    const runtime = createProviderRuntime(baseConfig);
    runtime.configure({ provider: "factchat", factchatModel: "gpt-5.6-luna", factchatApiKey: "secret" });
    let text = "";
    for await (const delta of streamCompletion(runtime.get(), [null, { role: "user", content: "test" }])) text += delta;
    assert.equal(text, "FACTCHAT_OK");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("Ollama empty responses include safe stream diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: { thinking: "internal reasoning" },
    done: true,
    done_reason: "length",
  }) + "\n");
  try {
    const runtime = createProviderRuntime(baseConfig);
    runtime.configure({ provider: "ollama", ollamaModel: "diagnostic-model" });
    await assert.rejects(async () => {
      for await (const delta of streamCompletion(runtime.get(), [{ role: "user", content: "test" }])) void delta;
    }, /Ollama returned an empty response \(model=diagnostic-model, streamed_events=1, visible_chars=0, thinking_chars=18, done_reason=length\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});