import assert from "node:assert/strict";
import test from "node:test";
import { buildModelContext, estimateTokens } from "../src/context.mjs";

test("context compaction keeps recent messages and records tags", () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `#flux 작업 ${index} 할 일 코드 `.repeat(40) }));
  const result = buildModelContext(messages, { summary: "", coveredCount: 0, tags: [] }, 1000, 0.5);
  assert.equal(result.shouldCompact, true);
  assert.equal(result.context.coveredCount, 4);
  assert.equal(result.activeMessages.length, 12);
  assert.ok(result.context.tags.includes("flux"));
  assert.ok(estimateTokens("한글") > 0);
});
