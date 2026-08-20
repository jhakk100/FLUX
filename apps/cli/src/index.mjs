import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { buildModelContext } from "../../gateway/src/context.mjs";
import { executeSlashCommand } from "../../gateway/src/slash-commands.mjs";
import { listAvailableModels, resolveSessionProvider, streamCompletion, providerStatus } from "../../gateway/src/providers.mjs";
import { assertSafeWorkspacePath } from "../../gateway/src/security.mjs";
import { registerFluxCommandManually } from "./command-path.mjs";
import { APP_VERSION } from "../../gateway/src/app-info.mjs";

const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BANNER = ["███████╗██╗   ██╗", "██╔════╝██║   ██║", "█████╗  ██║   ██║", "██╔══╝  ██║   ██║", "██║     ╚██████╔╝", "╚═╝      ╚═════╝ ", "  local AI orchestrator"].join("\n");

function printBanner() { console.log(`${RED}${BANNER}${RESET}`); }
function usage() { console.log("\nFLUX CLI 사용법:\n  flux --help | -help\n  flux -chat \"질문\" [--project C:\\path\\to\\project] [--provider ollama] [--model 모델ID]\n  flux chat --message \"질문\" [--project C:\\path\\to\\project]\n  flux chat                         # 대화형 모드\n  flux status                       # 현재 공급자 확인\n  flux api models                   # 선택된 LLM API의 사용 가능한 모델 조회\n  flux api refresh                  # 모델 목록을 API에서 강제로 다시 조회\n  flux api services                 # Discord·Notion 등 부가 서비스 상태\n  flux install                      # PATH 등록을 다시 수행\n\n--provider/--model은 만든 CLI 대화에만 적용됩니다. 최초 GUI 실행 시 사용자 PATH에 flux 명령이 자동 등록됩니다. 새 터미널을 열어 사용하세요. 대화 중 /exit 또는 /quit을 입력하면 종료합니다."); }

export function connectionReport(config, providerConfig, group) {
  if (group === "services") {
    const discordReady = Boolean(config.discord.token && config.discord.allowedUserIds.length);
    const notionReady = Boolean(config.notion.apiKey);
    return ["[services] 부가 서비스 API", `${discordReady ? "●" : "○"} Discord · ${discordReady ? "준비됨" : "토큰 또는 허용 사용자 설정 필요"}`, `${notionReady ? "●" : "○"} Notion 읽기 연결 · ${notionReady ? "준비됨" : "API 키 설정 필요"}`, "", "부가 서비스 토큰은 .env 또는 FLUX 환경 변수로 설정합니다. 채팅용 LLM API와 분리되어 있습니다."].join("\n");
  }
  return "API 종류를 선택하세요.\n  models   선택된 LLM API에서 사용 가능한 모델 조회\n  refresh  모델 목록을 API에서 강제로 다시 조회\n  services Discord·Notion 등 부가 서비스 상태\n\n예: flux api models";
}

function tokenLimit(label, value) {
  return Number.isFinite(value) && value > 0 ? ` · ${label} ${value.toLocaleString()}` : "";
}

export function modelListReport(provider, result) {
  const models = result.models ?? [];
  const lines = models.map((model) => {
    const title = model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
    const tokens = `${tokenLimit("입력", model.inputTokenLimit)}${tokenLimit("출력", model.outputTokenLimit)}`;
    const capabilities = model.capabilities?.filter((capability) => capability !== model.owner) ?? [];
    const capabilityText = capabilities.length ? ` · ${capabilities.join(", ")}` : "";
    return `• ${title}${model.owner ? ` · ${model.owner}` : ""}${tokens}${capabilityText}`;
  });
  const usage = result.usage
    ? `\n\n사용량: 월 할당 ${result.usage.monthlyAllocated ?? "알 수 없음"} · 구매 ${result.usage.purchased ?? "알 수 없음"} · 합계 ${result.usage.total ?? "알 수 없음"}`
    : "";
  return [`[models] ${provider} · ${models.length}개`, ...(lines.length ? lines : ["조회된 모델이 없습니다."]), usage].filter(Boolean).join("\n");
}

