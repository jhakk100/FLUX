import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { getAsset, isSea } from "node:sea";
import { loadConfig } from "./config.mjs";
import { openStore } from "./db.mjs";
import { classifyAction, redactSecret, requiresApproval, resolveInsideWorkspace } from "./security.mjs";
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
  if (process.env.HARU_OPEN_BROWSER === "false") return;
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

async function executeApprovedAction(approval, confirmationTarget) {
  if (approval.risk === "R3" && confirmationTarget !== approval.target) {
    const error = new Error("Destructive actions require an exact target confirmation.");
    error.statusCode = 400;
    throw error;
  }
  const payload = approval.payload;
  const project = requireProject(payload.projectId);
  const target = resolveInsideWorkspace(project.workspacePath, payload.relativePath);
  if (approval.action === "create-file") {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, payload.content, { encoding: "utf8", flag: "wx" });
  } else if (approval.action === "modify-file") {
    await fs.writeFile(target, payload.content, "utf8");
  } else if (approval.action === "delete-file") {
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
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
    let fullText = "";
    try {
      for await (const delta of streamCompletion(providerRuntime.get(), messages)) {
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
    const approval = store.decideApproval(approvalMatch[1], body.decision);
    if (!approval) return json(response, 404, { error: "Approval not found." });
    if (body.decision === "rejected") return json(response, 200, { approval });
    const result = await executeApprovedAction(approval, body.confirmTarget);
    return json(response, 200, { approval, result });
  }
  if (url.pathname === "/api/change-requests" && request.method === "POST") {
    const body = await readJson(request);
    const project = requireProject(body.projectId);
    const action = body.action;
    if (!["create-file", "modify-file", "delete-file"].includes(action)) return json(response, 400, { error: "Unsupported change action." });
    if (!body.relativePath || (action !== "delete-file" && typeof body.content !== "string")) return json(response, 400, { error: "relativePath and content are required." });
    const absoluteTarget = resolveInsideWorkspace(project.workspacePath, body.relativePath);
    const risk = classifyAction(action);
    if (!requiresApproval(action)) return json(response, 400, { error: "This endpoint only accepts approval-gated actions." });
    const preview = action === "delete-file" ? `Delete ${body.relativePath}` : `${action} ${body.relativePath}\n\n${body.content.slice(0, 1200)}`;
    const approval = store.createApproval({ action, risk, target: absoluteTarget, preview, payload: { projectId: project.id, relativePath: body.relativePath, content: body.content ?? "" } });
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
  console.log(`Haru Gateway is running at ${gatewayUrl}`);
  console.log(`Provider: ${providerStatus(providerRuntime.get()).provider}`);
  openDashboard(gatewayUrl);
});
