import path from "node:path";

export const Risk = Object.freeze({
  READ: "R0",
  REVERSIBLE: "R1",
  CHANGE: "R2",
  DESTRUCTIVE: "R3",
});

export const FileApprovalMode = Object.freeze({
  GLOBAL: "global",
  AGENT: "agent",
  ASK: "ask",
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

export function isFileApprovalMode(value) {
  return Object.values(FileApprovalMode).includes(value);
}

export function requiresInteractiveFileApproval(action, mode = FileApprovalMode.ASK) {
  const risk = classifyAction(action);
  // No policy can silently delete a file. The operating-system path guard applies before this point.
  if (risk === Risk.DESTRUCTIVE) return true;
  if (mode === FileApprovalMode.GLOBAL) return false;
  if (mode === FileApprovalMode.AGENT) return risk !== Risk.REVERSIBLE;
  return requiresApproval(action);
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

function pathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function isInside(root, candidate, platform) {
  const api = pathApi(platform);
  const normalizedRoot = api.resolve(root);
  const normalizedCandidate = api.resolve(candidate);
  const compare = platform === "win32" ? (value) => value.toLowerCase() : (value) => value;
  const relative = api.relative(compare(normalizedRoot), compare(normalizedCandidate));
  return relative === "" || (!relative.startsWith("..") && !api.isAbsolute(relative));
}

export function isProtectedSystemPath(candidate, { platform = process.platform, env = process.env } = {}) {
  const api = pathApi(platform);
  const target = api.resolve(candidate);
  if (platform === "win32") {
    const systemRoot = env.SystemRoot || env.windir || "C:\\Windows";
    const systemDrive = env.SystemDrive || api.parse(systemRoot).root;
    if (target.toLowerCase() === api.resolve(systemDrive).toLowerCase()) return true;
    const protectedRoots = [systemRoot, env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramData].filter(Boolean);
    return protectedRoots.some((root) => isInside(root, target, platform));
  }
  const protectedRoots = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var"];
  return protectedRoots.some((root) => isInside(root, target, platform)) || target === "/";
}

export function assertSafeWorkspacePath(candidate, options) {
  if (isProtectedSystemPath(candidate, options)) throw new Error("FLUX blocks projects and file changes inside protected operating-system paths.");
  return candidate;
}

export function redactSecret(value) {
  if (typeof value !== "string") return value;
  return value.replace(/(sk-[A-Za-z0-9_-]{8,}|Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}
