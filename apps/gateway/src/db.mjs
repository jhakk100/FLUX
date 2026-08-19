import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

function migrateLegacyStore(dataDirectory, legacyDataDirectories) {
  const destination = path.join(dataDirectory, "flux.sqlite");
  if (fs.existsSync(destination)) return;
  const sourceDirectory = legacyDataDirectories.find((directory) => directory && path.resolve(dataDirectory) !== path.resolve(directory) && fs.existsSync(path.join(directory, "flux.sqlite")));
  if (!sourceDirectory) return;
  const source = path.join(sourceDirectory, "flux.sqlite");
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const legacyFile = `${source}${suffix}`;
    if (fs.existsSync(legacyFile)) fs.copyFileSync(legacyFile, `${destination}${suffix}`);
  }
}

export function openStore(dataDirectory, { legacyDataDirectory, legacyDataDirectories = [] } = {}) {
  migrateLegacyStore(dataDirectory, [...legacyDataDirectories, legacyDataDirectory]);
  fs.mkdirSync(dataDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(dataDirectory, "flux.sqlite"));
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      title TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'web',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      risk TEXT NOT NULL,
      target TEXT NOT NULL,
      preview TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'fact',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_context (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      summary TEXT NOT NULL DEFAULT '',
      covered_count INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discord_sessions (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (channel_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all();
  if (!sessionColumns.some((column) => column.name === "archived_at")) {
    database.exec("ALTER TABLE sessions ADD COLUMN archived_at TEXT");
  }
  const projectColumns = database.prepare("PRAGMA table_info(projects)").all();
  if (!projectColumns.some((column) => column.name === "instructions")) {
    database.exec("ALTER TABLE projects ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
  }

  const now = () => new Date().toISOString();
  const id = () => randomUUID();
  const audit = (eventType, resourceType, resourceId, details) => {
    database.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?)")
      .run(id(), eventType, resourceType, resourceId, JSON.stringify(details), now());
  };

  function createProject({ name, workspacePath, instructions = "" }) {
    const project = { id: id(), name, workspacePath, instructions, createdAt: now() };
    database.prepare("INSERT INTO projects (id, name, workspace_path, instructions, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(project.id, project.name, project.workspacePath, project.instructions, project.createdAt);
    audit("project.created", "project", project.id, { name, workspacePath });
    return project;
  }

  function listProjects() {
    return database.prepare("SELECT id, name, workspace_path AS workspacePath, instructions, created_at AS createdAt FROM projects ORDER BY created_at ASC").all();
  }

  function getProject(projectId) {
    return database.prepare("SELECT id, name, workspace_path AS workspacePath, instructions, created_at AS createdAt FROM projects WHERE id = ?").get(projectId);
  }

  function updateProjectInstructions(projectId, instructions) {
    const project = getProject(projectId);
    if (!project) return null;
    database.prepare("UPDATE projects SET instructions = ? WHERE id = ?").run(instructions, projectId);
    audit("project.instructions_updated", "project", projectId, { length: instructions.length });
    return getProject(projectId);
  }

  function createSession({ projectId = null, title = "새 대화", source = "web" }) {
    const session = { id: id(), projectId, title, source, createdAt: now(), updatedAt: now() };
    database.prepare("INSERT INTO sessions (id, project_id, title, source, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(session.id, session.projectId, session.title, session.source, session.createdAt, session.updatedAt, null);
    audit("session.created", "session", session.id, { projectId, source });
    return session;
  }

  function listSessions({ archived = false } = {}) {
    return database.prepare("SELECT id, project_id AS projectId, title, source, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt FROM sessions WHERE (archived_at IS NOT NULL) = ? ORDER BY updated_at DESC")
      .all(archived ? 1 : 0);
  }

  function getSession(sessionId) {
    return database.prepare("SELECT id, project_id AS projectId, title, source, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt FROM sessions WHERE id = ?").get(sessionId);
  }

  function renameSession(sessionId, title) {
    const session = getSession(sessionId);
    if (!session) return null;
    const updatedAt = now();
    database.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?").run(title, updatedAt, sessionId);
    audit("session.renamed", "session", sessionId, { title });
    return getSession(sessionId);
  }

  function archiveSession(sessionId, archived) {
    const session = getSession(sessionId);
    if (!session) return null;
    const updatedAt = now();
    const archivedAt = archived ? updatedAt : null;
    database.prepare("UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ?").run(archivedAt, updatedAt, sessionId);
    audit(archived ? "session.archived" : "session.unarchived", "session", sessionId, {});
    return getSession(sessionId);
  }

  function searchSessions(query, { archived = false } = {}) {
    const like = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    return database.prepare(`
      SELECT sessions.id, sessions.project_id AS projectId, sessions.title, sessions.source,
             sessions.created_at AS createdAt, sessions.updated_at AS updatedAt, sessions.archived_at AS archivedAt,
             substr(messages.content, 1, 180) AS matchedContent
      FROM sessions LEFT JOIN messages ON messages.session_id = sessions.id
      WHERE (sessions.archived_at IS NOT NULL) = ? AND (sessions.title LIKE ? ESCAPE '\\' OR messages.content LIKE ? ESCAPE '\\')
      GROUP BY sessions.id
      ORDER BY sessions.updated_at DESC
      LIMIT 50
    `).all(archived ? 1 : 0, like, like);
  }

  function addMessage({ sessionId, role, content }) {
    const message = { id: id(), sessionId, role, content, createdAt: now() };
    database.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?)")
      .run(message.id, message.sessionId, message.role, message.content, message.createdAt);
    database.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(message.createdAt, sessionId);
    audit("message.created", "message", message.id, { sessionId, role, length: content.length });
    return message;
  }

  function listMessages(sessionId) {
    return database.prepare("SELECT id, session_id AS sessionId, role, content, created_at AS createdAt FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId);
  }

  function deleteMessage(messageId) {
    const message = database.prepare("SELECT id, session_id AS sessionId, role, content, created_at AS createdAt FROM messages WHERE id = ?").get(messageId);
    if (!message) return null;
    database.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
    database.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now(), message.sessionId);
    audit("message.deleted", "message", messageId, { sessionId: message.sessionId, role: message.role, reason: "regenerated" });
    return message;
  }

  function getOrCreateDiscordSession({ channelId, userId, title }) {
    const linked = database.prepare("SELECT session_id AS sessionId FROM discord_sessions WHERE channel_id = ? AND user_id = ?").get(channelId, userId);
    if (linked) {
      const session = getSession(linked.sessionId);
      if (session && !session.archivedAt) return session;
    }
    const session = createSession({ title, source: "discord" });
    database.prepare("INSERT INTO discord_sessions (channel_id, user_id, session_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, user_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at")
      .run(channelId, userId, session.id, now());
    audit("discord.session_linked", "session", session.id, { channelId, userId });
    return session;
  }

  function getSessionContext(sessionId) {
    const row = database.prepare("SELECT summary, covered_count AS coveredCount, tags, updated_at AS updatedAt FROM session_context WHERE session_id = ?").get(sessionId);
    return row ? { ...row, tags: JSON.parse(row.tags) } : { summary: "", coveredCount: 0, tags: [], updatedAt: null };
  }

  function saveSessionContext(sessionId, { summary, coveredCount, tags }) {
    const updatedAt = now();
    database.prepare("INSERT INTO session_context (session_id, summary, covered_count, tags, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary, covered_count = excluded.covered_count, tags = excluded.tags, updated_at = excluded.updated_at")
      .run(sessionId, summary, coveredCount, JSON.stringify(tags), updatedAt);
    audit("session.context_compacted", "session", sessionId, { coveredCount, tags });
    return getSessionContext(sessionId);
  }

  function listMemories(query = "", limit = 100) {
    const normalized = query.trim();
    if (!normalized) {
      return database.prepare("SELECT id, content, kind, created_at AS createdAt, updated_at AS updatedAt FROM memories ORDER BY updated_at DESC LIMIT ?").all(limit);
    }
    const like = `%${normalized.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    return database.prepare("SELECT id, content, kind, created_at AS createdAt, updated_at AS updatedAt FROM memories WHERE content LIKE ? ESCAPE '\\' OR kind LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?")
      .all(like, like, limit);
  }

  function createMemory({ content, kind = "fact" }) {
    const memory = { id: id(), content, kind, createdAt: now(), updatedAt: now() };
    database.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?)").run(memory.id, memory.content, memory.kind, memory.createdAt, memory.updatedAt);
    audit("memory.created", "memory", memory.id, { kind, length: content.length });
    return memory;
  }

  function updateMemory(memoryId, { content, kind }) {
    const existing = database.prepare("SELECT id FROM memories WHERE id = ?").get(memoryId);
    if (!existing) return null;
    const updatedAt = now();
    database.prepare("UPDATE memories SET content = ?, kind = ?, updated_at = ? WHERE id = ?").run(content, kind, updatedAt, memoryId);
    audit("memory.updated", "memory", memoryId, { kind, length: content.length });
    return database.prepare("SELECT id, content, kind, created_at AS createdAt, updated_at AS updatedAt FROM memories WHERE id = ?").get(memoryId);
  }

  function deleteMemory(memoryId) {
    const existing = database.prepare("SELECT id FROM memories WHERE id = ?").get(memoryId);
    if (!existing) return false;
    database.prepare("DELETE FROM memories WHERE id = ?").run(memoryId);
    audit("memory.deleted", "memory", memoryId, {});
    return true;
  }

  function listGoals() {
    return database.prepare("SELECT id, title, details, status, created_at AS createdAt, updated_at AS updatedAt FROM goals ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC").all();
  }

  function createGoal({ title, details = "", status = "active" }) {
    const goal = { id: id(), title, details, status, createdAt: now(), updatedAt: now() };
    database.prepare("INSERT INTO goals VALUES (?, ?, ?, ?, ?, ?)").run(goal.id, goal.title, goal.details, goal.status, goal.createdAt, goal.updatedAt);
    audit("goal.created", "goal", goal.id, { status });
    return goal;
  }

  function updateGoal(goalId, { title, details, status }) {
    const existing = database.prepare("SELECT id FROM goals WHERE id = ?").get(goalId);
    if (!existing) return null;
    const updatedAt = now();
    database.prepare("UPDATE goals SET title = ?, details = ?, status = ?, updated_at = ? WHERE id = ?").run(title, details, status, updatedAt, goalId);
    audit("goal.updated", "goal", goalId, { status });
    return database.prepare("SELECT id, title, details, status, created_at AS createdAt, updated_at AS updatedAt FROM goals WHERE id = ?").get(goalId);
  }

  function deleteGoal(goalId) {
    const existing = database.prepare("SELECT id FROM goals WHERE id = ?").get(goalId);
    if (!existing) return false;
    database.prepare("DELETE FROM goals WHERE id = ?").run(goalId);
    audit("goal.deleted", "goal", goalId, {});
    return true;
  }

  function createApproval({ action, risk, target, preview, payload }) {
    const approval = { id: id(), action, risk, target, preview, payload, status: "pending", createdAt: now() };
    database.prepare("INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(approval.id, action, risk, target, preview, JSON.stringify(payload), approval.status, approval.createdAt, null);
    audit("approval.requested", "approval", approval.id, { action, risk, target });
    return approval;
  }

  function listApprovals() {
    return database.prepare("SELECT id, action, risk, target, preview, status, created_at AS createdAt, decided_at AS decidedAt FROM approvals ORDER BY created_at DESC").all();
  }

  function getApproval(approvalId) {
    const approval = database.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId);
    return approval ? { ...approval, payload: JSON.parse(approval.payload) } : null;
  }

  function decideApproval(approvalId, status) {
    const approval = database.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId);
    if (!approval) return null;
    if (approval.status !== "pending") throw new Error("This approval was already decided.");
    const decidedAt = now();
    database.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?").run(status, decidedAt, approvalId);
    audit(`approval.${status}`, "approval", approvalId, { action: approval.action, target: approval.target });
    return { ...approval, payload: JSON.parse(approval.payload), status, decidedAt };
  }

  function listAuditEvents(limit = 100) {
    return database.prepare("SELECT id, event_type AS eventType, resource_type AS resourceType, resource_id AS resourceId, details, created_at AS createdAt FROM audit_events ORDER BY created_at DESC LIMIT ?").all(limit)
      .map((item) => ({ ...item, details: JSON.parse(item.details) }));
  }

  function getSetting(key) {
    const row = database.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : null;
  }

  function setSetting(key, value) {
    const updatedAt = now();
    database.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), updatedAt);
    audit("setting.updated", "setting", key, { key });
  }

  return { close: () => database.close(), createProject, listProjects, getProject, updateProjectInstructions, createSession, listSessions, getSession, renameSession, archiveSession, searchSessions, addMessage, listMessages, deleteMessage, getOrCreateDiscordSession, getSessionContext, saveSessionContext, listMemories, createMemory, updateMemory, deleteMemory, listGoals, createGoal, updateGoal, deleteGoal, createApproval, listApprovals, getApproval, decideApproval, listAuditEvents, getSetting, setSetting };
}
