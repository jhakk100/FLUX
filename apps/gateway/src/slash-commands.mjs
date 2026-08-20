import { buildModelContext } from "./context.mjs";
import { providerStatus, resolveSessionProvider } from "./providers.mjs";

const HELP = [
  "FLUX 슬래시 명령",
  "`/help` — 이 안내를 표시합니다.",
  "`/status` — 이 대화에 실제 적용되는 공급자·모델·프로젝트를 표시합니다.",
  "`/context` — 문맥 예산과 다음 압축 여부를 표시합니다.",
  "`/remember <내용>` — 사용자가 지정한 내용을 장기 기억에 저장합니다.",
].join("\n");

export function parseSlashCommand(content) {
  const text = String(content ?? "").trim();
  if (!text.startsWith("/")) return null;
  const [rawName, ...args] = text.slice(1).split(/\s+/);
  if (!rawName) return { name: "help", args: "" };
  return { name: rawName.toLowerCase(), args: args.join(" ").trim() };
}

export function executeSlashCommand({ store, config, providerConfig, session, content, mutate = true }) {
  const command = parseSlashCommand(content);
  if (!command) return null;
  if (command.name === "help") return HELP;
  if (command.name === "status") {
    const status = providerStatus(resolveSessionProvider(providerConfig, session));
    const project = session.projectId ? store.getProject(session.projectId) : null;
    return [`공급자: ${status.provider}`, `모델: ${status.model ?? "선택되지 않음"}`, `상태: ${status.configured ? "준비됨" : "설정 필요"}`, `프로젝트: ${project?.name ?? "없음"}`].join("\n");
  }
  if (command.name === "context") {
    const messages = store.listMessages(session.id);
    const context = buildModelContext(messages, store.getSessionContext(session.id), config.contextTokenBudget, config.contextCompactThreshold);
    const remaining = Math.max(0, context.tokenBudget - context.estimatedActiveTokens);
    return [`남은 문맥: 약 ${remaining.toLocaleString()} / ${context.tokenBudget.toLocaleString()} 토큰`, `다음 응답 압축: ${context.wouldCompact ? "예" : "아니오"}`, `기록 태그: ${context.context.tags.length ? context.context.tags.join(", ") : "없음"}`].join("\n");
  }
  if (command.name === "remember") {
    if (!command.args) return "저장할 내용을 입력하세요. 예: `/remember 답변은 한국어로 간결하게`";
    if (command.args.length > 5_000) return "기억은 5,000자 이하로 저장할 수 있습니다.";
    if (!mutate) return "재생성에서는 장기 기억을 다시 저장하지 않았습니다.";
    const memory = store.createMemory({ content: command.args, kind: "fact" });
    return `장기 기억에 저장했습니다. (${memory.id.slice(0, 8)})`;
  }
  return `알 수 없는 명령: /${command.name}\n\n${HELP}`;
}
