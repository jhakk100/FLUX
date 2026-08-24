import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openStore } from "../src/db.mjs";

test("sessions can be renamed, searched, archived, and restored", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-sessions-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const session = store.createSession({ title: "초안" });
  store.addMessage({ sessionId: session.id, role: "user", content: "오로라 검색어" });

  assert.equal(store.renameSession(session.id, "새 이름").title, "새 이름");
  assert.equal(store.searchSessions("오로라").length, 1);
  assert.equal(store.archiveSession(session.id, true).archivedAt !== null, true);
  assert.equal(store.listSessions().length, 0);
  assert.equal(store.listSessions({ archived: true }).length, 1);
  assert.equal(store.archiveSession(session.id, false).archivedAt, null);
  store.close();
});

test("a session can keep its own provider and model without changing global settings", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-session-model-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const session = store.createSession({ title: "모델 고정", providerOverride: "factchat", modelOverride: "gpt-5-nano" });
  assert.equal(store.getSession(session.id).modelOverride, "gpt-5-nano");
  assert.equal(store.updateSessionModel(session.id, { providerOverride: "ollama", modelOverride: "gemma4:e2b" }).providerOverride, "ollama");
  assert.equal(store.listSessions()[0].modelOverride, "gemma4:e2b");
  store.close();
});

test("each FLUX project owns its instructions independently", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-project-instructions-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const first = store.createProject({ name: "first", workspacePath: "C:/work/first", instructions: "Use TypeScript." });
  const second = store.createProject({ name: "second", workspacePath: "C:/work/second", instructions: "Use Python." });
  store.updateProjectInstructions(first.id, "Use Rust.");
  assert.equal(store.getProject(first.id).instructions, "Use Rust.");
  assert.equal(store.getProject(second.id).instructions, "Use Python.");
  store.close();
});

test("project teams are isolated and removed with their FLUX project only", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-project-agents-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const first = store.createProject({ name: "first", workspacePath: "C:/work/first" });
  const second = store.createProject({ name: "second", workspacePath: "C:/work/second" });
  const agent = store.createProjectAgent({ projectId: first.id, name: "검토자", role: "코드 검토", providerOverride: "ollama", modelOverride: "gemma4:e2b" });
  store.createProjectAgent({ projectId: second.id, name: "분석가", providerOverride: "factchat", modelOverride: "gpt-5-nano" });
  assert.equal(store.listProjectAgents(first.id)[0].id, agent.id);
  assert.equal(store.updateProjectAgent(first.id, agent.id, { name: "설계 검토자", enabled: false }).enabled, false);
  store.deleteProject(first.id);
  assert.equal(store.listProjectAgents(first.id).length, 0);
  assert.equal(store.listProjectAgents(second.id).length, 1);
  store.close();
});

test("legacy executable data migrates into the persistent data directory once", async (context) => {
  const legacyDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-legacy-data-"));
  const persistentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-persistent-data-"));
  context.after(() => fs.rm(legacyDirectory, { recursive: true, force: true }));
  context.after(() => fs.rm(persistentDirectory, { recursive: true, force: true }));
  const legacyStore = openStore(legacyDirectory);
  legacyStore.createSession({ title: "기존 대화" });
  legacyStore.close();
  const persistentStore = openStore(persistentDirectory, { legacyDataDirectory: legacyDirectory });
  assert.equal(persistentStore.listSessions()[0].title, "기존 대화");
  persistentStore.close();
});

test("each Discord channel and user pair keeps an isolated reusable session", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-discord-sessions-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const first = store.getOrCreateDiscordSession({ channelId: "channel-a", userId: "user-a", title: "Discord · a" });
  const again = store.getOrCreateDiscordSession({ channelId: "channel-a", userId: "user-a", title: "Discord · a" });
  const anotherUser = store.getOrCreateDiscordSession({ channelId: "channel-a", userId: "user-b", title: "Discord · b" });
  const anotherChannel = store.getOrCreateDiscordSession({ channelId: "channel-b", userId: "user-a", title: "Discord · a" });

  assert.equal(first.source, "discord");
  assert.equal(again.id, first.id);
  assert.notEqual(anotherUser.id, first.id);
  assert.notEqual(anotherChannel.id, first.id);
  store.close();
});