function parseArguments(argv) {
  const tokens = [...argv];
  if (tokens[0] === "cli" || tokens[0] === "--cli") tokens.shift();
  if (tokens[0] === "--") tokens.shift();
  const aliases = { "-chat": "chat", "--chat": "chat", "-help": "help", "--help": "help", "-h": "help", "-version": "version", "--version": "version", "-v": "version", "install-cli": "install", "--install-cli": "install" };
  const requestedCommand = tokens.shift() ?? "chat";
  const options = { command: aliases[requestedCommand] ?? requestedCommand, message: "", projectPath: "", providerOverride: "", modelOverride: "" };
  const remaining = [];
  while (tokens.length) {
    const token = tokens.shift();
    if (token === "--message" || token === "-m") options.message = tokens.shift() ?? "";
    else if (token === "--project" || token === "-p") options.projectPath = tokens.shift() ?? "";
    else if (token === "--provider") options.providerOverride = tokens.shift() ?? "";
    else if (token === "--model") options.modelOverride = tokens.shift() ?? "";
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
  const commandResponse = executeSlashCommand({ store, config, providerConfig: providerRuntime.get(), session, content });
  if (commandResponse) {
    output.write(`\nFLUX › ${commandResponse}\n`);
    store.addMessage({ sessionId: session.id, role: "assistant", content: commandResponse });
    return;
  }
  const context = buildModelContext(store.listMessages(session.id), store.getSessionContext(session.id), config.contextTokenBudget, config.contextCompactThreshold);
  if (context.context.changed) store.saveSessionContext(session.id, context.context);
  const projectMessage = project ? { role: "system", content: `This is a FLUX CLI chat attached to project workspace: ${project.workspacePath}. Explain proposed file changes clearly; use the FLUX web interface for approval-gated file operations.` } : null;
  let answer = "";
  output.write("\nFLUX › ");
  const sessionProvider = resolveSessionProvider(providerRuntime.get(), session);
  for await (const chunk of streamCompletion(sessionProvider, [projectMessage, context.summaryMessage, ...context.activeMessages].filter(Boolean))) {
    answer += chunk;
    output.write(chunk);
  }
  output.write("\n");
  store.addMessage({ sessionId: session.id, role: "assistant", content: answer });
}

export function isCliInvocation(argv = process.argv.slice(2)) {
  return ["cli", "--cli", "install-cli", "--install-cli"].includes(argv[0]);
}

export async function runCli({ config, store, providerRuntime, argv = process.argv.slice(2) }) {
  const options = parseArguments(argv);
  printBanner();
  if (options.command === "help") return usage();
  if (options.command === "version") return console.log(`FLUX ${APP_VERSION}`);
  if (options.command === "install") {
    const result = await registerFluxCommandManually({ dataDirectory: config.dataDirectory });
    if (result.state !== "ready") return console.log(result.message);
    console.log(`flux 명령을 등록했습니다: ${result.commandPath}`);
    console.log(result.pathUpdated ? "새 터미널을 열면 flux 명령을 바로 사용할 수 있습니다." : "PATH가 이미 등록되어 있습니다. 새 터미널을 열어 사용하세요.");
    return;
  }
  if (options.command === "status") {
    const status = providerStatus(providerRuntime.get());
    console.log(`공급자: ${status.provider}\n모델: ${status.model ?? "선택되지 않음"}\n상태: ${status.configured ? "준비됨" : "설정 필요"}`);
    return;
  }
  if (options.command === "api") {
    const apiArguments = options.message.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let group = apiArguments[0] ?? "";
    if (!group && input.isTTY) {
      const terminal = readline.createInterface({ input, output });
      try { group = (await terminal.question("API 종류 선택 (models: 모델 조회, refresh: 강제 새로고침, services: 부가 서비스): ")).trim().toLowerCase(); } finally { terminal.close(); }
    }
    const refreshed = group === "refresh" || (group === "models" && apiArguments.includes("refresh"));
    if (group === "refresh") group = "models";
    if (group === "models") {
      const activeProvider = providerRuntime.get();
      try {
        if (refreshed) console.log("모델 목록을 새로고침합니다...");
        console.log(modelListReport(activeProvider.provider, await listAvailableModels(activeProvider)));
      } catch (error) {
        console.error(`모델 목록을 조회하지 못했습니다: ${error.message}`);
        process.exitCode = 1;
      }
      return;
    }
    console.log(connectionReport(config, providerRuntime.get(), group));
    if (group && group !== "services") process.exitCode = 2;
    return;
  }
  if (options.command !== "chat") {
    console.error(`지원하지 않는 CLI 명령: ${options.command}`);
    usage();
    process.exitCode = 2;
    return;
  }
  const selectedProvider = resolveSessionProvider(providerRuntime.get(), options);
  const status = providerStatus(selectedProvider);
  if (!status.configured) throw new Error("선택한 AI 공급자가 아직 설정되지 않았습니다. 웹 설정에서 API 또는 로컬 모델을 저장하세요.");
  const project = await getProject(store, options.projectPath);
  const session = store.createSession({ projectId: project?.id ?? null, title: `CLI · ${new Date().toLocaleString("ko-KR")}`, source: "cli", providerOverride: options.providerOverride || null, modelOverride: options.modelOverride || null });
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
