import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.mjs";

test("FLUX environment names take precedence over legacy HARU names", () => {
  const config = loadConfig({
    FLUX_PORT: "4318",
    FLUX_PROVIDER: "ollama",
    FLUX_OLLAMA_MODEL: "local-model",
    HARU_PORT: "9999",
    HARU_PROVIDER: "demo",
  });
  assert.equal(config.port, 4318);
  assert.equal(config.provider, "ollama");
  assert.equal(config.ollama.model, "local-model");
});

test("legacy local configuration remains readable during the rename", () => {
  const config = loadConfig({ HARU_PORT: "4319", HARU_PROVIDER: "demo" });
  assert.equal(config.port, 4319);
  assert.equal(config.provider, "demo");
});
