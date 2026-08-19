function asConversation(messages) {
  return messages.map((message) => ({ role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user", content: message.content }));
}

const PROVIDERS = new Set(["demo", "ollama", "openai-compatible", "openai-chat-compatible", "factchat", "factchat-responses"]);

function normalizeBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function normalizeContextLength(value) {
  if (value === "" || value === null || typeof value === "undefined") return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1024) throw new Error("Ollama context length must be at least 1024 tokens, or left blank.");
  return parsed;
}

function cloneConfig(config) {
  return {
    provider: config.provider,
    ollama: { ...config.ollama },
    openai: { ...config.openai },
    factchat: { ...config.factchat },
  };
}

export function createProviderRuntime(environmentConfig, persistedConfig) {
  let current = cloneConfig(environmentConfig);
  if (persistedConfig) {
    current = {
      provider: persistedConfig.provider ?? current.provider,
      ollama: { ...current.ollama, ...persistedConfig.ollama },
      openai: { ...current.openai, ...persistedConfig.openai },
      factchat: { ...current.factchat, ...persistedConfig.factchat },
    };
  }

  function configure(input) {
    const provider = input.provider ?? current.provider;
    if (!PROVIDERS.has(provider)) throw new Error("Unsupported provider.");
    const next = cloneConfig(current);
    next.provider = provider;
    next.ollama.baseUrl = normalizeBaseUrl(input.ollamaBaseUrl ?? next.ollama.baseUrl);
    next.ollama.model = String(input.ollamaModel ?? next.ollama.model).trim();
    if (Object.hasOwn(input, "ollamaContextLength")) next.ollama.contextLength = normalizeContextLength(input.ollamaContextLength);
    next.openai.baseUrl = normalizeBaseUrl(input.openaiBaseUrl ?? next.openai.baseUrl);
    next.openai.model = String(input.openaiModel ?? next.openai.model).trim();
    next.factchat.baseUrl = normalizeBaseUrl(input.factchatBaseUrl ?? next.factchat.baseUrl);
    next.factchat.model = String(input.factchatModel ?? next.factchat.model).trim();
    if (input.clearApiKey === true) next.openai.apiKey = "";
    else if (typeof input.apiKey === "string" && input.apiKey.trim()) next.openai.apiKey = input.apiKey.trim();
    if (input.clearFactchatApiKey === true) next.factchat.apiKey = "";
    else if (typeof input.factchatApiKey === "string" && input.factchatApiKey.trim()) next.factchat.apiKey = input.factchatApiKey.trim();
    current = next;
    return cloneConfig(current);
  }

  return { get: () => cloneConfig(current), configure };
}

function requestSignal(signal) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]) : AbortSignal.timeout(10 * 60 * 1000);
}

async function waitForDemoChunk(signal) {
  if (signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, 12);
    signal?.addEventListener("abort", () => { clearTimeout(timeout); reject(new DOMException("Generation cancelled.", "AbortError")); }, { once: true });
  });
}

async function* demoStream(messages, signal) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const response = [
    "현재 FLUX는 demo 모드로 실행 중입니다. ",
    "`.env`에서 Ollama 또는 OpenAI 호환 Responses API를 설정하면 실제 모델 응답으로 바뀝니다.\n\n",
    `받은 요청: ${lastUserMessage}`,
  ].join("");
  for (const part of response.match(/.{1,16}/gu) ?? []) {
    await waitForDemoChunk(signal);
    yield part;
  }
}

async function* ollamaStream(config, messages, signal) {
  if (!config.ollama.model) throw new Error("FLUX_OLLAMA_MODEL is required for the Ollama provider.");
  const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.ollama.model, messages: asConversation(messages), stream: true, ...(config.ollama.contextLength ? { options: { num_ctx: config.ollama.contextLength } } : {}) }),
    signal: requestSignal(signal),
  });
  if (!response.ok || !response.body) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.message?.content) yield event.message.content;
      if (event.error) throw new Error(event.error);
    }
    if (done) break;
  }
}

async function* openAiCompatibleStream(config, messages, signal) {
  if (!config.openai.apiKey) throw new Error("FLUX_OPENAI_API_KEY is required for the OpenAI-compatible provider.");
  if (!config.openai.model) throw new Error("FLUX_OPENAI_MODEL is required for the OpenAI-compatible provider.");
  const response = await fetch(`${config.openai.baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openai.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.openai.model,
      stream: true,
      store: false,
      input: asConversation(messages),
    }),
    signal: requestSignal(signal),
  });
  if (!response.ok || !response.body) throw new Error(`Model provider returned ${response.status}: ${await response.text()}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consumeEvent = function* (rawEvent) {
    const lines = rawEvent.split("\n");
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (eventName === "response.output_text.delta" && event.delta) yield event.delta;
    if (eventName === "error" || event.error) throw new Error(event.error?.message ?? "The model provider returned an error.");
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const rawEvent of events) yield* consumeEvent(rawEvent);
    if (done) break;
  }
}

