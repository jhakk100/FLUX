import assert from "node:assert/strict";
import test from "node:test";
import { Risk, assertSafeWorkspacePath, classifyAction, isProtectedSystemPath, requiresApproval, resolveInsideWorkspace } from "../src/security.mjs";

test("destructive actions are never automatic", () => {
  assert.equal(classifyAction("delete-file"), Risk.DESTRUCTIVE);
  assert.equal(requiresApproval("delete-file"), true);
});

test("workspace resolver rejects path traversal", () => {
  assert.throws(() => resolveInsideWorkspace("C:/work/project", "../secrets.txt"));
  assert.equal(resolveInsideWorkspace("C:/work/project", "notes/today.md"), "C:\\work\\project\\notes\\today.md");
});

test("protected Windows and Linux operating-system paths cannot become projects or change targets", () => {
  const windows = { platform: "win32", env: { SystemRoot: "C:\\Windows", SystemDrive: "C:", ProgramFiles: "C:\\Program Files", ProgramData: "C:\\ProgramData" } };
  assert.equal(isProtectedSystemPath("C:\\Windows\\System32", windows), true);
  assert.equal(isProtectedSystemPath("C:\\Program Files\\App", windows), true);
  assert.equal(isProtectedSystemPath("C:\\Users\\me\\source\\project", windows), false);
  assert.throws(() => assertSafeWorkspacePath("C:\\Windows", windows), /protected operating-system paths/);
  assert.equal(isProtectedSystemPath("/etc/ssh", { platform: "linux", env: {} }), true);
  assert.equal(isProtectedSystemPath("/home/me/project", { platform: "linux", env: {} }), false);
  assert.throws(() => assertSafeWorkspacePath("/usr/bin", { platform: "linux", env: {} }), /protected operating-system paths/);
});
