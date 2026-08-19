import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { getAsset, isSea } from "node:sea";
import { loadConfig } from "./config.mjs";
import { openStore } from "./db.mjs";
import { classifyAction, redactSecret, requiresApproval, resolveInsideWorkspace } from "./security.mjs";
import { projectInstructionMessage, readProjectInstructions } from "./project-instructions.mjs";
import { createProviderRuntime, providerStatus, publicProviderSettings, streamCompletion, testProviderConnection } from "./providers.mjs";

const config = loadConfig();
const store = openStore(config.dataDirectory);
const providerRuntime = createProviderRuntime(config, store.getSetting("provider-config"));
const dashboardPath = path.resolve(process.cwd(), "apps/dashboard/index.html");

async function loadDashboard() {
  if (isSea()) return getAsset("dashboard.html", "utf8");
  return fs.readFile(dashboardPath, "utf8");
}

function openDashboard(url) {
  if ((process.env.FLUX_OPEN_BROWSER ?? process.env.HARU_OPEN_BROWSER) === "false") return;
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, { windowsHide: true }, () => {});
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function sse(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function isAuthorized(request) {
  if (!config.gatewayToken) return true;
  return request.headers.authorization === `Bearer ${config.gatewayToken}`;
}

function requireProject(projectId) {
  const project = store.getProject(projectId);
  if (!project) {
    const error = new Error("Project not found.");
    error.statusCode = 404;
    throw error;
  }
  return project;
}

const MAX_READ_BYTES = 256 * 1024;
const HIDDEN_WORKSPACE_ENTRIES = new Set([".git", ".flux-trash", "node_modules"]);

function requestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw requestError("Requested path escapes the project workspace.", 400);
}

async function resolveExistingWorkspacePath(project, relativePath) {
  const requested = resolveInsideWorkspace(project.workspacePath, relativePath);
  const root = await fs.realpath(project.workspacePath);
  const target = await fs.realpath(requested);
  assertWithin(root, target);
  return target;
}

async function resolveNewWorkspacePath(project, relativePath) {
  const target = resolveInsideWorkspace(project.workspacePath, relativePath);
  const root = await fs.realpath(project.workspacePath);
  let ancestor = path.dirname(target);
  while (true) {
    try {
      const realAncestor = await fs.realpath(ancestor);
      assertWithin(root, realAncestor);
      return target;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw requestError("Unable to resolve a safe project path.");
      ancestor = parent;
    }
  }
}

async function readTextFile(target) {
  const metadata = await fs.lstat(target);
  if (!metadata.isFile()) throw requestError("Only regular text files can be opened or changed.");
  if (metadata.size > MAX_READ_BYTES) throw requestError(`Files larger than ${MAX_READ_BYTES / 1024} KiB cannot be opened in this prototype.`, 413);
  const bytes = await fs.readFile(target);
  if (bytes.includes(0)) throw requestError("Binary files cannot be opened or changed as text.", 415);
  return { content: bytes.toString("utf8"), size: metadata.size };
}

function contentHash(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function makeDiffPreview(relativePath, before, after) {
  const limit = 3200;
  const clip = (value) => value.length > limit ? `${value.slice(0, limit)}\n… (preview truncated)` : value;
  return [
    `--- before: ${relativePath}`,
    `+++ after: ${relativePath}`,
    "@@ approval preview @@",
    ...clip(before).split("\n").map((line) => `- ${line}`),
    ...clip(after).split("\n").map((line) => `+ ${line}`),
  ].join("\n");
}

async function executeApprovedAction(approval, confirmationTarget) {
  if (approval.risk === "R3" && confirmationTarget !== approval.target) {
    const error = new Error("Destructive actions require an exact target confirmation.");
    error.statusCode = 400;
    throw error;
  }
  const payload = approval.payload;
  const project = requireProject(payload.projectId);
  const target = approval.action === "create-file"
    ? await resolveNewWorkspacePath(project, payload.relativePath)
    : await resolveExistingWorkspacePath(project, payload.relativePath);
  if (approval.action === "create-file") {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, payload.content, { encoding: "utf8", flag: "wx" });
  } else if (approval.action === "modify-file") {
    const current = await readTextFile(target);
    if (contentHash(current.content) !== payload.expectedHash) throw requestError("The file changed after this approval was requested. Create a new preview before applying it.", 409);
    await fs.writeFile(target, payload.content, "utf8");
  } else if (approval.action === "delete-file") {
    const current = await readTextFile(target);
    if (contentHash(current.content) !== payload.expectedHash) throw requestError("The file changed after this approval was requested. Review it again before deleting.", 409);
    await fs.rm(target, { force: false });
  } else {
    const error = new Error(`Unsupported approved action: ${approval.action}`);
    error.statusCode = 400;
    throw error;
  }
  return { action: approval.action, target };
}

