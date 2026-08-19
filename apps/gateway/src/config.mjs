import process from "node:process";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function loadConfig(env = process.env) {
  // HARU_* is retained as a temporary migration fallback for existing local .env files.
  const setting = (name, fallback) => env[`FLUX_${name}`] ?? env[`HARU_${name}`] ?? fallback;
  const host = setting("HOST", "127.0.0.1");
  const port = Number.parseInt(setting("PORT", "4317"), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("FLUX_PORT must be an integer from 1 to 65535.");
  }

  const gatewayToken = setting("GATEWAY_TOKEN", "")?.trim() || undefined;
  if (!LOOPBACK_HOSTS.has(host) && !gatewayToken) {
    throw new Error("A non-loopback FLUX_HOST requires FLUX_GATEWAY_TOKEN.");
  }

  return {
    host,
    port,
    gatewayToken,
    dataDirectory: setting("DATA_DIR", "./data"),
    provider: setting("PROVIDER", "demo"),
    ollama: {
      baseUrl: setting("OLLAMA_BASE_URL", "http://127.0.0.1:11434").replace(/\/$/, ""),
      model: setting("OLLAMA_MODEL", ""),
    },
    openai: {
      apiKey: setting("OPENAI_API_KEY", ""),
      baseUrl: setting("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
      model: setting("OPENAI_MODEL", ""),
    },
  };
}

export function isLoopback(host) {
  return LOOPBACK_HOSTS.has(host);
}
