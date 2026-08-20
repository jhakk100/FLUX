import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { buildModelContext } from "../../gateway/src/context.mjs";
import { streamCompletion, providerStatus } from "../../gateway/src/providers.mjs";
import { assertSafeWorkspacePath } from "../../gateway/src/security.mjs";

const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BANNER = ["███████╗██╗   ██╗", "██╔════╝██║   ██║", "█████╗  ██║   ██║", "██╔══╝  ██║   ██║", "██║     ╚██████╔╝", "╚═╝      ╚═════╝ ", "  local AI orchestrator"].join("\n");

function printBanner() { console.log(`${RED}${BANNER}${RESET}`); }
function usage() { console.log("\n사용법:\n  Flux.exe cli chat --message \"질문\" [--project C:\\path\\to\\project]\n  Flux.exe cli chat [--project C:\\path\\to\\project]\n\n대화 중 /exit 또는 /quit을 입력하면 종료합니다."); }

function parseArguments(argv) {
  const tokens = [...argv];
  if (tokens[0] === "cli" || tokens[0] === "--cli") tokens.shift();
  if (tokens[0] === "--") tokens.shift();
  const options = { command: tokens.shift() ?? "chat", message: "", projectPath: "" };
  const remaining = [];
  while (tokens.length) {
    const token = tokens.shift();
    if (token === "--message" || token === "-m") options.message = tokens.shift() ?? "";
    else if (token === "--project" || token === "-p") options.projectPath = tokens.shift() ?? "";
    else remaining.push(token);
  }
  if (!options.message) options.message = remaining.join(" ");
  return options;
}

async function getProject(store, projectPath) {
  if (!projectPath) return null;
  const workspacePath = path.resolve(projectPath);
  assertSafeWorkspacePath(workspacePath);
  await fs.mkdir(workspacePath, { recursive: true });
  return store.listProjects().find((project) => path.resolve(project.workspacePath) === workspacePath)
    ?? store.createProject({ name: path.basename(workspacePath) || "CLI project", workspacePath, instructions: "" });
}

async function sendMessage({ config, store, providerRuntime, session, project, content }) {
  store.addMessage({ sessionId: session.id, role: "user", content });
  const context = buildModelContext(store.listMessages(session.id), store.getSessionContext(session.id), config.contextTokenBudget, config.contextCompactThreshold);
  if (context.context.changed) store.saveSessionContext(session.id, context.context);
  const projectMessage = project ? { role: "system", content: `This is a FLUX CLI chat attached to project workspace: ${project.workspacePath}. Explain proposed file changes clearly; use the FLUX web interface for approval-gated file operations.` } : null;
  let answer = "";
  output.write("\nFLUX › ");
  for await (const chunk of streamCompletion(providerRuntime.get(), [projectMessage, context.summaryMessage, ...context.activeMessages].filter(Boolean))) {
    answer += chunk;
    output.write(chunk);
  }
  output.write("\n");
  store.addMessage({ sessionId: session.id, role: "assistant", content: answer });
}

export function isCliInvocation(argv = process.argv.slice(2)) { return argv[0] === "cli" || argv[0] === "--cli"; }

export async function runCli({ config, store, providerRuntime, argv = process.argv.slice(2) }) {
  const options = parseArguments(argv);
  printBanner();
  if (["help", "--help", "-h"].includes(options.command)) return usage();
  if (options.command !== "chat") {
    console.error(`지원하지 않는 CLI 명령: ${options.command}`);
    usage();
    process.exitCode = 2;
    return;
  }
  const status = providerStatus(providerRuntime.get());
  if (!status.configured) throw new Error("선택한 AI 공급자가 아직 설정되지 않았습니다. 웹 설정에서 API 또는 로컬 모델을 저장하세요.");
  const project = await getProject(store, options.projectPath);
  const session = store.createSession({ projectId: project?.id ?? null, title: `CLI · ${new Date().toLocaleString("ko-KR")}`, source: "cli" });
  if (options.message.trim()) return sendMessage({ config, store, providerRuntime, session, project, content: options.message.trim() });
  if (!input.isTTY) throw new Error("비대화형 CLI에서는 --message 옵션을 사용하세요.");
  console.log(`모델: ${status.provider}${status.model ? ` · ${status.model}` : ""}${project ? `\n프로젝트: ${project.workspacePath}` : ""}\n종료: /exit`);
  const terminal = readline.createInterface({ input, output });
  try {
    while (true) {
      const content = (await terminal.question("\n나 › ")).trim();
      if (!content) continue;
      if (["/exit", "/quit"].includes(content.toLowerCase())) break;
      await sendMessage({ config, store, providerRuntime, session, project, content });
    }
  } finally { terminal.close(); }
}
