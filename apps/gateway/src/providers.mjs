function asConversation(messages) {
  return messages.map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }));
}

async function* demoStream(messages) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const response = [
    "현재 Haru는 demo 모드로 실행 중입니다. ",
    "`.env`에서 Ollama 또는 OpenAI 호환 Responses API를 설정하면 실제 모델 응답으로 바뀝니다.\n\n",
    `받은 요청: ${lastUserMessage}`,
  ].join("");
  for (const part of response.match(/.{1,16}/gu) ?? []) {
    await new Promise((resolve) => setTimeout(resolve, 12));
    yield part;
  }
}

async function* ollamaStream(config, messages) {
  if (!config.ollama.model) throw new Error("HARU_OLLAMA_MODEL is required for the Ollama provider.");
  const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.ollama.model, messages: asConversation(messages), stream: true }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
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

async function* openAiCompatibleStream(config, messages) {
  if (!config.openai.apiKey) throw new Error("HARU_OPENAI_API_KEY is required for the OpenAI-compatible provider.");
  if (!config.openai.model) throw new Error("HARU_OPENAI_MODEL is required for the OpenAI-compatible provider.");
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
    signal: AbortSignal.timeout(10 * 60 * 1000),
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

export function streamCompletion(config, messages) {
  if (config.provider === "ollama") return ollamaStream(config, messages);
  if (config.provider === "openai-compatible") return openAiCompatibleStream(config, messages);
  return demoStream(messages);
}

export function providerStatus(config) {
  if (config.provider === "ollama") return { provider: "ollama", configured: Boolean(config.ollama.model), model: config.ollama.model || null };
  if (config.provider === "openai-compatible") return { provider: "openai-compatible", configured: Boolean(config.openai.apiKey && config.openai.model), model: config.openai.model || null };
  return { provider: "demo", configured: true, model: null };
}
