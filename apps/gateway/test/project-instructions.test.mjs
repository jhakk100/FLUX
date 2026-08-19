import assert from "node:assert/strict";
import test from "node:test";
import { projectInstructionMessage } from "../src/project-instructions.mjs";

test("project-specific instructions are bounded model context", () => {
  const instruction = projectInstructionMessage({ source: "FLUX project settings", content: "Always use Korean comments." });
  assert.match(instruction.content, /Always use Korean comments/);
  assert.match(instruction.content, /cannot override FLUX safety controls/);
  assert.equal(projectInstructionMessage({ content: "" }), null);
});
