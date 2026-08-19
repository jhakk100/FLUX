import assert from "node:assert/strict";
import test from "node:test";
import { FileApprovalMode, Risk, assertSafeWorkspacePath, classifyAction, isProtectedSystemPath, requiresApproval, requiresInteractiveFileApproval, resolveInsideWorkspace } from "../src/security.mjs";

test("destructive actions are never automatic", () => {
  assert.equal(classifyAction("delete-file"), Risk.DESTRUCTIVE);
  assert.equal(requiresApproval("delete-file"), true);
});

test("workspace resolver rejects path traversal", () => {
  assert.throws(() => resolveInsideWorkspace("C:/work/project", "../secrets.txt"));
  assert.equal(resolveInsideWorkspace("C:/work/project", "notes/today.md"), "C:\\work\\project\\notes\\today.md");
});

test("file approval modes never silently delete files", () => {
  assert.equal(requiresInteractiveFileApproval("create-file", FileApprovalMode.GLOBAL), false);
  assert.equal(requiresInteractiveFileApproval("modify-file", FileApprovalMode.GLOBAL), false);
  assert.equal(requiresInteractiveFileApproval("create-file", FileApprovalMode.AGENT), false);
  assert.equal(requiresInteractiveFileApproval("modify-file", FileApprovalMode.AGENT), true);
  assert.equal(requiresInteractiveFileApproval("create-file", FileApprovalMode.ASK), true);
  assert.equal(requiresInteractiveFileApproval("delete-file", FileApprovalMode.GLOBAL), true);
  assert.equal(requiresInteractiveFileApproval("delete-file", FileApprovalMode.AGENT), true);
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
