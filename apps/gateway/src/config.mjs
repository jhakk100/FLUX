import process from "node:process";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function loadConfig(env = process.env) {
  const host = env.HARU_HOST ?? "127.0.0.1";
  const port = Number.parseInt(env.HARU_PORT ?? "4317", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("HARU_PORT must be an integer from 1 to 65535.");
  }

  const gatewayToken = env.HARU_GATEWAY_TOKEN?.trim() || undefined;
  if (!LOOPBACK_HOSTS.has(host) && !gatewayToken) {
    throw new Error("A non-loopback HARU_HOST requires HARU_GATEWAY_TOKEN.");
  }

  return {
    host,
    port,
    gatewayToken,
    dataDirectory: env.HARU_DATA_DIR ?? "./data",
    provider: env.HARU_PROVIDER ?? "demo",
    ollama: {
      baseUrl: (env.HARU_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, ""),
      model: env.HARU_OLLAMA_MODEL ?? "",
    },
    openai: {
      apiKey: env.HARU_OPENAI_API_KEY ?? "",
      baseUrl: (env.HARU_OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      model: env.HARU_OPENAI_MODEL ?? "",
    },
  };
}

export function isLoopback(host) {
  return LOOPBACK_HOSTS.has(host);
}
