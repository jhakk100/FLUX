function asConversation(messages) {
  return messages.map((message) => ({ role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user", content: message.content }));
}

function imageAttachments(message) {
  return (message.modelAttachments ?? []).filter((attachment) => attachment?.mimeType?.startsWith("image/") && attachment.data);
}

function hasImageAttachments(messages) {
  return messages.some((message) => imageAttachments(message).length > 0);
}

function ollamaConversation(messages) {
  return asConversation(messages).map((message, index) => {
    const images = imageAttachments(messages[index]).map((attachment) => attachment.data);
    return images.length ? { ...message, images } : message;
  });
}

function chatVisionConversation(messages) {
  return asConversation(messages).map((message, index) => {
    const images = imageAttachments(messages[index]);
    if (!images.length || message.role === "system") return message;
    return {
      ...message,
      content: [{ type: "text", text: message.content }, ...images.map((attachment) => ({ type: "image_url", image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` } }))],
    };
  });
}

function responsesConversation(messages) {
  return asConversation(messages).map((message, index) => {
    const images = imageAttachments(messages[index]);
    if (!images.length || message.role === "system") return message;
    return {
      ...message,
      content: [{ type: "input_text", text: message.content }, ...images.map((attachment) => ({ type: "input_image", image_url: `data:${attachment.mimeType};base64,${attachment.data}` }))],
    };
  });
}

const PROVIDERS = new Set(["demo", "ollama", "lm-studio", "openai-compatible", "openai-chat-compatible", "factchat", "factchat-responses", "google-ai"]);

export function resolveSessionProvider(config, { providerOverride = null, modelOverride = null } = {}) {
  const next = cloneConfig(config);
  const provider = providerOverride || next.provider;
  if (!PROVIDERS.has(provider)) throw new Error("Unsupported session provider.");
  const model = String(modelOverride ?? "").trim();
  next.provider = provider;
  if (!model) return next;
  if (provider === "demo") throw new Error("Demo provider does not accept a model override.");
  if (provider === "ollama") next.ollama.model = model;
  else if (provider === "lm-studio") next.lmstudio.model = model;
  else if (["openai-compatible", "openai-chat-compatible"].includes(provider)) next.openai.model = model;
  else if (["factchat", "factchat-responses"].includes(provider)) next.factchat.model = model;
  else if (provider === "google-ai") next.googleAi.model = model.replace(/^models\//, "");
  return next;
}

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
    lmstudio: { ...config.lmstudio },
    openai: { ...config.openai },
    factchat: { ...config.factchat },
    googleAi: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "", apiKey: "", ...config.googleAi },
  };
}

export function createProviderRuntime(environmentConfig, persistedConfig) {
  let current = cloneConfig(environmentConfig);
  if (persistedConfig) {
    current = {
      provider: persistedConfig.provider ?? current.provider,
      ollama: { ...current.ollama, ...persistedConfig.ollama },
      lmstudio: { ...current.lmstudio, ...persistedConfig.lmstudio },
      openai: { ...current.openai, ...persistedConfig.openai },
      factchat: { ...current.factchat, ...persistedConfig.factchat },
      googleAi: { ...current.googleAi, ...persistedConfig.googleAi },
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
    next.lmstudio.baseUrl = normalizeBaseUrl(input.lmStudioBaseUrl ?? next.lmstudio.baseUrl);
    next.lmstudio.model = String(input.lmStudioModel ?? next.lmstudio.model).trim();
    next.openai.baseUrl = normalizeBaseUrl(input.openaiBaseUrl ?? next.openai.baseUrl);
    next.openai.model = String(input.openaiModel ?? next.openai.model).trim();
    next.factchat.baseUrl = normalizeBaseUrl(input.factchatBaseUrl ?? next.factchat.baseUrl);
    next.factchat.model = String(input.factchatModel ?? next.factchat.model).trim();
    next.googleAi.baseUrl = normalizeBaseUrl(input.googleAiBaseUrl ?? next.googleAi.baseUrl);
    next.googleAi.model = String(input.googleAiModel ?? next.googleAi.model).trim().replace(/^models\//, "");
    if (input.clearApiKey === true) next.openai.apiKey = "";
    else if (typeof input.apiKey === "string" && input.apiKey.trim()) next.openai.apiKey = input.apiKey.trim();
    if (input.clearFactchatApiKey === true) next.factchat.apiKey = "";
    else if (typeof input.factchatApiKey === "string" && input.factchatApiKey.trim()) next.factchat.apiKey = input.factchatApiKey.trim();
    if (input.clearLmStudioApiKey === true) next.lmstudio.apiKey = "";
    else if (typeof input.lmStudioApiKey === "string" && input.lmStudioApiKey.trim()) next.lmstudio.apiKey = input.lmStudioApiKey.trim();
    if (input.clearGoogleAiApiKey === true) next.googleAi.apiKey = "";
    else if (typeof input.googleAiApiKey === "string" && input.googleAiApiKey.trim()) next.googleAi.apiKey = input.googleAiApiKey.trim();
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
  if (hasImageAttachments(messages)) {
    // Ollama otherwise accepts the request but text-only models silently ignore
    // the `images` field, which looks like an attachment failure to the user.
    try {
      const inspection = await fetch(`${config.ollama.baseUrl}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: config.ollama.model }),
        signal: requestSignal(signal),
      });
      if (inspection.ok) {
        const details = await inspection.json();
        if (!details.capabilities?.includes("vision")) throw new Error(`Ollama model '${config.ollama.model}' does not support image input. Choose a model marked 'vision' in the model list.`);
      }
    } catch (error) {
      if (error.message?.includes("does not support image input")) throw error;
      // Older Ollama versions may not provide /api/show. Continue so their
      // compatible vision models still receive the standard images payload.
    }
  }
  const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.ollama.model, messages: ollamaConversation(messages), stream: true, ...(config.ollama.contextLength ? { options: { num_ctx: config.ollama.contextLength } } : {}) }),
    signal: requestSignal(signal),
  });
  if (!response.ok || !response.body) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let yieldedContent = false;
  const consumeLine = function* (line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.message?.content) {
      yieldedContent = true;
      yield event.message.content;
    }
    if (event.error) throw new Error(event.error);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) yield* consumeLine(line);
    if (done) {
      // Some Ollama builds finish their JSONL response without a final newline.
      // Process that last record instead of silently dropping the whole answer.
      yield* consumeLine(buffer);
      break;
    }
  }
  if (!yieldedContent) {
    const imageHint = hasImageAttachments(messages)
      ? " The selected model reported vision support but returned no image analysis; try another local vision model or update Ollama."
      : "";
    throw new Error(`Ollama returned an empty response.${imageHint}`);
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
      input: responsesConversation(messages),
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

async function* chatCompatibleStream(connection, messages, signal, { name, apiKeyRequired }) {
  if (apiKeyRequired && !connection.apiKey) throw new Error("API 키를 입력하세요.");
  if (!connection.model) throw new Error("모델 이름을 입력하세요.");
  const response = await fetch(`${connection.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { ...(connection.apiKey ? { authorization: `Bearer ${connection.apiKey}` } : {}), "content-type": "application/json" },
    body: JSON.stringify({ model: connection.model, stream: true, messages: chatVisionConversation(messages) }),
    signal: requestSignal(signal),
  });
  if (!response.ok || !response.body) throw new Error(`${name} returned ${response.status}: ${await response.text()}`);

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

async function* openAiChatCompatibleStream(config, messages, signal) {
  yield* chatCompatibleStream(config.openai, messages, signal, { name: "Model provider", apiKeyRequired: true });
}

async function* lmStudioStream(config, messages, signal) {
  yield* chatCompatibleStream(config.lmstudio, messages, signal, { name: "LM Studio", apiKeyRequired: false });
}

async function* factchatStream(config, messages, signal) {
  if (!config.factchat.apiKey || !config.factchat.model) throw new Error("FactChat API 키와 모델 이름을 입력하세요.");
  const response = await fetch(`${config.factchat.baseUrl}/chat/completions/`, { method: "POST", headers: { authorization: `Bearer ${config.factchat.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: config.factchat.model, stream: true, messages: chatVisionConversation(messages) }), signal: requestSignal(signal) });
  if (!response.ok || !response.body) throw new Error(`FactChat returned ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  while (true) { const { done, value } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }); const events = buffer.split("\n\n"); buffer = events.pop() ?? ""; for (const rawEvent of events) { const data = rawEvent.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n"); if (!data || data === "[DONE]") continue; const event = JSON.parse(data); if (event.error) throw new Error(event.error.message ?? "FactChat returned an error."); if (event.choices?.[0]?.delta?.content) yield event.choices[0].delta.content; } if (done) break; }
}

async function* factchatResponsesStream(config, messages, signal) {
  if (!config.factchat.apiKey || !config.factchat.model) throw new Error("FactChat API 키와 Codex 모델 이름을 입력하세요.");
  const response = await fetch(`${config.factchat.baseUrl}/responses/`, { method: "POST", headers: { authorization: `Bearer ${config.factchat.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: config.factchat.model, stream: true, input: responsesConversation(messages) }), signal: requestSignal(signal) });
  if (!response.ok || !response.body) throw new Error(`FactChat Responses returned ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  while (true) { const { done, value } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }); const events = buffer.split("\n\n"); buffer = events.pop() ?? ""; for (const rawEvent of events) { const lines = rawEvent.split("\n"); const name = lines.find((line) => line.startsWith("event:"))?.slice(6).trim(); const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n"); if (!data || data === "[DONE]") continue; const event = JSON.parse(data); if (name === "response.output_text.delta" && event.delta) yield event.delta; if (name === "error" || event.error) throw new Error(event.error?.message ?? "FactChat Responses returned an error."); } if (done) break; }
}

function geminiPayload(messages) {
  const systemInstruction = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const contents = messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }, ...imageAttachments(message).map((attachment) => ({ inline_data: { mime_type: attachment.mimeType, data: attachment.data } }))],
  }));
  return { ...(systemInstruction ? { system_instruction: { parts: [{ text: systemInstruction }] } } : {}), contents };
}

async function* googleAiStream(config, messages, signal) {
  if (!config.googleAi.apiKey || !config.googleAi.model) throw new Error("Google AI API 키와 Gemini 모델 이름을 입력하세요.");
  const response = await fetch(`${config.googleAi.baseUrl}/models/${encodeURIComponent(config.googleAi.model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "x-goog-api-key": config.googleAi.apiKey, "content-type": "application/json" },
    body: JSON.stringify(geminiPayload(messages)),
    signal: requestSignal(signal),
  });
  if (!response.ok || !response.body) throw new Error(`Google AI returned ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  const consumeEvent = function* (rawEvent) {
    // Gemini can omit blank SSE separators and place several complete JSON
    // payloads on consecutive data: lines. Each line is therefore one event.
    const payloads = rawEvent.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
    for (const data of payloads) {
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      if (event.error) throw new Error(event.error.message ?? "Google AI returned an error.");
      for (const part of event.candidates?.[0]?.content?.parts ?? []) if (part.text) yield part.text;
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
    for (const rawEvent of events) yield* consumeEvent(rawEvent);
    if (done) {
      // Gemini may finish an SSE stream without a final blank separator.
      yield* consumeEvent(buffer);
      break;
    }
  }
}
export function streamCompletion(config, messages, { signal } = {}) {
  if (config.provider === "ollama") return ollamaStream(config, messages, signal);
  if (config.provider === "lm-studio") return lmStudioStream(config, messages, signal);
  if (config.provider === "openai-compatible") return openAiCompatibleStream(config, messages, signal);
  if (config.provider === "openai-chat-compatible") return openAiChatCompatibleStream(config, messages, signal);
  if (config.provider === "factchat") return factchatStream(config, messages, signal);
  if (config.provider === "factchat-responses") return factchatResponsesStream(config, messages, signal);
  if (config.provider === "google-ai") return googleAiStream(config, messages, signal);
  return demoStream(messages, signal);
}

export function providerStatus(config) {
  if (config.provider === "ollama") return { provider: "ollama", configured: Boolean(config.ollama.model), model: config.ollama.model || null, baseUrl: config.ollama.baseUrl, contextLength: config.ollama.contextLength ?? null };
  if (config.provider === "lm-studio") return { provider: "lm-studio", configured: Boolean(config.lmstudio.model), model: config.lmstudio.model || null, baseUrl: config.lmstudio.baseUrl, apiKeyConfigured: Boolean(config.lmstudio.apiKey) };
  if (["openai-compatible", "openai-chat-compatible"].includes(config.provider)) return { provider: config.provider, configured: Boolean(config.openai.apiKey && config.openai.model), model: config.openai.model || null, baseUrl: config.openai.baseUrl, apiKeyConfigured: Boolean(config.openai.apiKey) };
  if (config.provider === "factchat") return { provider: "factchat", configured: Boolean(config.factchat.apiKey && config.factchat.model), model: config.factchat.model || null, baseUrl: config.factchat.baseUrl, apiKeyConfigured: Boolean(config.factchat.apiKey) };
  if (config.provider === "factchat-responses") return { provider: "factchat-responses", configured: Boolean(config.factchat.apiKey && config.factchat.model), model: config.factchat.model || null, baseUrl: config.factchat.baseUrl, apiKeyConfigured: Boolean(config.factchat.apiKey) };
  if (config.provider === "google-ai") return { provider: "google-ai", configured: Boolean(config.googleAi.apiKey && config.googleAi.model), model: config.googleAi.model || null, baseUrl: config.googleAi.baseUrl, apiKeyConfigured: Boolean(config.googleAi.apiKey) };
  return { provider: "demo", configured: true, model: null };
}

export function publicProviderSettings(config) {
  return {
    provider: config.provider,
    ollamaBaseUrl: config.ollama.baseUrl,
    ollamaModel: config.ollama.model,
    ollamaContextLength: config.ollama.contextLength ?? null,
    lmStudioBaseUrl: config.lmstudio.baseUrl,
    lmStudioModel: config.lmstudio.model,
    lmStudioApiKeyConfigured: Boolean(config.lmstudio.apiKey),
    openaiBaseUrl: config.openai.baseUrl,
    openaiModel: config.openai.model,
    apiKeyConfigured: Boolean(config.openai.apiKey),
    factchatBaseUrl: config.factchat.baseUrl,
    factchatModel: config.factchat.model,
    factchatApiKeyConfigured: Boolean(config.factchat.apiKey),
    googleAiBaseUrl: config.googleAi.baseUrl,
    googleAiModel: config.googleAi.model,
    googleAiApiKeyConfigured: Boolean(config.googleAi.apiKey),
  };
}

// Deliberately separate this from publicProviderSettings(): the dashboard only
// asks for a key after the user explicitly presses that provider's "표시" button.
export function getStoredProviderSecret(config, provider) {
  const connections = {
    lmstudio: config.lmstudio,
    "google-ai": config.googleAi,
    openai: config.openai,
    factchat: config.factchat,
  };
  if (!Object.hasOwn(connections, provider)) throw new Error("Unsupported provider secret.");
  return { apiKey: connections[provider]?.apiKey ?? "" };
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
  if (config.provider === "lm-studio") {
    if (!config.lmstudio.model) throw new Error("LM Studio 모델 이름을 입력한 뒤 저장하세요.");
    const response = await fetch(`${config.lmstudio.baseUrl}/models`, { headers: config.lmstudio.apiKey ? { authorization: `Bearer ${config.lmstudio.apiKey}` } : {}, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`LM Studio가 ${response.status} 응답을 반환했습니다. 서버 주소와 모델을 확인하세요.`);
    return { ok: true, message: "LM Studio 연결과 모델 목록 확인에 성공했습니다." };
  }
  if (["factchat", "factchat-responses"].includes(config.provider)) {
    if (!config.factchat.apiKey || !config.factchat.model) throw new Error("FactChat API 키와 모델 이름을 입력한 뒤 저장하세요.");
    const response = await fetch(`${config.factchat.baseUrl}/models/`, { headers: { authorization: `Bearer ${config.factchat.apiKey}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`FactChat API가 ${response.status} 응답을 반환했습니다. 키와 접근 권한을 확인하세요.`);
    return { ok: true, message: "FactChat API 인증과 모델 목록 연결에 성공했습니다." };
  }
  if (config.provider === "google-ai") {
    if (!config.googleAi.apiKey || !config.googleAi.model) throw new Error("Google AI API 키와 Gemini 모델 이름을 입력한 뒤 저장하세요.");
    const response = await fetch(`${config.googleAi.baseUrl}/models/${encodeURIComponent(config.googleAi.model)}`, { headers: { "x-goog-api-key": config.googleAi.apiKey }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Google AI가 ${response.status} 응답을 반환했습니다. API 키와 모델 접근 권한을 확인하세요.`);
    return { ok: true, message: "Google AI 인증과 Gemini 모델 확인에 성공했습니다." };
  }
  if (!config.openai.apiKey || !config.openai.model) throw new Error("API 키와 모델 이름을 입력한 뒤 저장하세요.");
  const response = await fetch(`${config.openai.baseUrl}/models`, {
    headers: { authorization: `Bearer ${config.openai.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`API 서버가 ${response.status} 응답을 반환했습니다. 주소와 API 키 권한을 확인하세요.`);
  return { ok: true, message: "API 서버 인증에 성공했습니다. 이제 대화에서 응답을 시험할 수 있습니다." };
}

function modelRecord(model, fallbackId) {
  const id = model.id ?? model.name ?? fallbackId;
  const inputTokenLimit = model.inputTokenLimit ?? model.input_token_limit ?? model.context_length ?? model.max_context_length ?? null;
  const outputTokenLimit = model.outputTokenLimit ?? model.output_token_limit ?? model.max_output_tokens ?? null;
  const capabilities = model.supportedGenerationMethods ?? model.supported_actions ?? model.capabilities ?? null;
  const inputModalities = model.input_modalities ?? model.inputModalities ?? null;
  const imageInput = Array.isArray(inputModalities)
    ? inputModalities.some((item) => String(item).toLowerCase() === "image") : undefined;
  return {
    id: String(id).replace(/^models\//, ""),
    name: model.displayName ?? model.display_name ?? String(id).replace(/^models\//, ""),
    owner: model.owned_by ?? model.ownedBy ?? model.provider ?? null,
    inputTokenLimit: Number.isFinite(inputTokenLimit) ? inputTokenLimit : null,
    outputTokenLimit: Number.isFinite(outputTokenLimit) ? outputTokenLimit : null,
    capabilities: Array.isArray(capabilities) ? capabilities.filter((item) => typeof item === "string") : [],
    ...(typeof imageInput === "boolean" ? { imageInput } : {}),
  };
}

function requireConfigured(config, connection, name) {
  if (!connection.apiKey && name !== "Ollama") throw new Error(`${name} API 키를 먼저 저장하세요.`);
  if (!connection.baseUrl) throw new Error(`${name} 서버 주소가 비어 있습니다.`);
}

async function fetchModelList(url, headers, signal) {
  const response = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`모델 목록 조회가 ${response.status} 응답을 반환했습니다: ${await response.text()}`);
  return response.json();
}

export async function listAvailableModels(config) {
  if (config.provider === "demo") return { models: [], message: "Demo 모드에는 외부 모델 목록이 없습니다." };
  if (config.provider === "ollama") {
    const payload = await fetchModelList(`${config.ollama.baseUrl}/api/tags`, {});
    const models = await Promise.all((payload.models ?? []).map(async (model) => {
      const fallbackCapabilities = model.details?.families ?? [];
      try {
        const response = await fetch(`${config.ollama.baseUrl}/api/show`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: model.name }), signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("Ollama model details are unavailable.");
        const details = await response.json();
        const capabilities = [...new Set([...fallbackCapabilities, ...(details.capabilities ?? [])])];
        return { ...modelRecord({ id: model.name, displayName: model.name, provider: model.details?.family, capabilities }), imageInput: capabilities.includes("vision") };
      } catch {
        // Show unknown rather than falsely labelling a model text-only when an
        // older or busy Ollama server cannot provide its details.
        return { ...modelRecord({ id: model.name, displayName: model.name, provider: model.details?.family, capabilities: fallbackCapabilities }), imageInput: null };
      }
    }));
    return { models: models.filter((model) => model.id) };
  }
  if (config.provider === "lm-studio") {
    const headers = config.lmstudio.apiKey ? { authorization: `Bearer ${config.lmstudio.apiKey}` } : {};
    let payload;
    try {
      const nativeUrl = new URL(config.lmstudio.baseUrl);
      nativeUrl.pathname = "/api/v1/models";
      payload = await fetchModelList(nativeUrl.toString(), headers);
    } catch {
      payload = await fetchModelList(`${config.lmstudio.baseUrl}/models`, headers);
    }
    return { models: (payload.data ?? payload.models ?? []).map((model) => modelRecord(model)).filter((model) => model.id) };
  }
  if (config.provider === "google-ai") {
    requireConfigured(config, config.googleAi, "Google AI");
    const payload = await fetchModelList(`${config.googleAi.baseUrl}/models`, { "x-goog-api-key": config.googleAi.apiKey });
    return { models: (payload.models ?? []).map((model) => modelRecord(model)).filter((model) => model.id) };
  }
  if (["factchat", "factchat-responses"].includes(config.provider)) {
    requireConfigured(config, config.factchat, "FactChat");
    const headers = { authorization: `Bearer ${config.factchat.apiKey}` };
    const [modelsResult, creditsResult] = await Promise.allSettled([
      fetchModelList(`${config.factchat.baseUrl}/models/`, headers),
      fetchModelList(`${config.factchat.baseUrl}/credits/`, headers),
    ]);
    if (modelsResult.status === "rejected") throw modelsResult.reason;
    const credits = creditsResult.status === "fulfilled" ? creditsResult.value : null;
    const usage = credits && Object.values(credits).some((value) => value !== null && value !== undefined)
      ? { monthlyAllocated: credits.monthly_allocated ?? null, purchased: credits.purchased ?? null, total: credits.total ?? null }
      : null;
    return { models: (modelsResult.value.data ?? modelsResult.value.models ?? []).map((model) => modelRecord(model)).filter((model) => model.id), usage };
  }
  requireConfigured(config, config.openai, "API");
  const payload = await fetchModelList(`${config.openai.baseUrl}/models`, { authorization: `Bearer ${config.openai.apiKey}` });
  return { models: (payload.data ?? payload.models ?? []).map((model) => modelRecord(model)).filter((model) => model.id) };
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
