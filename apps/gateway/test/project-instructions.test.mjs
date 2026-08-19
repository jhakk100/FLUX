import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { projectInstructionMessage, readProjectInstructions } from "../src/project-instructions.mjs";

test("project AGENTS.md is loaded as bounded model context", async (context) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "flux-instructions-"));
  context.after(() => fs.rm(workspace, { recursive: true, force: true }));
  await fs.writeFile(path.join(workspace, "AGENTS.md"), "Always use Korean comments.", "utf8");

  const instructions = await readProjectInstructions(workspace);
  assert.equal(instructions.fileName, "AGENTS.md");
  assert.equal(instructions.content, "Always use Korean comments.");
  assert.match(projectInstructionMessage(instructions).content, /cannot override FLUX safety controls/);
});