test("a stored assistant response can be removed after a successful regeneration", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-regenerate-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const session = store.createSession({ title: "재생성" });
  store.addMessage({ sessionId: session.id, role: "user", content: "질문" });
  const answer = store.addMessage({ sessionId: session.id, role: "assistant", content: "이전 답변" });
  assert.equal(store.deleteMessage(answer.id).content, "이전 답변");
  assert.deepEqual(store.listMessages(session.id).map((message) => message.content), ["질문"]);
  store.close();
});

test("a stale pending approval can be expired without being applied", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-expired-approval-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const approval = store.createApproval({
    action: "delete-file", risk: "R3", target: "C:/workspace/missing.txt", preview: "Delete missing.txt",
    payload: { projectId: "missing-project", relativePath: "missing.txt", expectedHash: "old" },
  });
  const expired = store.expireApproval(approval.id, "The requested file no longer exists.");
  assert.equal(expired.status, "expired");
  assert.equal(store.listApprovals().find((item) => item.id === approval.id).status, "expired");
  assert.equal(store.expireApproval(approval.id, "again"), null);
  store.close();
});

test("project child conversation roles persist independently", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-session-role-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const project = store.createProject({ name: "team", workspacePath: "C:/work/team" });
  const child = store.createSession({ projectId: project.id, title: "검토", role: "보안 검토를 담당한다." });
  const lead = store.ensureProjectLeadSession(project);
  assert.equal(store.getSession(child.id).role, "보안 검토를 담당한다.");
  assert.equal(store.getProjectLeadSession(project.id).id, lead.id);
  assert.equal(store.updateSessionRole(child.id, "테스트 계획을 담당한다.").role, "테스트 계획을 담당한다.");
  assert.equal(store.listSessions().find((session) => session.id === child.id).role, "테스트 계획을 담당한다.");
  store.close();
});
test("collaboration runs persist real child assignments and outcomes", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-collaboration-runs-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const project = store.createProject({ name: "team", workspacePath: "C:/work/team" });
  const lead = store.ensureProjectLeadSession(project);
  const child = store.createSession({ projectId: project.id, title: "검토자", role: "안전성 검토" });
  const run = store.createCollaborationRun({ projectId: project.id, leadSessionId: lead.id, requestContent: "테스트해줘" });
  const assignment = store.addMessage({ sessionId: child.id, role: "project_lead", content: "[프로젝트 리더 지시]\\n테스트해줘" });
  const queued = store.createCollaborationTask({ runId: run.id, childSessionId: child.id, childName: child.title, childRole: child.role, provider: "ollama", model: "local", instructionMessageId: assignment.id });
  const running = store.updateCollaborationTask(queued.id, { status: "running" });
  const response = store.addMessage({ sessionId: child.id, role: "assistant", content: "검토 결과" });
  const completed = store.updateCollaborationTask(running.id, { status: "completed", responseMessageId: response.id });
  const finished = store.completeCollaborationRun(run.id, { status: "completed", summary: "검토자 완료" });
  assert.equal(finished.status, "completed");
  assert.equal(finished.tasks[0].status, "completed");
  assert.equal(finished.tasks[0].responseMessageId, response.id);
  assert.equal(store.listMessages(child.id)[0].role, "project_lead");
  assert.equal(store.listCollaborationRuns(lead.id)[0].summary, "검토자 완료");
  store.close();
});

test("per-conversation rate limits and applied file provenance persist", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-rate-and-provenance-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const project = store.createProject({ name: "workspace", workspacePath: "C:/work/workspace" });
  const session = store.createSession({ projectId: project.id, title: "제한 대화" });
  const updated = store.updateSessionRateLimit(session.id, { requestsPerMinute: 3, minIntervalSeconds: 12 });
  assert.equal(updated.requestsPerMinute, 3);
  assert.equal(store.getSession(session.id).minIntervalSeconds, 12);
  const record = store.recordFileProvenance({
    approvalId: "approval-1", projectId: project.id, relativePath: "src/example.js", action: "create-file",
    source: "assistant", sessionId: session.id, collaborationRunId: "run-1", provider: "ollama", model: "test-model", debugMarker: true, resultingHash: "abc",
  });
  assert.equal(store.listFileProvenance(project.id)[0].id, record.id);
  assert.equal(store.listFileProvenance(project.id)[0].debugMarker, true);
  store.close();
});