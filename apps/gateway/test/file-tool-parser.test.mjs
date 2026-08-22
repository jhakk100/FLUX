import assert from "node:assert/strict";
import test from "node:test";
import { parseFileToolCalls } from "../src/file-tool-parser.mjs";

test("file tool parser accepts complete tool-only responses", () => {
  assert.deepEqual(parseFileToolCalls('<flux-tool>{"action":"list-files","path":"src"}</flux-tool>'), [{ action: "list-files", path: "src" }]);
  assert.deepEqual(parseFileToolCalls('<flux-tool>{"action":"read-file","path":"README.md"}'), [{ action: "read-file", path: "README.md" }]);
});

test("file tool parser treats prose and quoted tool syntax as ordinary provider output", () => {
  assert.deepEqual(parseFileToolCalls('답변 예시: <flux-tool>{"action":"list-files","path":"src"}</flux-tool>'), []);
  assert.deepEqual(parseFileToolCalls('`<flux-tool>{"action":"read-file","path":"a.txt"}</flux-tool>`'), []);
  assert.deepEqual(parseFileToolCalls('일반 Gemini 답변입니다.'), []);
});