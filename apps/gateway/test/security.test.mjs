import assert from "node:assert/strict";
import test from "node:test";
import { Risk, classifyAction, requiresApproval, resolveInsideWorkspace } from "../src/security.mjs";

test("destructive actions are never automatic", () => {
  assert.equal(classifyAction("delete-file"), Risk.DESTRUCTIVE);
  assert.equal(requiresApproval("delete-file"), true);
});

test("workspace resolver rejects path traversal", () => {
  assert.throws(() => resolveInsideWorkspace("C:/work/project", "../secrets.txt"));
  assert.equal(resolveInsideWorkspace("C:/work/project", "notes/today.md"), "C:\\work\\project\\notes\\today.md");
});
