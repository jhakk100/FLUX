import path from "node:path";

export const Risk = Object.freeze({
  READ: "R0",
  REVERSIBLE: "R1",
  CHANGE: "R2",
  DESTRUCTIVE: "R3",
});

const RISK_BY_ACTION = Object.freeze({
  "read-file": Risk.READ,
  "list-files": Risk.READ,
  "create-file": Risk.REVERSIBLE,
  "modify-file": Risk.CHANGE,
  "run-command": Risk.CHANGE,
  "send-discord": Risk.CHANGE,
  "delete-file": Risk.DESTRUCTIVE,
  "overwrite-file": Risk.DESTRUCTIVE,
  "external-submit": Risk.DESTRUCTIVE,
  "git-push": Risk.DESTRUCTIVE,
});

export function classifyAction(action) {
  return RISK_BY_ACTION[action] ?? Risk.DESTRUCTIVE;
}

export function requiresApproval(action) {
  return classifyAction(action) !== Risk.READ;
}

export function resolveInsideWorkspace(workspacePath, requestedPath = ".") {
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, requestedPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Requested path escapes the project workspace.");
  }
  return target;
}

export function redactSecret(value) {
  if (typeof value !== "string") return value;
  return value.replace(/(sk-[A-Za-z0-9_-]{8,}|Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}