async function* openAiChatCompatibleStream(config, messages, signal) {
  if (!config.openai.apiKey) throw new Error("API 키를 입력하세요.");
  if (!config.openai.model) throw new Error("모델 이름을 입력하세요.");
  const response = await fetch(`${config.openai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.openai.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: config.openai.model, stream: true, messages: asConversation(messages) }),
    signal: requestSignal(signal),
  });
  if (!response.ok || !response.body) throw new Error(`Model provider returned ${response.status}: ${await response.text()}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const rawEvent of events) {
      const data = rawEvent.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      if (event.error) throw new Error(event.error.message ?? "The model provider returned an error.");
      if (event.choices?.[0]?.delta?.content) yield event.choices[0].delta.content;
    }
    if (done) break;
  }
}

async function* factchatStream(config, messages, signal) {
  if (!config.factchat.apiKey || !config.factchat.model) throw new Error("FactChat API 키와 모델 이름을 입력하세요.");
  const response = await fetch(`${config.factchat.baseUrl}/chat/completions/`, { method: "POST", headers: { authorization: `Bearer ${config.factchat.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: config.factchat.model, stream: true, messages: asConversation(messages) }), signal: requestSignal(signal) });
  if (!response.ok || !response.body) throw new Error(`FactChat returned ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  while (true) { const { done, value } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }); const events = buffer.split("\n\n"); buffer = events.pop() ?? ""; for (const rawEvent of events) { const data = rawEvent.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n"); if (!data || data === "[DONE]") continue; const event = JSON.parse(data); if (event.error) throw new Error(event.error.message ?? "FactChat returned an error."); if (event.choices?.[0]?.delta?.content) yield event.choices[0].delta.content; } if (done) break; }
}

async function* factchatResponsesStream(config, messages, signal) {
  if (!config.factchat.apiKey || !config.factchat.model) throw new Error("FactChat API 키와 Codex 모델 이름을 입력하세요.");
  const response = await fetch(`${config.factchat.baseUrl}/responses/`, { method: "POST", headers: { authorization: `Bearer ${config.factchat.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: config.factchat.model, stream: true, input: asConversation(messages) }), signal: requestSignal(signal) });
  if (!response.ok || !response.body) throw new Error(`FactChat Responses returned ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  while (true) { const { done, value } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }); const events = buffer.split("\n\n"); buffer = events.pop() ?? ""; for (const rawEvent of events) { const lines = rawEvent.split("\n"); const name = lines.find((line) => line.startsWith("event:"))?.slice(6).trim(); const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n"); if (!data || data === "[DONE]") continue; const event = JSON.parse(data); if (name === "response.output_text.delta" && event.delta) yield event.delta; if (name === "error" || event.error) throw new Error(event.error?.message ?? "FactChat Responses returned an error."); } if (done) break; }
}

export function streamCompletion(config, messages, { signal } = {}) {
  if (config.provider === "ollama") return ollamaStream(config, messages, signal);
  if (config.provider === "openai-compatible") return openAiCompatibleStream(config, messages, signal);
  if (config.provider === "openai-chat-compatible") return openAiChatCompatibleStream(config, messages, signal);
  if (config.provider === "factchat") return factchatStream(config, messages, signal);
  if (config.provider === "factchat-responses") return factchatResponsesStream(config, messages, signal);
  return demoStream(messages, signal);
}

export function providerStatus(config) {
  if (config.provider === "ollama") return { provider: "ollama", configured: Boolean(config.ollama.model), model: config.ollama.model || null, baseUrl: config.ollama.baseUrl, contextLength: config.ollama.contextLength ?? null };
  if (["openai-compatible", "openai-chat-compatible"].includes(config.provider)) return { provider: config.provider, configured: Boolean(config.openai.apiKey && config.openai.model), model: config.openai.model || null, baseUrl: config.openai.baseUrl, apiKeyConfigured: Boolean(config.openai.apiKey) };
  if (config.provider === "factchat") return { provider: "factchat", configured: Boolean(config.factchat.apiKey && config.factchat.model), model: config.factchat.model || null, baseUrl: config.factchat.baseUrl, apiKeyConfigured: Boolean(config.factchat.apiKey) };
  if (config.provider === "factchat-responses") return { provider: "factchat-responses", configured: Boolean(config.factchat.apiKey && config.factchat.model), model: config.factchat.model || null, baseUrl: config.factchat.baseUrl, apiKeyConfigured: Boolean(config.factchat.apiKey) };
  return { provider: "demo", configured: true, model: null };
}

export function publicProviderSettings(config) {
  return {
    provider: config.provider,
    ollamaBaseUrl: config.ollama.baseUrl,
    ollamaModel: config.ollama.model,
    ollamaContextLength: config.ollama.contextLength ?? null,
    openaiBaseUrl: config.openai.baseUrl,
    openaiModel: config.openai.model,
    apiKeyConfigured: Boolean(config.openai.apiKey),
    factchatBaseUrl: config.factchat.baseUrl,
    factchatModel: config.factchat.model,
    factchatApiKeyConfigured: Boolean(config.factchat.apiKey),
  };
}

export async function testProviderConnection(config) {
  if (config.provider === "demo") return { ok: true, message: "Demo 모드는 외부 API 연결 없이 바로 사용할 수 있습니다." };
  if (config.provider === "ollama") {
    const response = await fetch(`${config.ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Ollama가 ${response.status} 응답을 반환했습니다.`);
    const payload = await response.json();
    const modelFound = config.ollama.model ? payload.models?.some((model) => model.name === config.ollama.model || model.model === config.ollama.model) : true;
    return { ok: true, message: modelFound ? "Ollama 연결과 모델 확인이 완료되었습니다." : "Ollama에는 연결됐지만 지정한 모델을 찾지 못했습니다. 모델 이름을 확인하세요." };
  }
  if (["factchat", "factchat-responses"].includes(config.provider)) {
    if (!config.factchat.apiKey || !config.factchat.model) throw new Error("FactChat API 키와 모델 이름을 입력한 뒤 저장하세요.");
    const response = await fetch(`${config.factchat.baseUrl}/models/`, { headers: { authorization: `Bearer ${config.factchat.apiKey}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`FactChat API가 ${response.status} 응답을 반환했습니다. 키와 접근 권한을 확인하세요.`);
    return { ok: true, message: "FactChat API 인증과 모델 목록 연결에 성공했습니다." };
  }
  if (!config.openai.apiKey || !config.openai.model) throw new Error("API 키와 모델 이름을 입력한 뒤 저장하세요.");
  const response = await fetch(`${config.openai.baseUrl}/models`, {
    headers: { authorization: `Bearer ${config.openai.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`API 서버가 ${response.status} 응답을 반환했습니다. 주소와 API 키 권한을 확인하세요.`);
  return { ok: true, message: "API 서버 인증에 성공했습니다. 이제 대화에서 응답을 시험할 수 있습니다." };
}

export async function getFactchatAccount(config) {
  if (config.provider !== "factchat") {
    const error = new Error("FactChat account details are available only when the university private API provider is selected.");
    error.statusCode = 409;
    throw error;
  }
  if (!config.factchat.apiKey) {
    const error = new Error("FactChat API 키를 입력하세요.");
    error.statusCode = 400;
    throw error;
  }
  const headers = { authorization: `Bearer ${config.factchat.apiKey}` };
  const [modelsResponse, creditsResponse] = await Promise.all([
    fetch(`${config.factchat.baseUrl}/models/`, { headers, signal: AbortSignal.timeout(10_000) }),
    fetch(`${config.factchat.baseUrl}/credits/`, { headers, signal: AbortSignal.timeout(10_000) }),
  ]);
  if (!modelsResponse.ok) throw new Error(`FactChat model list returned ${modelsResponse.status}.`);
  if (!creditsResponse.ok) throw new Error(`FactChat credits returned ${creditsResponse.status}.`);
  const modelsPayload = await modelsResponse.json();
  const credits = await creditsResponse.json();
  const sourceModels = modelsPayload.data ?? modelsPayload.models ?? [];
  return {
    models: sourceModels.map((model) => ({ id: model.id, name: model.name ?? model.id, ownedBy: model.owned_by ?? model.provider ?? null })).filter((model) => model.id),
    credits: {
      monthlyAllocated: credits.monthly_allocated ?? null,
      purchased: credits.purchased ?? null,
      total: credits.total ?? null,
    },
  };
}