async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") {
    return json(response, 200, { ok: true, provider: providerStatus(providerRuntime.get()), host: config.host, port: config.port });
  }
  if (url.pathname === "/" && request.method === "GET") {
    const dashboard = await loadDashboard();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return response.end(dashboard);
  }
  if (!url.pathname.startsWith("/api/")) return json(response, 404, { error: "Not found." });
  if (!isAuthorized(request)) return json(response, 401, { error: "Missing or invalid gateway token." });

  if (url.pathname === "/api/overview" && request.method === "GET") {
    return json(response, 200, { provider: providerStatus(providerRuntime.get()), projects: store.listProjects(), sessions: store.listSessions(), approvals: store.listApprovals(), audit: store.listAuditEvents(30) });
  }
  if (url.pathname === "/api/provider-settings" && request.method === "GET") return json(response, 200, publicProviderSettings(providerRuntime.get()));
  if (url.pathname === "/api/provider-settings" && request.method === "POST") {
    const body = await readJson(request);
    const nextConfig = providerRuntime.configure(body);
    store.setSetting("provider-config", nextConfig);
    return json(response, 200, publicProviderSettings(nextConfig));
  }
  if (url.pathname === "/api/provider-settings/test" && request.method === "POST") {
    const result = await testProviderConnection(providerRuntime.get());
    return json(response, 200, result);
  }
  if (url.pathname === "/api/projects" && request.method === "GET") return json(response, 200, store.listProjects());
  if (url.pathname === "/api/projects" && request.method === "POST") {
    const body = await readJson(request);
    if (!body.name?.trim() || !body.workspacePath?.trim()) return json(response, 400, { error: "name and workspacePath are required." });
    const workspacePath = path.resolve(body.workspacePath);
    await fs.mkdir(workspacePath, { recursive: true });
    return json(response, 201, store.createProject({ name: body.name.trim(), workspacePath }));
  }
  const projectFilesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files$/);
  if (projectFilesMatch && request.method === "GET") {
    const project = requireProject(projectFilesMatch[1]);
    const relativePath = url.searchParams.get("path") || ".";
    const directory = await resolveExistingWorkspacePath(project, relativePath);
    const metadata = await fs.lstat(directory);
    if (!metadata.isDirectory()) throw requestError("The requested path is not a directory.");
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => !HIDDEN_WORKSPACE_ENTRIES.has(entry.name))
      .map(async (entry) => {
        const absolutePath = path.join(directory, entry.name);
        const info = await fs.lstat(absolutePath);
        return {
          name: entry.name,
          path: path.relative(await fs.realpath(project.workspacePath), absolutePath) || ".",
          kind: info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
          size: info.isFile() ? info.size : null,
        };
      }));
    files.sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
    return json(response, 200, { path: path.relative(await fs.realpath(project.workspacePath), directory) || ".", entries: files });
  }
  const projectFileMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/file$/);
  if (projectFileMatch && request.method === "GET") {
    const project = requireProject(projectFileMatch[1]);
    const relativePath = url.searchParams.get("path");
    if (!relativePath) throw requestError("path is required.");
    const target = await resolveExistingWorkspacePath(project, relativePath);
    const file = await readTextFile(target);
    return json(response, 200, { path: path.relative(await fs.realpath(project.workspacePath), target), ...file, hash: contentHash(file.content) });
  }
  const projectInstructionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/instructions$/);
  if (projectInstructionsMatch && request.method === "GET") {
    const project = requireProject(projectInstructionsMatch[1]);
    return json(response, 200, await readProjectInstructions(project.workspacePath));
  }
  if (url.pathname === "/api/sessions" && request.method === "GET") return json(response, 200, store.listSessions());
  if (url.pathname === "/api/sessions" && request.method === "POST") {
    const body = await readJson(request);
    return json(response, 201, store.createSession({ projectId: body.projectId ?? null, title: body.title?.trim() || "새 대화", source: body.source ?? "web" }));
  }
  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (sessionMatch && request.method === "GET") {
    if (!store.getSession(sessionMatch[1])) return json(response, 404, { error: "Session not found." });
    return json(response, 200, store.listMessages(sessionMatch[1]));
  }
  if (url.pathname === "/api/chat" && request.method === "POST") {
    const body = await readJson(request);
    const session = store.getSession(body.sessionId);
    if (!session || !body.content?.trim()) return json(response, 400, { error: "A valid sessionId and content are required." });
    store.addMessage({ sessionId: session.id, role: "user", content: body.content.trim() });
    const messages = store.listMessages(session.id);
    const project = session.projectId ? requireProject(session.projectId) : null;
    const instruction = project ? projectInstructionMessage(await readProjectInstructions(project.workspacePath)) : null;
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
    let fullText = "";
    try {
      for await (const delta of streamCompletion(providerRuntime.get(), instruction ? [instruction, ...messages] : messages)) {
        fullText += delta;
        sse(response, "delta", { text: delta });
      }
      const assistantMessage = store.addMessage({ sessionId: session.id, role: "assistant", content: fullText });
      sse(response, "done", { message: assistantMessage });
    } catch (error) {
      sse(response, "error", { error: redactSecret(error.message) });
    }
    return response.end();
  }
  if (url.pathname === "/api/approvals" && request.method === "GET") return json(response, 200, store.listApprovals());
  const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
  if (approvalMatch && request.method === "POST") {
    const body = await readJson(request);
    if (!["approved", "rejected"].includes(body.decision)) return json(response, 400, { error: "decision must be approved or rejected." });
    if (body.decision === "rejected") {
      const approval = store.decideApproval(approvalMatch[1], body.decision);
      if (!approval) return json(response, 404, { error: "Approval not found." });
      return json(response, 200, { approval });
    }
    const pendingApproval = store.getApproval(approvalMatch[1]);
    if (!pendingApproval) return json(response, 404, { error: "Approval not found." });
    if (pendingApproval.status !== "pending") throw requestError("This approval was already decided.", 409);
    // Mark an approval as completed only after the guarded side effect succeeds.
    const result = await executeApprovedAction(pendingApproval, body.confirmTarget);
    const approval = store.decideApproval(pendingApproval.id, "approved");
    return json(response, 200, { approval, result });
  }
  if (url.pathname === "/api/change-requests" && request.method === "POST") {
    const body = await readJson(request);
    const project = requireProject(body.projectId);
    const action = body.action;
    if (!["create-file", "modify-file", "delete-file"].includes(action)) return json(response, 400, { error: "Unsupported change action." });
    if (!body.relativePath || (action !== "delete-file" && typeof body.content !== "string")) return json(response, 400, { error: "relativePath and content are required." });
    const absoluteTarget = action === "create-file"
      ? await resolveNewWorkspacePath(project, body.relativePath)
      : await resolveExistingWorkspacePath(project, body.relativePath);
    if (action === "create-file") {
      try {
        await fs.lstat(absoluteTarget);
        throw requestError("The target already exists. Request a modification instead.", 409);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const current = action === "create-file" ? { content: "" } : await readTextFile(absoluteTarget);
    const risk = classifyAction(action);
    if (!requiresApproval(action)) return json(response, 400, { error: "This endpoint only accepts approval-gated actions." });
    const preview = action === "delete-file"
      ? `Delete ${body.relativePath}\n\n${makeDiffPreview(body.relativePath, current.content, "")}`
      : makeDiffPreview(body.relativePath, current.content, body.content);
    const approval = store.createApproval({
      action,
      risk,
      target: absoluteTarget,
      preview,
      payload: { projectId: project.id, relativePath: body.relativePath, content: body.content ?? "", expectedHash: action === "create-file" ? null : contentHash(current.content) },
    });
    return json(response, 202, approval);
  }
  if (url.pathname === "/api/audit" && request.method === "GET") return json(response, 200, store.listAuditEvents(100));
  return json(response, 404, { error: "Not found." });
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => json(response, error.statusCode ?? 500, { error: redactSecret(error.message ?? "Unexpected server error.") }));
});

server.listen(config.port, config.host, () => {
  const gatewayUrl = `http://${config.host}:${config.port}`;
  console.log(`FLUX Gateway is running at ${gatewayUrl}`);
  console.log(`Provider: ${providerStatus(providerRuntime.get()).provider}`);
  openDashboard(gatewayUrl);
});
