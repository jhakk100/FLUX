import process from "node:process";
import os from "node:os";
import path from "node:path";
import { isSea } from "node:sea";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function previousPlatformDataDirectory(env) {
  if (process.platform === "win32") return path.join(env.LOCALAPPDATA || path.join(env.USERPROFILE || os.homedir(), "AppData", "Local"), "FLUX", "data");
  return path.join(env.XDG_STATE_HOME || path.join(env.HOME || os.homedir(), ".local", "state"), "flux", "data");
}

function portableRootDirectory() {
  if (!isSea()) return process.cwd();
  const executableDirectory = path.dirname(process.execPath);
  return path.basename(executableDirectory).toLowerCase() === "dist" ? path.dirname(executableDirectory) : executableDirectory;
}

function defaultDataDirectory() {
  return path.join(portableRootDirectory(), "user-data");
}

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
  const contextTokenBudget = Number.parseInt(setting("CONTEXT_TOKEN_BUDGET", "24000"), 10);
  const contextCompactThreshold = Number.parseFloat(setting("CONTEXT_COMPACT_THRESHOLD", "0.75"));
  if (!Number.isInteger(contextTokenBudget) || contextTokenBudget < 1000) throw new Error("FLUX_CONTEXT_TOKEN_BUDGET must be at least 1000.");
  if (!Number.isFinite(contextCompactThreshold) || contextCompactThreshold <= 0 || contextCompactThreshold >= 1) throw new Error("FLUX_CONTEXT_COMPACT_THRESHOLD must be between 0 and 1.");
  const ollamaContextLengthText = setting("OLLAMA_CONTEXT_LENGTH", "").trim();
  const ollamaContextLength = ollamaContextLengthText ? Number.parseInt(ollamaContextLengthText, 10) : null;
  if (ollamaContextLength !== null && (!Number.isInteger(ollamaContextLength) || ollamaContextLength < 1024)) throw new Error("FLUX_OLLAMA_CONTEXT_LENGTH must be at least 1024 when set.");

  return {
    host,
    port,
    gatewayToken,
    // Keep all user-owned state beside FLUX so copying the folder keeps its history.
    dataDirectory: setting("DATA_DIR", defaultDataDirectory()),
    legacyDataDirectories: [
      path.resolve(process.cwd(), "data"),
      path.join(path.dirname(process.execPath), "data"),
      previousPlatformDataDirectory(env),
    ],
    contextTokenBudget,
    contextCompactThreshold,
    provider: setting("PROVIDER", "demo"),
    ollama: {
      baseUrl: setting("OLLAMA_BASE_URL", "http://127.0.0.1:11434").replace(/\/$/, ""),
      model: setting("OLLAMA_MODEL", ""),
      contextLength: ollamaContextLength,
    },
    lmstudio: {
      baseUrl: setting("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1").replace(/\/$/, ""),
      model: setting("LMSTUDIO_MODEL", ""),
      apiKey: setting("LMSTUDIO_API_KEY", ""),
    },
    openai: {
      apiKey: setting("OPENAI_API_KEY", ""),
      baseUrl: setting("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
      model: setting("OPENAI_MODEL", ""),
    },
    factchat: {
      apiKey: setting("FACTCHAT_API_KEY", ""),
      baseUrl: setting("FACTCHAT_BASE_URL", "https://factchat-cloud.mindlogic.ai/v1/gateway").replace(/\/$/, ""),
      model: setting("FACTCHAT_MODEL", ""),
    },
    googleAi: {
      apiKey: setting("GOOGLE_AI_API_KEY", ""),
      baseUrl: setting("GOOGLE_AI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
      model: setting("GOOGLE_AI_MODEL", ""),
    },
    discord: {
      token: setting("DISCORD_BOT_TOKEN", "").trim(),
      // A bot never becomes public merely because its token was set.
      allowedUserIds: setting("DISCORD_ALLOWED_USER_IDS", "").split(",").map((value) => value.trim()).filter(Boolean),
      allowedChannelIds: setting("DISCORD_ALLOWED_CHANNEL_IDS", "").split(",").map((value) => value.trim()).filter(Boolean),
    },
    notion: {
      apiKey: setting("NOTION_API_KEY", "").trim(),
      apiVersion: setting("NOTION_API_VERSION", "2026-03-11").trim(),
      contextPageIds: setting("NOTION_CONTEXT_PAGE_IDS", "").split(",").map((value) => value.trim()).filter(Boolean),
    },
  };
}

export function isLoopback(host) {
  return LOOPBACK_HOSTS.has(host);
}
